// Address rules — the part of forms-core.ts that is about one field type, in its own file so each
// core file reads whole. Which subfields an address shows is per country: Wix's address field loads
// one of twelve templates by country (address-templates.generated.ts), and the submission API
// rejects any other key as "additional properties". Imported by forms-core.ts (toField) and the
// store (the parts are recomputed when the visitor picks a country); re-exported from forms-core.
import { ADDRESS_TEMPLATES } from "./address-templates.generated";
import type { FormAddressPart, AddressOverrides } from "./types";
import type { Raw } from "./forms-core";

/**
 * Every country an address may name when the owner set no `allowedCountries` — the list Wix's
 * own address field enumerates (form-multiline-address country-codes.ts). ISO 3166-1 alpha-2.
 */
export const COUNTRY_CODES: readonly string[] = ["AD","AE","AF","AG","AI","AL","AM","AN","AO","AQ","AR","AS","AT","AU","AW","AX","AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM","HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IS","IT","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","XK","YE","YT","ZA","ZM","ZW"];

/**
 * Every subfield an address can have. WHICH ones a given address shows is per country
 * (`addressPartsForCountry`): Wix's address field loads one of twelve templates by country, and
 * the submission API rejects any other key as "additional properties".
 */
export const ADDRESS_SUBFIELDS = ["country", "addressLine", "addressLine2", "streetName", "streetNumber", "city", "subdivision", "postalCode"] as const;

/** `postalCode` → "Postal code". A subfield is a key; the schema carries no label for it. */
export function humanizeSub(sub: string): string {
  const words = sub.replace(/([A-Z])|(\d+)/g, " $1$2").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * "US" → "United States". From the shipped data first — the same string on the server and in the
 * browser, which Intl.DisplayNames does not guarantee (Node and Chrome spell Hong Kong, Macao,
 * Palestine and the Falklands differently, and a server-rendered list the browser disagrees with
 * is a hydration mismatch). Intl for a code the data lacks; the code itself otherwise.
 */
export function countryName(code: string): string {
  const known = ADDRESS_TEMPLATES.countryNames[code];
  if (known) return known;
  try {
    const dn = (Intl as any).DisplayNames ? new (Intl as any).DisplayNames(["en"], { type: "region" }) : null;
    return (dn?.of(code) as string | undefined) ?? code;
  } catch {
    return code;
  }
}

/** The owner's address settings, as `addressPartsForCountry` needs them. */
export function addressOverrides(rules: Raw, component: Raw): AddressOverrides {
  const fields: Raw = rules.fields ?? {};
  const settings: Raw = component.fieldSettings ?? {};
  return {
    required: Object.fromEntries(Object.keys(fields).map((k) => [k, fields[k]?.required as boolean | undefined])),
    show: Object.fromEntries(Object.keys(settings).map((k) => [k, settings[k]?.show as boolean | undefined])),
    allowedCountries: Array.isArray(rules.allowedCountries) ? rules.allowedCountries.map(String) : [],
  };
}

/**
 * The subfields of an address for ONE country, in Wix's order: `country` first (Wix prepends it
 * to every template and requires it exactly when the address is required, get-country-field.ts),
 * then the country's template — Israel: street name, street number, city, postal code; the United
 * States: address line, city, state, postal code — with the owner's `validation.fields` deciding
 * requiredness and `fieldSettings` visibility over the template's defaults. A `subdivision` part
 * carries the country's states / provinces / regions as `choices` (ISO 3166-2 codes) when Wix has
 * them on record. No country yet → Wix's common template.
 */
export function addressPartsForCountry(country: string | undefined, o: AddressOverrides, required: boolean): FormAddressPart[] {
  const code = country ? country.toUpperCase() : "";
  const templateName = ADDRESS_TEMPLATES.byCountry[code] ?? ADDRESS_TEMPLATES.defaultTemplate;
  const template = ADDRESS_TEMPLATES.templates[templateName] ?? ADDRESS_TEMPLATES.templates[ADDRESS_TEMPLATES.defaultTemplate] ?? [];
  const allowed = o.allowedCountries.length ? o.allowedCountries : [...COUNTRY_CODES];
  const parts: FormAddressPart[] = [{
    sub: "country",
    label: "Country",
    required: o.required.country ?? required,
    choices: allowed.map((c) => ({ value: c, label: countryName(c) })),
  }];
  const subdivisions = ADDRESS_TEMPLATES.subdivisions[code];
  for (const t of template) {
    if (!(o.show[t.sub] ?? !t.hidden)) continue;
    const isSubdivision = t.sub === "subdivision";
    parts.push({
      sub: t.sub,
      label: isSubdivision && subdivisions ? subdivisions.label : humanizeSub(t.sub),
      required: o.required[t.sub] ?? t.required,
      ...(isSubdivision && subdivisions ? { choices: subdivisions.list.map(([k, name]) => ({ value: `${code}-${k}`, label: name })) } : {}),
    });
  }
  return parts;
}

export function addressParts(rules: Raw, component: Raw, required: boolean): FormAddressPart[] {
  // The owner's pre-selected country when the field has one; else the common template until the
  // visitor picks a country (the store recomputes the parts on every change).
  const preset = component.defaultCountryConfig?.countryOptions;
  return addressPartsForCountry(typeof preset === "string" ? preset : undefined, addressOverrides(rules, component), required);
}
