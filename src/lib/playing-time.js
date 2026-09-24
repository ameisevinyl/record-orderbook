// Pure playing-time threshold logic — no DOM, no CONFIG import (the
// caller passes in the specific format's timeLimits table, via
// src/lib/format-catalogue.js's getFormat, so this stays testable and
// reusable regardless of where CONFIG lives).
//
// timeLimits shape: { [mode]: { recommended:{[rpm]:min}, max:{[rpm]:min} } } —
// one format's table; rpm is a live per-side choice, not fixed by
// format, hence the extra key level under recommended/max.

export function computeStatus(timeLimits, rpm, mode, seconds){
  const limits = timeLimits[mode];
  const maxMin = limits.max[rpm];
  const recommendedMin = limits.recommended[rpm];
  const minutes = seconds/60;
  let level = "ok";
  if(minutes > maxMin) level = "danger";
  else if(minutes > recommendedMin) level = "warn";
  return {level, maxMin, recommendedMin, minutes};
}

// Reference table for the Specifications box and the Specs document:
// every cut and rpm of one format, independent of what the customer chose.
export function timeLimitTable(timeLimits){
  const rpms = Object.keys(Object.values(timeLimits)[0].max).sort((a, b) => a - b);
  return {
    head: ["Cut", ...rpms.flatMap(rpm => [`${rpm} RPM recommended`, `${rpm} RPM max`])],
    rows: Object.entries(timeLimits).map(([cut, limits]) =>
      [cut, ...rpms.flatMap(rpm => [`< ${limits.recommended[rpm]} min`, `${limits.max[rpm]} min`])])
  };
}

// Shown under the playing-time table wherever it appears (Specifications
// box, Specs document): the figures are a rough guide, not a promise.
export const PLAYING_TIME_NOTE = "Varies by style: more bass = less space";

// A format may strongly recommend one speed (e.g. 7" at 45 RPM).
export function rpmRecommendation(format){
  return format.recommendedRpm ? `${format.recommendedRpm} RPM strongly recommended` : "";
}

// Non-blocking warning for a side set to the speed its format advises against.
export function rpmWarning(format, rpm){
  return format.recommendedRpm && Number(rpm) !== format.recommendedRpm ? rpmRecommendation(format) : "";
}
