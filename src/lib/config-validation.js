const SEVERITIES = new Set(["debug", "info", "warn", "error"]);
const CHECK_NAMES = [
  "size", "resolution", "colorMode", "spotColors", "colorProfile",
  "pdfVersion", "trimBox", "encryption", "fonts", "ink", "black", "bleed"
];

function fail(path, expected){
  throw new Error(`${path} ${expected}`);
}

function object(value, path){
  if(value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  return value;
}

function array(value, path){
  if(!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function string(value, path, allowEmpty = false){
  if(typeof value !== "string") fail(path, `must be a${allowEmpty ? "" : " non-empty"} string`);
  if(!allowEmpty && !value.trim()) fail(path, "must be a non-empty string");
}

function number(value, path, allowZero = false){
  if(!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)){
    fail(path, `must be a ${allowZero ? "nonnegative" : "positive"} number`);
  }
}

function dimensions(value, path){
  object(value, path);
  number(value.w, `${path}.w`);
  number(value.h, `${path}.h`);
}

function severity(value, path){
  if(!SEVERITIES.has(value)) fail(path, "must be debug, info, warn, or error");
}

const CHECKED_PARTS = ["labels", "innerSleeve", "outerCover", "inlay"];

function validatePrintCheck(value, path){
  const printCheck = object(value, path);
  number(printCheck.sizeToleranceMm, `${path}.sizeToleranceMm`, true);
  const dpi = object(printCheck.dpi, `${path}.dpi`);
  number(dpi.min, `${path}.dpi.min`);
  number(dpi.max, `${path}.dpi.max`);
  if(dpi.min > dpi.max) fail(`${path}.dpi`, "min must not exceed max");
  const fixDpi = object(printCheck.fixDpi, `${path}.fixDpi`);
  for(const part of CHECKED_PARTS){
    if(!Number.isInteger(fixDpi[part]) || fixDpi[part] <= 0) fail(`${path}.fixDpi.${part}`, "must be a positive integer");
  }

  const checks = object(printCheck.checks, `${path}.checks`);
  for(const name of CHECK_NAMES){
    const check = object(checks[name], `${path}.checks.${name}`);
    severity(check.severity, `${path}.checks.${name}.severity`);
  }
  for(const name of ["colorMode", "pdfVersion"]){
    const accepted = array(checks[name].accepted, `${path}.checks.${name}.accepted`);
    if(!accepted.length) fail(`${path}.checks.${name}.accepted`, "must not be empty");
    accepted.forEach((entry, i) => string(entry, `${path}.checks.${name}.accepted[${i}]`));
  }
  if(typeof checks.spotColors.accepted !== "boolean") fail(`${path}.checks.spotColors.accepted`, "must be a boolean");
  for(const name of ["colorProfile", "trimBox"]){
    if(typeof checks[name].required !== "boolean") fail(`${path}.checks.${name}.required`, "must be a boolean");
  }
  if(typeof checks.fonts.requireEmbedded !== "boolean") fail(`${path}.checks.fonts.requireEmbedded`, "must be a boolean");

  const ink = object(printCheck.inkLimitPct, `${path}.inkLimitPct`);
  for(const part of CHECKED_PARTS){
    number(ink[part], `${path}.inkLimitPct.${part}`);
    if(ink[part] > 400) fail(`${path}.inkLimitPct.${part}`, "must not exceed 400");
  }
  const black = object(printCheck.black, `${path}.black`);
  number(black.kMinPct, `${path}.black.kMinPct`);
  number(black.cmyMaxPct, `${path}.black.cmyMaxPct`);
  number(black.neutralTolPct, `${path}.black.neutralTolPct`);
}

function validateTimeLimits(value, path){
  const limits = object(value, path);
  for(const mode of ["normal", "soundsystem"]){
    const cut = object(limits[mode], `${path}.${mode}`);
    const recommended = object(cut.recommended, `${path}.${mode}.recommended`);
    const max = object(cut.max, `${path}.${mode}.max`);
    for(const rpm of [33, 45]){
      number(recommended[rpm], `${path}.${mode}.recommended.${rpm}`);
      number(max[rpm], `${path}.${mode}.max.${rpm}`);
      if(recommended[rpm] > max[rpm]) fail(`${path}.${mode}`, `recommended must not exceed max at ${rpm} RPM`);
    }
  }
}

function validateProducts(parts, path){
  const label = object(parts.label, `${path}.label`);
  number(label.diameterMm, `${path}.label.diameterMm`);
  number(label.bleedMm, `${path}.label.bleedMm`, true);

  for(const partName of ["innerSleeve", "outerCover", "inlay"]){
    const products = array(object(parts[partName], `${path}.${partName}`).products, `${path}.${partName}.products`);
    if(partName === "innerSleeve" && !products.length) fail(`${path}.${partName}.products`, "must contain at least one product");
    const ids = new Set();
    let defaults = 0;
    products.forEach((product, i) => {
      const productPath = `${path}.${partName}.products[${i}]`;
      object(product, productPath);
      string(product.id, `${productPath}.id`);
      if(ids.has(product.id)) fail(`${path}.${partName}.products`, `contains duplicate ID "${product.id}"`);
      ids.add(product.id);
      string(product.name, `${productPath}.name`);
      if(product.kind !== "printed" && product.kind !== "unprinted") fail(`${productPath}.kind`, "must be printed or unprinted");
      if(product.default !== undefined && typeof product.default !== "boolean") fail(`${productPath}.default`, "must be a boolean");
      if(product.default) defaults++;
      number(product.paperGsm, `${productPath}.paperGsm`);
      if(partName === "innerSleeve" || partName === "outerCover") dimensions(product.finalMm, `${productPath}.finalMm`);
      if(partName === "outerCover") number(product.spineMm, `${productPath}.spineMm`, true);
      if(product.kind === "printed"){
        dimensions(product.trimMm, `${productPath}.trimMm`);
        number(product.bleedMm, `${productPath}.bleedMm`, true);
      }
    });
    if(partName === "innerSleeve" && defaults !== 1) fail(`${path}.${partName}.products`, "must contain exactly one default product");
  }
}

function validateVinylColor(value){
  const vinyl = object(value, "CONFIG.vinylColor");
  string(vinyl.standardColor, "CONFIG.vinylColor.standardColor");
  if(vinyl.standardColor === "random") fail("CONFIG.vinylColor.standardColor", "must not use the reserved random ID");
  const ids = new Set([vinyl.standardColor, "random"]);
  array(vinyl.basicColors, "CONFIG.vinylColor.basicColors").forEach((id, i) => {
    string(id, `CONFIG.vinylColor.basicColors[${i}]`);
    if(ids.has(id)) fail("CONFIG.vinylColor", `contains duplicate colour ID "${id}"`);
    ids.add(id);
  });
  const minimums = object(vinyl.minOrderQty, "CONFIG.vinylColor.minOrderQty");
  for(const [id, quantity] of Object.entries(minimums)){
    if(!ids.has(id)) fail(`CONFIG.vinylColor.minOrderQty.${id}`, "uses an unknown colour ID");
    if(!Number.isInteger(quantity) || quantity < 0) fail(`CONFIG.vinylColor.minOrderQty.${id}`, "must be a nonnegative integer");
  }
}

function integer(value, path, allowZero = false){
  if(!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)){
    fail(path, `must be a ${allowZero ? "nonnegative" : "positive"} integer`);
  }
}

function validateProofs(value){
  const proofs = object(value, "CONFIG.proofs");
  integer(proofs.testpressDefaultQty, "CONFIG.proofs.testpressDefaultQty");
  integer(proofs.testpressRecommendedFromQty, "CONFIG.proofs.testpressRecommendedFromQty", true);
}

function validatePrintProfiles(value){
  const profiles = object(value, "CONFIG.printProfiles");
  for(const part of CHECKED_PARTS){
    const path = `CONFIG.printProfiles.${part}`;
    const entry = object(profiles[part], path);
    string(entry.name, `${path}.name`);
    string(entry.conditionId, `${path}.conditionId`);
    if(typeof entry.url !== "string" || !entry.url.startsWith("https://")) fail(`${path}.url`, "must start with https://");
    if(typeof entry.file !== "string" || !/^[^/\\]+\.icc$/i.test(entry.file) || entry.file.startsWith(".")) fail(`${path}.file`, "must be a plain .icc file name");
  }
}

const CHECK_STEPS = ["size", "resolution", "pdf", "bleed", "colour"];

function validateLines(lines, partners){
  object(partners, "CONFIG.partners");
  for(const [list, names] of Object.entries(partners)){
    array(names, `CONFIG.partners.${list}`).forEach((n, i) => string(n, `CONFIG.partners.${list}[${i}]`));
  }
  for(const [name, line] of Object.entries(object(lines, "CONFIG.lines"))){
    const path = `CONFIG.lines.${name}`;
    object(line, path);
    array(line.parts, `${path}.parts`).forEach((p, i) => string(p, `${path}.parts[${i}]`));
    array(line.steps, `${path}.steps`).forEach((step, i) => {
      const [kind, arg] = String(step).split(":");
      if(!(CHECK_STEPS.includes(step) || step === "approve" || ((kind === "back" || kind === "send") && arg))){
        fail(`${path}.steps[${i}]`, "must be a known step");
      }
      if(kind === "send" && !Array.isArray(partners[arg])) fail(`${path}.steps[${i}]`, `${step} needs CONFIG.partners.${arg}`);
    });
    (line.after || []).forEach((other, i) => { if(!lines[other] || other === name) fail(`${path}.after[${i}]`, "must name a line"); });
  }
}

function validatePlant(value){
  const plant = object(value, "CONFIG.plant");
  const imprint = object(plant.imprint, "CONFIG.plant.imprint");
  const imprintFields = [
    "recipientName", "addressLine1", "addressLine2", "addressLine3", "city",
    "stateProvince", "postalCode", "countryCode", "phone", "email", "vat"
  ];
  imprintFields.forEach(name => string(imprint[name], `CONFIG.plant.imprint.${name}`, name !== "recipientName"));

  const transfer = object(plant.transfer, "CONFIG.plant.transfer");
  for(const name of ["uploadUrl", "uploadEmail"]){
    string(transfer[name], `CONFIG.plant.transfer.${name}`, true);
  }
  array(transfer.services, "CONFIG.plant.transfer.services").forEach((service, i) => {
    const path = `CONFIG.plant.transfer.services[${i}]`;
    object(service, path);
    string(service.name, `${path}.name`);
    string(service.url, `${path}.url`);
    if(service.direct !== undefined && typeof service.direct !== "boolean") fail(`${path}.direct`, "must be a boolean");
  });
  if(!transfer.uploadUrl.trim() && (!transfer.services.length || !transfer.uploadEmail.trim())){
    fail("CONFIG.plant.transfer", "must provide uploadUrl or at least one service and uploadEmail");
  }
}

function validateAudioSpec(value){
  const audio = object(value, "CONFIG.audioSpec");
  const labels = array(audio.labels, "CONFIG.audioSpec.labels");
  if(!labels.length) fail("CONFIG.audioSpec.labels", "must not be empty");
  labels.forEach((label, i) => string(label, `CONFIG.audioSpec.labels[${i}]`));
  number(audio.minBitDepth, "CONFIG.audioSpec.minBitDepth");
  number(audio.recommendedBitDepth, "CONFIG.audioSpec.recommendedBitDepth");
  if(audio.recommendedBitDepth < audio.minBitDepth) fail("CONFIG.audioSpec.recommendedBitDepth", "must not be below minBitDepth");
  number(audio.minSampleRateHz, "CONFIG.audioSpec.minSampleRateHz");
}

function validateFileTypes(value, path){
  const types = object(value, path);
  string(types.accept, `${path}.accept`);
  const labels = array(types.labels, `${path}.labels`);
  if(!labels.length) fail(`${path}.labels`, "must not be empty");
  labels.forEach((label, i) => string(label, `${path}.labels[${i}]`));
}

function validateInfoText(value){
  const entries = object(value, "CONFIG.infoText");
  for(const [key, entry] of Object.entries(entries)){
    object(entry, `CONFIG.infoText.${key}`);
    string(entry.en, `CONFIG.infoText.${key}.en`);
  }
}

export function validateConfig(config){
  object(config, "CONFIG");
  validatePlant(config.plant);
  validateAudioSpec(config.audioSpec);

  const formats = array(config.formats, "CONFIG.formats");
  const ids = new Set();
  let enabled = 0;
  formats.forEach((format, i) => {
    const path = `CONFIG.formats[${i}]`;
    object(format, path);
    string(format.id, `${path}.id`);
    if(ids.has(format.id)) fail("CONFIG.formats", `contains duplicate ID "${format.id}"`);
    ids.add(format.id);
    if(typeof format.enabled !== "boolean") fail(`${path}.enabled`, "must be a boolean");
    if(format.enabled) enabled++;
    if(format.rpm !== 33 && format.rpm !== 45) fail(`${path}.rpm`, "must be 33 or 45");
    if(format.recommendedRpm !== undefined && format.recommendedRpm !== 33 && format.recommendedRpm !== 45){
      fail(`${path}.recommendedRpm`, "must be 33 or 45");
    }
    const centerHole = object(format.centerHole, `${path}.centerHole`);
    number(centerHole.normal, `${path}.centerHole.normal`);
    if(centerHole.big !== undefined) number(centerHole.big, `${path}.centerHole.big`);
    if(format.bigCenterDefault !== undefined){
      if(typeof format.bigCenterDefault !== "boolean") fail(`${path}.bigCenterDefault`, "must be a boolean");
      if(format.bigCenterDefault && centerHole.big === undefined) fail(`${path}.bigCenterDefault`, "needs centerHole.big");
    }
    validateTimeLimits(format.timeLimits, `${path}.timeLimits`);
    validatePrintCheck(format.printCheck, `${path}.printCheck`);
    validateProducts(object(format.printableParts, `${path}.printableParts`), `${path}.printableParts`);
    const proofs = object(format.proofs, `${path}.proofs`);
    for(const name of ["referenceCut", "testpress"]){
      if(typeof proofs[name] !== "boolean") fail(`${path}.proofs.${name}`, "must be a boolean");
    }
  });
  if(!enabled) fail("CONFIG.formats", "must contain at least one enabled format");

  validateFileTypes(config.artworkFileTypes, "CONFIG.artworkFileTypes");
  validateFileTypes(config.tracklistFileTypes, "CONFIG.tracklistFileTypes");
  const printSpec = object(config.printSpec, "CONFIG.printSpec");
  string(printSpec.colourProfile, "CONFIG.printSpec.colourProfile");
  if(typeof config.blockIncompleteArtworkOnSend !== "boolean") fail("CONFIG.blockIncompleteArtworkOnSend", "must be a boolean");

  validateVinylColor(config.vinylColor);
  validateProofs(config.proofs);
  validatePrintProfiles(config.printProfiles);
  validateLines(config.lines, config.partners);
  array(config.fixerStages, "CONFIG.fixerStages").forEach((s, i) => string(s, `CONFIG.fixerStages[${i}]`));

  string(config.locale, "CONFIG.locale");
  validateInfoText(config.infoText);
  return config;
}
