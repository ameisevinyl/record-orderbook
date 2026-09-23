export const PROJECT_VERSION = 1;

export function includeSideFile({forSend, blank, continuous, kind}){
  if(!forSend) return true;
  if(blank) return false;
  return kind === "continuous" ? continuous : !continuous;
}

function isObject(value){
  if(value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clonePlain(value, path = "project"){
  if(Array.isArray(value)) return value.map((item, i) => clonePlain(item, `${path}[${i}]`));
  if(isObject(value)){
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePlain(item, `${path}.${key}`)]));
  }
  if(value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
  throw new TypeError(`${path} must contain only plain project data`);
}

function objectOrEmpty(value, path){
  if(value === undefined) return {};
  if(!isObject(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function arrayOrEmpty(value, path){
  if(value === undefined) return [];
  if(!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
}

function text(value, path, fallback = ""){
  if(value == null) return fallback;
  if(typeof value === "string") return value;
  if(typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new TypeError(`${path} must be text`);
}

function bool(value, path, fallback = false){
  if(value === undefined) return fallback;
  if(typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
  return value;
}

function fileName(value, path){
  if(value == null) return null;
  if(typeof value !== "string") throw new TypeError(`${path} must be a filename or null`);
  return value;
}

function validateProduct(id, products, label, formatId){
  if(id == null) return;
  if(typeof id !== "string" || !products.some(product => product.id === id)){
    throw new Error(`Unknown ${label} product ID "${String(id)}" for format "${formatId}"`);
  }
}

export function prepareProject(raw, config){
  if(!isObject(raw)) throw new TypeError("Project must be an object");

  const version = raw.projectVersion === undefined ? 0 : raw.projectVersion;
  if(!Number.isInteger(version) || version < 0) throw new Error(`Invalid project version: ${String(version)}`);
  if(version > PROJECT_VERSION) throw new Error(`Unsupported project version: ${version}`);

  const project = clonePlain(raw);
  const formats = config && Array.isArray(config.formats) ? config.formats : [];
  const format = formats.find(entry => entry.id === project.format);
  if(!format) throw new Error(`Unknown format ID "${String(project.format)}"`);

  project.projectVersion = PROJECT_VERSION;
  for(const field of ["catalogue", "albumTitle", "albumArtist", "notes"]){
    project[field] = text(project[field], `project.${field}`);
  }
  project.soundsystem = bool(project.soundsystem, "project.soundsystem");

  project.sides = objectOrEmpty(project.sides, "project.sides");
  for(const side of ["A", "B"]){
    const data = objectOrEmpty(project.sides[side], `project.sides.${side}`);
    data.blank = bool(data.blank, `project.sides.${side}.blank`);
    data.rpm = text(data.rpm, `project.sides.${side}.rpm`, String(format.rpm));
    if(data.rpm !== "33" && data.rpm !== "45") throw new Error(`project.sides.${side}.rpm must be 33 or 45`);
    data.matrixInscription = text(data.matrixInscription, `project.sides.${side}.matrixInscription`);
    data.matrixInscriptionAuto = bool(data.matrixInscriptionAuto, `project.sides.${side}.matrixInscriptionAuto`, true);
    data.continuous = bool(data.continuous, `project.sides.${side}.continuous`);
    data.continuousLength = text(data.continuousLength, `project.sides.${side}.continuousLength`);
    data.continuousFileName = fileName(data.continuousFileName, `project.sides.${side}.continuousFileName`);
    data.continuousOriginalFileName = fileName(data.continuousOriginalFileName, `project.sides.${side}.continuousOriginalFileName`);
    data.tracks = arrayOrEmpty(data.tracks, `project.sides.${side}.tracks`);
    data.tracks = data.tracks.map((track, i) => {
      const path = `project.sides.${side}.tracks[${i}]`;
      track = objectOrEmpty(track, path);
      for(const field of ["title", "artist", "length", "gapCustom"]){
        track[field] = text(track[field], `${path}.${field}`, field === "gapCustom" ? "2" : "");
      }
      track.gap = text(track.gap, `${path}.gap`, "2");
      if(!["0", "2", "custom"].includes(track.gap)) throw new Error(`${path}.gap must be 0, 2, or custom`);
      track.artistLinked = bool(track.artistLinked, `${path}.artistLinked`, true);
      track.fileName = fileName(track.fileName, `${path}.fileName`);
      track.originalFileName = fileName(track.originalFileName, `${path}.originalFileName`);
      return track;
    });
    project.sides[side] = data;
  }

  project.labels = objectOrEmpty(project.labels, "project.labels");
  project.labels.bigCenter = !!(format.centerHole && format.centerHole.big)
    && bool(project.labels.bigCenter, "project.labels.bigCenter");
  project.labels.sides = objectOrEmpty(project.labels.sides, "project.labels.sides");
  for(const side of ["A", "B"]){
    const path = `project.labels.sides.${side}`;
    const label = objectOrEmpty(project.labels.sides[side], path);
    label.whitelabel = bool(label.whitelabel, `${path}.whitelabel`);
    label.fileName = fileName(label.fileName, `${path}.fileName`);
    label.originalFileName = fileName(label.originalFileName, `${path}.originalFileName`);
    project.labels.sides[side] = label;
  }

  project.coverSleeve = objectOrEmpty(project.coverSleeve, "project.coverSleeve");
  const parts = format.printableParts || {};
  project.coverSleeve.cover = objectOrEmpty(project.coverSleeve.cover, "project.coverSleeve.cover");
  project.coverSleeve.innerSleeve = objectOrEmpty(project.coverSleeve.innerSleeve, "project.coverSleeve.innerSleeve");
  project.coverSleeve.inlay = objectOrEmpty(project.coverSleeve.inlay, "project.coverSleeve.inlay");
  project.coverSleeve.inlay.front = objectOrEmpty(project.coverSleeve.inlay.front, "project.coverSleeve.inlay.front");
  project.coverSleeve.inlay.back = objectOrEmpty(project.coverSleeve.inlay.back, "project.coverSleeve.inlay.back");
  validateProduct(project.coverSleeve.cover.productId, (parts.outerCover && parts.outerCover.products) || [], "cover", format.id);
  validateProduct(project.coverSleeve.innerSleeve.productId, (parts.innerSleeve && parts.innerSleeve.products) || [], "inner sleeve", format.id);
  validateProduct(project.coverSleeve.inlay.productId, (parts.inlay && parts.inlay.products) || [], "inlay", format.id);
  for(const [path, part] of [
    ["project.coverSleeve.cover", project.coverSleeve.cover],
    ["project.coverSleeve.innerSleeve", project.coverSleeve.innerSleeve]
  ]){
    part.fileName = fileName(part.fileName, `${path}.fileName`);
    part.originalFileName = fileName(part.originalFileName, `${path}.originalFileName`);
  }
  for(const side of ["front", "back"]){
    const path = `project.coverSleeve.inlay.${side}`;
    const part = project.coverSleeve.inlay[side];
    part.fileName = fileName(part.fileName, `${path}.fileName`);
    part.originalFileName = fileName(part.originalFileName, `${path}.originalFileName`);
  }

  project.vinylColor = arrayOrEmpty(project.vinylColor, "project.vinylColor");
  const vinylConfig = config.vinylColor || {};
  const colors = new Set([vinylConfig.standardColor, ...(vinylConfig.basicColors || []), "random"]);
  project.vinylColor = project.vinylColor.map((row, i) => {
    row = objectOrEmpty(row, `project.vinylColor[${i}]`);
    if(row.color == null) row.color = vinylConfig.standardColor;
    if(typeof row.color !== "string" || !colors.has(row.color)){
      throw new Error(`Unknown vinyl colour ID "${String(row.color)}"`);
    }
    row.qty = text(row.qty, `project.vinylColor[${i}].qty`);
    return row;
  });

  project.shippingBilling = objectOrEmpty(project.shippingBilling, "project.shippingBilling");
  project.shippingBilling.billing = objectOrEmpty(project.shippingBilling.billing, "project.shippingBilling.billing");
  project.shippingBilling.shipping = arrayOrEmpty(project.shippingBilling.shipping, "project.shippingBilling.shipping");
  project.shippingBilling.shipping = project.shippingBilling.shipping.map((address, i) => {
    address = objectOrEmpty(address, `project.shippingBilling.shipping[${i}]`);
    address.qtyByColor = objectOrEmpty(address.qtyByColor, `project.shippingBilling.shipping[${i}].qtyByColor`);
    for(const color of Object.keys(address.qtyByColor)){
      if(!colors.has(color)) throw new Error(`Unknown shipping vinyl colour ID "${color}"`);
      address.qtyByColor[color] = text(address.qtyByColor[color], `project.shippingBilling.shipping[${i}].qtyByColor.${color}`);
    }
    address.note = text(address.note, `project.shippingBilling.shipping[${i}].note`);
    address.sameAsBilling = bool(address.sameAsBilling, `project.shippingBilling.shipping[${i}].sameAsBilling`);
    return address;
  });

  const addressFields = [
    "recipientName", "attention", "addressLine1", "addressLine2", "addressLine3",
    "city", "stateProvince", "postalCode", "countryCode", "phone", "email", "vat", "eori"
  ];
  for(const [path, address] of [
    ["project.shippingBilling.billing", project.shippingBilling.billing],
    ...project.shippingBilling.shipping.map((entry, i) => [`project.shippingBilling.shipping[${i}]`, entry])
  ]){
    for(const field of addressFields) address[field] = text(address[field], `${path}.${field}`);
    address.isResidential = bool(address.isResidential, `${path}.isResidential`);
  }

  for(const name of referencedProjectFiles(project)){
    if(typeof name !== "string" || !name || name.includes("/") || name.includes("\\")){
      throw new Error(`Invalid canonical project filename: ${String(name)}`);
    }
  }
  return project;
}

export function referencedProjectFiles(project){
  const names = [];
  const add = name => { if(name != null) names.push(name); };
  for(const side of ["A", "B"]){
    const data = project.sides && project.sides[side];
    if(!data) continue;
    add(data.continuousFileName);
    for(const track of data.tracks || []) add(track && track.fileName);
  }
  for(const side of ["A", "B"]){
    add(project.labels && project.labels.sides && project.labels.sides[side] && project.labels.sides[side].fileName);
  }
  const sleeve = project.coverSleeve || {};
  add(sleeve.cover && sleeve.cover.fileName);
  add(sleeve.innerSleeve && sleeve.innerSleeve.fileName);
  add(sleeve.inlay && sleeve.inlay.front && sleeve.inlay.front.fileName);
  add(sleeve.inlay && sleeve.inlay.back && sleeve.inlay.back.fileName);
  return names;
}

function baseName(name){
  const slash = name.lastIndexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

export function assertProjectFiles(project, entries){
  if(!Array.isArray(entries)) throw new TypeError("Project entries must be an array");
  const entryNames = new Set();
  const names = new Set();
  for(let i = 0; i < entries.length; i++){
    const entry = entries[i];
    if(!entry || typeof entry.name !== "string" || !entry.name) throw new TypeError(`Project entry ${i + 1} has no valid name`);
    if(entryNames.has(entry.name)) throw new Error(`Duplicate project entry name: ${entry.name}`);
    entryNames.add(entry.name);
    if(entry.name.endsWith("/")) continue;
    const name = baseName(entry.name);
    if(names.has(name)) throw new Error(`Duplicate project entry name: ${name}`);
    names.add(name);
  }
  for(const name of referencedProjectFiles(project)){
    if(!names.has(name)) throw new Error(`Missing referenced project file: ${name}`);
  }
}
