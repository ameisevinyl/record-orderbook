// Pure playing-time threshold logic — no DOM, no CONFIG import (the
// caller passes in the specific format's timeLimits table, via
// src/lib/format-catalogue.js's getFormat, so this stays testable and
// reusable regardless of where CONFIG lives).
//
// timeLimits shape: { [mode]: { ideal:{[rpm]:min}, max:{[rpm]:min} } } —
// one format's table; rpm is a live per-side choice, not fixed by
// format, hence the extra key level under ideal/max.

export function computeStatus(timeLimits, rpm, mode, seconds){
  const limits = timeLimits[mode];
  const maxMin = limits.max[rpm];
  const idealMin = limits.ideal[rpm];
  const minutes = seconds/60;
  let level = "ok";
  if(minutes > maxMin) level = "danger";
  else if(minutes > idealMin) level = "warn";
  return {level, maxMin, idealMin, minutes};
}
