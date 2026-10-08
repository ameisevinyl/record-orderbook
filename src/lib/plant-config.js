// Read and write src/plant.config.local.js (`export const PLANT_CONFIG = {…};`)
// so the pricelist editor can edit it. Pure.
import { validatePlant } from "./config-validation.js";

const HEADER = `// This plant's identity — saved by the pricelist editor. Put it at
// src/plant.config.local.js (gitignored) and run node build/build.js; the
// field comments live in plant.config.local.example.js.

`;

export function parsePlantConfig(text){
  const match = text.match(/export\s+const\s+PLANT_CONFIG\s*=\s*([\s\S]*?);?\s*$/);
  if(!match) throw new Error("expected `export const PLANT_CONFIG = { … };`");
  // The object literal is evaluated: it is the plant's own file (comments and
  // all), opened by the plant itself.
  const config = Function(`"use strict"; return (${match[1]});`)();
  validatePlant(config);
  return config;
}

export function formatPlantConfig(config){
  const body = JSON.stringify(config, null, 2)
    .replace(/^(\s*)"(\w+)":/gm, "$1$2:")
    .replace(/\{\s+name: ("[^"\n]*"),\s+url: ("[^"\n]*")\s+\}/g, "{ name: $1, url: $2 }");
  return `${HEADER}export const PLANT_CONFIG = ${body};\n`;
}
