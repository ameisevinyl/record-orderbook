// File/folder naming for the customer package — see CLAUDE.md's "File
// naming convention". Pure string logic so tracklist.js, labels.js and
// cover-sleeve.js all build the exact same name for the exact same file,
// which is what lets a reopened project zip re-attach files by an exact
// name match instead of guessing.
//
// Versioning isn't tracked yet (see CLAUDE.md) — every name gets a fixed
// "v1" suffix for now.

// Lowercase, filename-safe token: anything that isn't a-z/0-9 collapses
// to one underscore, leading/trailing underscores trimmed.
export function slug(str){
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// The file extension including its leading dot, or "" if there isn't one.
export function fileExt(name){
  return name && name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
}

// Filesystem-safe name — strips path separators and reserved
// Windows/macOS filename characters. Used for names that keep mixed case
// (catalogue numbers), unlike slug() which also lowercases.
export function sanitizeFileName(name){
  return (name || "").trim().replace(/[\\/:*?"<>|]+/g, "-") || "untitled-release";
}

// PNKRCK007_A1_my_way_artist_v1.wav — catalogue# prefixed so a track
// keeps a unique name once it's pulled out of its project folder (e.g.
// into a shared mastering working directory), same reasoning as
// printedPartFileName below.
export function trackFileName({catalogue, side, index, title, artist, ext}){
  const parts = [sanitizeFileName(catalogue), side + index, slug(title) || "untitled"];
  if(artist && slug(artist)) parts.push(slug(artist));
  return parts.join("_") + "_v1" + ext;
}

// PNKRCK007_A_side_v1.wav — a whole side delivered as one continuous file.
export function continuousSideFileName({catalogue, side, ext}){
  return sanitizeFileName(catalogue) + "_" + side + "_side_v1" + ext;
}

// PNKRCK007_labels_A_v1.pdf / PNKRCK007_cover_v1.pdf
export function printedPartFileName({catalogue, part, variant, ext}){
  const parts = [sanitizeFileName(catalogue), part];
  if(variant) parts.push(variant);
  return parts.join("_") + "_v1" + ext;
}

// YYMMDD, local date.
export function dateStamp(date = new Date()){
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return yy + mm + dd;
}

// 260919_PNKRCK007_customer_example_com — the project package's file
// name (also the single folder nested inside the zip).
export function projectFileName({catalogue, customerEmail, date}){
  const parts = [dateStamp(date), sanitizeFileName(catalogue)];
  if(customerEmail && slug(customerEmail)) parts.push(slug(customerEmail));
  return parts.join("_");
}
