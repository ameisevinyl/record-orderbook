// Standard VAT rate (%) by ISO 3166 country code: the EU-27 plus GB and CH.
// Standard rates only — reduced rates and reverse charge come with the VAT
// logic; confirm the rate with the plant's tax advisor before relying on it.
export const STANDARD_VAT = {
  AT: 20, BE: 21, BG: 20, HR: 25, CY: 19, CZ: 21, DK: 25, EE: 24, FI: 25.5, FR: 20,
  DE: 19, GR: 24, HU: 27, IE: 23, IT: 22, LV: 21, LT: 21, LU: 17, MT: 18, NL: 21,
  PL: 23, PT: 23, RO: 21, SK: 23, SI: 22, ES: 21, SE: 25,
  GB: 20, CH: 8.1
};

export const standardVatRate = countryCode => STANDARD_VAT[countryCode];

// The pricelist's vat block for a country; rate null = no standard rate known.
export const vatFor = countryCode => ({ country: countryCode, rate: STANDARD_VAT[countryCode] ?? null });
