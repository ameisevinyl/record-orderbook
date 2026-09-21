// Pure time helpers — no DOM. m:ss <-> seconds.

export function formatTime(totalSeconds){
  if(!isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.round(totalSeconds);
  const m = Math.floor(s/60);
  const r = s%60;
  return m + ":" + String(r).padStart(2,"0");
}

export function parseTime(str){
  if(!str) return null;
  str = str.trim();
  if(!str) return null;
  const m = str.match(/^(\d+):([0-5]?\d)(?:\.(\d+))?$/);
  if(m){
    return parseInt(m[1],10)*60 + parseInt(m[2],10) + (m[3]?parseFloat("0."+m[3]):0);
  }
  const asNum = parseFloat(str.replace(",", "."));
  if(!isNaN(asNum)) return asNum; // bare seconds
  return null;
}

// {gap, gapCustom} is the shape both a track-row's fields and a
// serialized track object share, so this works for either.
export function trackGapSeconds({gap, gapCustom}, isFirst){
  if(isFirst) return 0;
  if(gap === "0") return 0;
  if(gap === "2") return 2;
  const v = parseFloat(gapCustom);
  return isFinite(v) ? v : 0;
}
