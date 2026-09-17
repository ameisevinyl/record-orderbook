// Pure playing-time threshold logic — no DOM, no CONFIG import (the
// caller passes in whichever timeLimits table applies, so this stays
// testable and reusable regardless of where CONFIG lives).
//
// timeLimits shape: { [format]: { [mode]: { ideal:{[rpm]:min}, max:{[rpm]:min} } } }

export function computeStatus(timeLimits, format, rpm, mode, seconds){
  const limits = timeLimits[format][mode];
  const maxMin = limits.max[rpm];
  const idealMin = limits.ideal[rpm];
  const minutes = seconds/60;
  let level = "ok";
  if(minutes > maxMin) level = "danger";
  else if(minutes > idealMin) level = "warn";
  return {level, maxMin, idealMin, minutes};
}
