import { wixApiRequest } from "./wix-client.js";

/**
 * Wix CMS (Wix Data) — thin REST helpers for reading and writing data items in a
 * site's data collections. The direct analog of `wix-store.js`, but for the generic
 * content layer instead of a product catalog.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COLLECTIONS & PERMISSIONS — read this first.
 *
 * A collection (e.g. "Tutorials", "TeamMembers", "ContactForm") is identified by its
 * `dataCollectionId` — the collection name the site owner set in the dashboard, NOT a
 * GUID. You pass it to every call. Field keys (e.g. "title", "publishDate") are also
 * set in the dashboard; read them off the items you fetch, or from the collection
 * schema (see "Beyond the snippets" in SKILL.md).
 *
 * Every collection has per-role PERMISSIONS for Read / Insert / Update / Delete. This
 * skill runs as an ANONYMOUS VISITOR, so a call only succeeds if the collection grants
 * that action to "Anyone":
 *   - Listing/reading public content  → Read must be "Anyone".
 *   - A public form (contact, RSVP)    → Insert must be "Anyone".
 *   - Update/Delete by a visitor       → rarely granted to "Anyone"; usually admin- or
 *                                         author-only. Expect these to fail unless the
 *                                         collection is explicitly opened up.
 * A permission-denied call throws (HTTP 403) — that's by design, not a bug. The site
 * owner sets permissions in the Wix dashboard (CMS → collection → Permissions). See:
 * https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-permissions/data-permissions-object.md
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Wix Data Item — the shape returned by every read helper here.
 * Full reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/data-item-object.md
 *
 * Helpers in this file return the item's `data` payload directly (the object below),
 * which is the flat bag of field values PLUS these read-only system fields:
 *
 *   _id           {string}  Item GUID. Use it as the route key for detail pages and as
 *                           the `itemId` for getDataItem / updateDataItem / removeDataItem.
 *   _createdDate  {string}  ISO 8601 — when the item was added. Serialized as { $date: "..." }
 *                           in filters; returned as an ISO string in the payload.
 *   _updatedDate  {string}  ISO 8601 — when the item was last modified.
 *   _ownerId      {string}  GUID of the user who created the item.
 *   ...fields                Every collection field, keyed by its field key, e.g.
 *                           { title: "Hello", body: "...", publishDate: "2026-01-02T..." }.
 *
 * Field VALUE TYPES follow the collection's field types (text, number, boolean, date,
 * URL, image/media, reference, multi-reference, array, object). Image fields hold a Wix
 * media URL (e.g. "wix:image://..."); render via the Wix media URL or the field's
 * resolved URL. Reference fields hold the referenced item's `_id`; pass `includeReferences`
 * to queryDataItems to inline the full referenced item instead of just its id.
 * Data types: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-types-in-wix-data.md
 */

/**
 * FILTERS & SORT (Wix API Query Language) — used by queryDataItems / getDataItemBy / countDataItems.
 * Full reference: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/data-retrieval/about-the-wix-api-query-language.md
 *
 *   filter  {object}  Equality is `{ field: value }`. Operators are
 *                     `{ field: { $op: value } }`. Supported $ops:
 *                       $eq $ne $gt $gte $lt $lte    — comparison
 *                       $in $nin                      — value in / not in an array
 *                       $startsWith                   — string prefix (not case-sensitive)
 *                       $exists                       — field is present & non-null (true/false)
 *                       $isEmpty                      — string/array empty (true/false)
 *                       $hasSome $hasAll              — array contains some / all of the values
 *                     Combine clauses with $and / $or / $not (arrays of filter objects).
 *                     Dates must be `{ "$date": "2026-05-05T00:00:00.000Z" }`.
 *                     Example: { category: "guides", views: { $gte: 100 } }
 *   sort    {Array}   [{ fieldName: "publishDate", order: "DESC" }, ...]. order is
 *                     "ASC" | "DESC" (default ASC). Earlier entries take precedence.
 */

/**
 * Query one page of items from a collection.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-data-items.md
 *
 * Pass `nextCursor` back as `cursor` to load the next page. Define `filter`/`sort`/`fields`
 * on the FIRST request only — on cursor follow-ups Wix reuses the original query and
 * ignores them (so this helper omits them when a cursor is supplied).
 *
 * @param {string} dataCollectionId  Collection name (e.g. "Tutorials").
 * @param {{
 *   filter?: object,
 *   sort?: Array<{ fieldName: string, order?: "ASC"|"DESC" }>,
 *   limit?: number,
 *   cursor?: string,
 *   fields?: string[],
 *   includeReferences?: Array<{ field: string, limit?: number }>
 * }} [options]
 * @returns {Promise<{ items: object[], nextCursor: string|null }>}  items are `data` payloads (each includes `_id`).
 */
export async function queryDataItems(dataCollectionId, { filter, sort, limit = 100, cursor, fields, includeReferences } = {}) {
  const query = {
    ...(cursor
      ? {}
      : {
          ...(filter ? { filter } : {}),
          ...(sort ? { sort } : {}),
          ...(fields ? { fields } : {}),
        }),
    cursorPaging: cursor ? { limit, cursor } : { limit },
  };
  const res = await wixApiRequest("/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId,
      query,
      ...(includeReferences ? { includeReferences } : {}),
    },
  });
  return {
    items: (res?.dataItems ?? []).map((d) => d.data),
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
}

/**
 * Get a single item by its `_id`. Returns the `data` payload, or null if not found
 * (or not readable by an anonymous visitor — see the permissions note up top).
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/get-data-item.md
 *
 * @param {string} dataCollectionId
 * @param {string} itemId            The item's `_id`.
 * @returns {Promise<object|null>}
 */
export async function getDataItem(dataCollectionId, itemId) {
  try {
    const res = await wixApiRequest(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
      method: "GET",
      query: { dataCollectionId },
    });
    return res?.dataItem?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the first item whose `fieldKey` equals `value`. Use for slug-style routing —
 * Wix Data has no native get-by-slug, so detail pages keyed off a human-readable field
 * (e.g. a "slug" or "handle" field) resolve through this. Returns the `data` payload or null.
 * Built on Query Data Items: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-data-items.md
 *
 * @param {string} dataCollectionId
 * @param {string} fieldKey   Field to match (e.g. "slug").
 * @param {unknown} value     Value to match.
 * @returns {Promise<object|null>}
 */
export async function getDataItemBy(dataCollectionId, fieldKey, value) {
  const { items } = await queryDataItems(dataCollectionId, { filter: { [fieldKey]: value }, limit: 1 });
  return items[0] ?? null;
}

/**
 * Count items in a collection matching an optional filter. Use for empty-state logic
 * (0 → prompt the user to add items in their Wix dashboard) and result counts.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/count-data-items.md
 *
 * @param {string} dataCollectionId
 * @param {object} [filter]  Same filter syntax as queryDataItems.
 * @returns {Promise<number>}
 */
export async function countDataItems(dataCollectionId, filter) {
  const res = await wixApiRequest("/wix-data/v2/items/count", {
    method: "POST",
    body: { dataCollectionId, ...(filter ? { filter } : {}) },
  });
  return res?.totalCount ?? 0;
}

/**
 * Insert a new item (e.g. a public form submission). The collection's Insert permission
 * must be "Anyone" for this to succeed as a visitor. Returns the inserted `data` payload
 * (including the assigned `_id`). Throws on failure (e.g. permission denied, validation).
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/insert-data-item.md
 *
 * @param {string} dataCollectionId
 * @param {object} data   Field-keyed values, e.g. { name, email, message }. Omit `_id`
 *                        to let Wix assign one; supply `_id` only for a custom GUID.
 * @returns {Promise<object>}  The inserted item's `data` payload.
 */
export async function insertDataItem(dataCollectionId, data) {
  const res = await wixApiRequest("/wix-data/v2/items", {
    method: "POST",
    body: { dataCollectionId, dataItem: { data } },
  });
  const inserted = res?.dataItem?.data;
  if (!inserted) throw new Error(`Insert into "${dataCollectionId}" failed (no item returned).`);
  return inserted;
}

/**
 * Update (REPLACE) an existing item by `_id`. Returns the updated `data` payload. Throws
 * if the item doesn't exist or the visitor lacks Update permission (usually admin/author only).
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/update-data-item.md
 *
 * ⚠ This is a FULL REPLACE: the new `data` overwrites the whole item, and any field NOT
 * included is dropped. To change a few fields, fetch the item first (getDataItem), spread
 * it, then pass the merged object — or use Patch Data Item for a partial change:
 * https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/patch-data-item.md
 *
 * @param {string} dataCollectionId
 * @param {string} itemId   The item's `_id`.
 * @param {object} data     The complete new field set.
 * @returns {Promise<object>}  The updated item's `data` payload.
 */
export async function updateDataItem(dataCollectionId, itemId, data) {
  const res = await wixApiRequest(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: { dataCollectionId, dataItem: { id: itemId, data: { ...data, _id: itemId } } },
  });
  const updated = res?.dataItem?.data;
  if (!updated) throw new Error(`Update of "${itemId}" in "${dataCollectionId}" failed (no item returned).`);
  return updated;
}

/**
 * Remove an item by `_id`. Irreversible. Returns the removed `data` payload. Throws if the
 * visitor lacks Delete permission (usually admin/author only).
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/remove-data-item.md
 *
 * @param {string} dataCollectionId
 * @param {string} itemId   The item's `_id`.
 * @returns {Promise<object|null>}  The removed item's `data` payload.
 */
export async function removeDataItem(dataCollectionId, itemId) {
  const res = await wixApiRequest(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    query: { dataCollectionId },
  });
  return res?.dataItem?.data ?? null;
}
