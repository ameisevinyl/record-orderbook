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

function validatePrintCheck(value, path){
  const printCheck = object(value, path);
  number(printCheck.sizeToleranceMm, `${path}.sizeToleranceMm`, true);
  const dpi = object(printCheck.dpi, `${path}.dpi`);
  number(dpi.min, `${path}.dpi.min`);
  number(dpi.max, `${path}.dpi.max`);
  if(dpi.min > dpi.max) fail(`${path}.dpi`, "min must not exceed max");

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
  for(const part of ["labels", "innerSleeve", "outerCover", "inlay"]){
    number(ink[part], `${path}.inkLimitPct.${part}`);
    if(ink[part] > 400) fail(`${path}.inkLimitPct.${part}`, "must not exceed 400");
  }
  const black = object(printCheck.black, `${path}.black`);
  number(black.kMinPct, `${path}.black.kMinPct`);
  number(black.cmyMaxPct, `${path}.black.cmyMaxPct`);
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

function validatePlant(value){
  const plant = object(value, "CONFIG.plant");
  const imprint = object(plant.imprint, "CONFIG.plant.imprint");
  const imprintFields = [
    "recipientName", "addressLine1", "addressLine2", "addressLine3", "city",
    "stateProvince", "postalCode", "countryCode", "phone", "email", "vat"
  ];
  imprintFields.forEach(name => string(imprint[name], `CONFIG.plant.imprint.${name}`, name !== "recipientName"));

  const transfer = object(plant.transfer, "CONFIG.plant.transfer");
  for(const name of ["uploadUrl", "uploadServiceUrl", "uploadEmail"]){
    string(transfer[name], `CONFIG.plant.transfer.${name}`, true);
  }
  if(!transfer.uploadUrl.trim() && (!transfer.uploadServiceUrl.trim() || !transfer.uploadEmail.trim())){
    fail("CONFIG.plant.transfer", "must provide uploadUrl or both uploadServiceUrl and uploadEmail");
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
    validateTimeLimits(format.timeLimits, `${path}.timeLimits`);
    validatePrintCheck(format.printCheck, `${path}.printCheck`);
    validateProducts(object(format.printableParts, `${path}.printableParts`), `${path}.printableParts`);
  });
  if(!enabled) fail("CONFIG.formats", "must contain at least one enabled format");

  validateFileTypes(config.artworkFileTypes, "CONFIG.artworkFileTypes");
  validateFileTypes(config.tracklistFileTypes, "CONFIG.tracklistFileTypes");
  const printSpec = object(config.printSpec, "CONFIG.printSpec");
  string(printSpec.colourProfile, "CONFIG.printSpec.colourProfile");
  if(typeof config.blockIncompleteArtworkOnSend !== "boolean") fail("CONFIG.blockIncompleteArtworkOnSend", "must be a boolean");

  validateVinylColor(config.vinylColor);

  string(config.locale, "CONFIG.locale");
  validateInfoText(config.infoText);
  return config;
}
