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

// Reference rows for the Specifications box: every cut and rpm of one
// format's table, independent of what the customer chose.
export function timeLimitRows(timeLimits){
  return Object.entries(timeLimits).flatMap(([cut, limits]) =>
    Object.keys(limits.max).sort((a, b) => a - b).map(rpm => ({
      label: `${cut}, ${rpm} RPM`,
      text: `below ${limits.recommended[rpm]} min / ${limits.max[rpm]} min`
    })));
}

// Shown under the playing-time rows wherever they appear (Specifications
// box, Specs document): the figures are a rough guide, not a promise.
export const PLAYING_TIME_NOTE = "Guide values only. How much fits on a side varies a lot with musical style and content: bass and loudness need wider grooves, so the more bass, the shorter the side.";

// A format may strongly recommend one speed (e.g. 7" at 45 RPM).
export function rpmRecommendation(format){
  return format.recommendedRpm ? `${format.recommendedRpm} RPM strongly recommended` : "";
}
