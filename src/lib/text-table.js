// Renders a UTF-8 box-drawing table from a header row and data rows —
// used for the tracklist's plain-text export (order-summary.txt), which
// has to stay readable as plain text (no HTML/PDF), hence real
// box-drawing characters rather than markdown-style pipes. Column width
// is whatever the longest cell (header or data) in that column needs —
// no truncation, no wrapping.

export function renderTable(headers, rows){
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map(r => String(r[i] ?? "").length))
  );
  const rule = (l, m, r) => l + widths.map(w => "─".repeat(w + 2)).join(m) + r;
  const line = (cells) =>
    "│ " + cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join(" │ ") + " │";

  const out = [rule("┌", "┬", "┐"), line(headers), rule("├", "┼", "┤")];
  rows.forEach(r => out.push(line(r)));
  out.push(rule("└", "┴", "┘"));
  return out.join("\n");
}
