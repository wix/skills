import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Forms — the form SCHEMA: read a form, on the plain anonymous visitor token this skill already
 * mints. No SDK, no backend, no elevate. **The write path lives next door in
 * `wix-forms-submissions.js`.**
 *
 * WHY THIS VERTICAL EXISTS: a visitor-fillable form is Wix Forms, not a CMS collection. The owner
 * edits fields in the Wix dashboard, submissions land in their Forms inbox with spam protection
 * and notifications, and the frontend re-renders from the live schema with no code change.
 * Use `cms` only for content the app itself stores and READS BACK (listings, galleries, "my items").
 *
 * ⚠️ CRITICAL — the visitor token is enough, and the docs say otherwise. The API spec lists every
 * schema read (`GetForm`/`ListForms`) under the owner scope `SCOPE.FORMS.VIEW-FORM`. In practice
 * they return 200 on an anonymous visitor token — Wix grants implicit visitor access so a published
 * site can render its own forms. Trust the live 200, not the permission table. Do NOT add a backend,
 * a connector token, or any elevated credential to make a form work.
 *
 * READING the schema is `lib/wix-form-schema-utils.js` (plain accessors over the raw fields) and checking
 * values against it is `hooks/useWixForm.js`. This file stays the transport, plus the phone helpers
 * both sides need — `normalizePhone` for the value that goes on the wire, `phoneExample` for the one
 * shown to a visitor.
 *
 * Form object: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-object.md
 * Form fields: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md
 */

/** The Wix Forms app namespace. Every form this vertical touches lives here. */
export const FORMS_NAMESPACE = "wix.form_app.form";

/**
 * Read one form schema by id. Returns the `Form` directly (the REST envelope's `form` is unwrapped
 * for you), or throws — a 404 `FORM_NOT_FOUND` means the id is wrong or the form was deleted.
 * Reference: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form.md
 *
 * @param {string} formId  The form's GUID (from the seed's `seeded.forms[].formId`).
 * @returns {Promise<object>}  The Form: `{ id, formFields[], steps[], … }`.
 */
export async function getForm(formId) {
  const res = await wixApiRequest(`/form-schema-service/v4/forms/${encodeURIComponent(formId)}`, {
    method: "GET",
  });
  const form = res?.form;
  if (!form) throw new Error(`Form "${formId}" not found.`);
  return form;
}

/**
 * List form schemas in the namespace. Use ONE call for several forms on a page rather than one
 * `getForm` each; pass no `formIds` to discover every form the site has.
 * Reference: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms.md
 *
 * ⚠️ Returns only ENABLED forms by default — a form the owner disabled silently vanishes from a
 * discovery listing rather than erroring. That's usually right for a public site.
 *
 * @param {{ formIds?: string[], namespace?: string }} [options]  `formIds` takes up to 100 ids.
 * @returns {Promise<object[]>}  Array of Form objects (the envelope's `forms`, unwrapped).
 */
export async function listForms({ formIds, namespace = FORMS_NAMESPACE } = {}) {
  const res = await wixApiRequest("/form-schema-service/v4/forms", {
    method: "GET",
    query: { namespace, ...(formIds?.length ? { formIds } : {}) },
  });
  return res?.forms ?? [];
}

/**
 * Phone examples shown to visitors (placeholder + error copy). Every value is a regulator-RESERVED
 * fictional number for that country, so no real subscriber is ever printed.
 *
 * ⚠️ Never hardcode a user-visible example to one locale — a `+44`- or US-shaped example on a site
 * in another market is a locale bug. Add a market only after verifying its reserved range in the
 * national numbering plan; never invent a number. Never SUBMIT one either: a reserved number is
 * rejected (see `validateField` in `hooks/useWixForm.js`), so these are display-only.
 */
export const PHONE_EXAMPLE = {
  US: "+1 201 555 0123", CA: "+1 416 555 0123", // NANP 555-0100–0199 reserved for fiction
  GB: "+44 7700 900123",                        // Ofcom drama range 07700 900xxx
  IE: "+353 20 910 0001",                       // ComReg reserved 020 91x xxxx
  AU: "+61 491 570 006",                        // ACMA reserved mobile range
  FR: "+33 1 99 00 00 01",                      // ARCEP Île-de-France 01 99 00 xx xx reserved
  DE: "+49 30 23125 000",                       // BNetzA Berlin 030 23125 xxx reserved
  SE: "+46 70 174 06 05",                       // PTS reserved 070 174 06xx
  KR: "+82 2 540 0000",                         // Seoul 02-540-xxxx reserved
};

/**
 * The site's country (ISO-3166 alpha-2), used for any locale-derived example. Set it once from the
 * business you're building for — the browser's own locale is the VISITOR's, not the site's.
 * @type {string}
 */
export let SITE_COUNTRY = "US";
/** Set the site's country once at app start, e.g. `setSiteCountry("GB")`. */
export function setSiteCountry(code) {
  if (code) SITE_COUNTRY = code.toUpperCase();
}

/**
 * The example phone number for a country (ISO-3166 alpha-2), falling back to the site's and then to
 * the US. Pass a PHONE field's own country when it has one — `phoneCountryOf(field)` in
 * `lib/wix-form-schema-utils.js` reads it — so the example shown is one that field would accept.
 */
export function phoneExample(country) {
  return PHONE_EXAMPLE[country ?? SITE_COUNTRY] ?? PHONE_EXAMPLE[SITE_COUNTRY] ?? PHONE_EXAMPLE.US;
}

/** Strip visitor-added formatting from a phone number — submit this, not the raw value. */
export const normalizePhone = (v) => String(v ?? "").replace(/[\s()\-.]/g, "");
