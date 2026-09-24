// Minimal PDF 1.3 writer — no dependencies, no compression. 1.3 is the
// version prepress expects (page boxes like TrimBox/BleedBox arrived in
// 1.3), and everything this writer emits fits it. Writes classic
// xref-table PDFs whose pages carry exact MediaBox/BleedBox/TrimBox
// boxes, so printed-part templates are dimensionally true. Pure: takes
// plain page descriptions, returns bytes.

export function mmToPt(mm){
  return mm * 72 / 25.4;
}

function fmt(n){
  return String(Math.round(n * 10000) / 10000);
}

// PDF text string: plain ASCII stays readable, anything else becomes a
// UTF-16BE hex string (with BOM) so non-ASCII plant/product names survive.
function textString(str){
  const s = String(str ?? "");
  if([...s].every(ch => ch.charCodeAt(0) <= 0x7F)){
    return "(" + s.replace(/([\\()])/g, "\\$1") + ")";
  }
  let hex = "FEFF";
  for(const ch of s){
    const code = ch.codePointAt(0);
    if(code > 0xFFFF){
      const pair = code - 0x10000;
      hex += (0xD800 + (pair >> 10)).toString(16).padStart(4, "0").toUpperCase();
      hex += (0xDC00 + (pair & 0x3FF)).toString(16).padStart(4, "0").toUpperCase();
    } else{
      hex += code.toString(16).padStart(4, "0").toUpperCase();
    }
  }
  return `<${hex}>`;
}

function streamObject(content){
  const text = content.endsWith("\n") ? content : content + "\n";
  return `<< /Length ${text.length} >>\nstream\n${text}endstream`;
}

function asciiBytes(str){
  const out = new Uint8Array(str.length);
  for(let i=0;i<str.length;i++) out[i] = str.charCodeAt(i) & 0xFF;
  return out;
}

// pages: [{ widthMm, heightMm, content, trimBoxPt? }] — content is a PDF
// content stream (points, ASCII), trimBoxPt an optional [x0 y0 x1 y1] in
// PDF points (bottom-left origin).
export function buildPdf({ title, producer = "record-orderbook", pages }){
  if(!Array.isArray(pages) || !pages.length) throw new TypeError("pdf needs at least one page");
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };

  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const infoId = add(`<< /Title ${textString(title)} /Producer ${textString(producer)} >>`);

  const pageIds = [];
  for(const page of pages){
    const widthPt = mmToPt(page.widthMm), heightPt = mmToPt(page.heightMm);
    const contentId = add(streamObject(page.content));
    const boxes = [
      `/MediaBox [0 0 ${fmt(widthPt)} ${fmt(heightPt)}]`,
      `/BleedBox [0 0 ${fmt(widthPt)} ${fmt(heightPt)}]`
    ];
    if(page.trimBoxPt) boxes.push(`/TrimBox [${page.trimBoxPt.map(fmt).join(" ")}]`);
    pageIds.push(add(
      `<< /Type /Page /Parent ${pagesId} 0 R ${boxes.join(" ")} `
      + `/Resources << /ProcSet [/PDF] /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    ));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.3\n";
  const offsets = [];
  objects.forEach((body, i)=>{
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for(const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`;
  return asciiBytes(out);
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Bytes -> base64 without btoa (which chokes on large spreads).
export function bytesToBase64(bytes){
  let out = "";
  for(let i=0;i<bytes.length;i+=3){
    const b0 = bytes[i], b1 = bytes[i+1], b2 = bytes[i+2];
    out += BASE64[b0 >> 2] + BASE64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : BASE64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : BASE64[b2 & 63];
  }
  return out;
}
