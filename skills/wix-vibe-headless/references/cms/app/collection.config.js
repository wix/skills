// collection.config.js — THE data surface. This is where you point the shipped list + detail at
// YOUR Wix CMS collection and map its field keys to the roles the UI renders. Edit this file; do
// NOT edit the components. It is the data-side equivalent of the design tokens in `index.css`: one
// place, and the whole client follows.
//
// The item shape is USER-DEFINED — the field keys below are the ones from your own seed / design
// plan for this collection. Carry that plan forward as the canonical list; don't guess keys or
// reverse-engineer them from a single fetched row.

// The collection NAME from your Wix dashboard (CMS → Content Manager), e.g. "Recipes", "Posts".
// NOT a GUID — the name is the id in Wix Data.
export const COLLECTION_ID = "<YOUR-COLLECTION>";

// Map your collection's field keys → the roles the shipped UI renders. Any role you set to null is
// skipped (the UI just omits it). `title` is the only required role.
export const FIELDS = {
  title:   "title",         // required — card heading + detail heading
  image:   "image",         // media field (wix:image:// or https URL) — null if the collection has none
  summary: "description",   // short text shown on the card
  body:    "content",       // long HTML body shown on the detail page (rendered as HTML)
  date:    "publishDate",   // ISO date field shown as meta + used for the default sort
  slug:    "slug",          // human-readable field for detail URLs; null → routes fall back to _id
};

// Default list sort — an array of { fieldName, order: "ASC"|"DESC" } (Wix syntax, NOT Mongo
// { field: -1 }). null → collection/insertion order. Uses FIELDS.date when set.
export const SORT = FIELDS.date ? [{ fieldName: FIELDS.date, order: "DESC" }] : null;

// Route key for an item: the slug value when a slug field is mapped, else the item's `_id`.
// Both the card link and the detail route read this — one definition, so they can't drift.
export const itemKey = (item) => (FIELDS.slug && item?.[FIELDS.slug]) || item?._id;
