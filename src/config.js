// CONFIG — edit these values for your own studio. Shared across every
// module (tracklist, labels, covers, shipping...), so it lives here once.

export const CONFIG = {
  // Email address customers should send SwissTransfer packages to.
  studioEmail: "cutting@example.com",

  // Default RPM per format, applied whenever the format is changed.
  defaultRpm: { 7:45, 10:33, 12:33 },

  // Recommended playing time in minutes, per format / RPM / cut type.
  // "ideal"  — comfortably safe cutting level, no warning shown
  // "max"    — hard ceiling; exceeding this shows a red warning
  // "normal"      — standard release
  // "soundsystem" — shorter, hotter cut (12"/10" club or soundsystem pressings)
  timeLimits: {
    7:  {
      normal:      { ideal:{45:3.5, 33:4.5}, max:{45:4.5, 33:6} },
      soundsystem: { ideal:{45:3.5, 33:4.5}, max:{45:4.5, 33:6} }
    },
    10: {
      normal:      { ideal:{45:6,   33:10},  max:{45:8,   33:14} },
      soundsystem: { ideal:{45:4.5, 33:7},   max:{45:6,   33:9} }
    },
    12: {
      normal:      { ideal:{45:10,  33:18},  max:{45:14,  33:24} },
      soundsystem: { ideal:{45:8,   33:12},  max:{45:9,   33:15} }
    }
  }
};
