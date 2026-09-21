// Real Safari detection. Every other engine's UA also contains the
// literal string "Safari" (kept for legacy compatibility), so a plain
// substring match misfires on Chrome, Edge, Opera, and Firefox — this
// only returns true once every other engine's own token is ruled out.
export function isSafari(userAgent){
  return /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(userAgent);
}
