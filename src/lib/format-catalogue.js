// Pure lookups over CONFIG.formats — no DOM, no CONFIG import (the
// caller passes CONFIG in, so this stays testable independently of
// where CONFIG lives). See docs/superpowers/specs/2026-09-20-catalogue-
// schema-restructure-design.md for the schema this operates on: `formats`
// is an array, each entry a fully self-contained description of one
// physical format; array order is display order.

export function getFormat(config, id){
  return config.formats.find(f => f.id === id);
}

export function enabledFormats(config){
  return config.formats.filter(f => f.enabled);
}

export function firstEnabledFormat(config){
  const first = enabledFormats(config)[0];
  if(!first) throw new Error("CONFIG.formats: at least one format must be enabled");
  return first.id;
}
