import { wixApiRequest } from "./wix-client.js";

/**
 * Wix CMS (Wix Data) — REST helpers for reading and writing data items in site data collections.
 *
 * COLLECTIONS & PERMISSIONS: A collection (e.g. "Tutorials") is identified by its
 * dataCollectionId — the name set in the dashboard, NOT a GUID. Field keys are also set
 * in the dashboard. This skill runs as an ANONYMOUS VISITOR — a call only succeeds if the
 * collection grants that action to "Anyone" (Read for listing, Insert for forms, etc.).
 * Permission-denied throws HTTP 403 by design. Set permissions in Wix dashboard → CMS → Permissions.
 * https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-permissions/data-permissions-object.md
 *
 * Data Item — every read helper returns the item's `data` payload:
 *   _id {string} — GUID (route key, itemId for get/update/remove),
 *   _createdDate, _updatedDate {string} — ISO 8601 (use { "$date": "..." } in filters),
 *   _ownerId {string}, ...fields — collection field values keyed by field key
 * Full reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/data-item-object.md
 *
 * FILTERS & SORT (Wix API Query Language):
 *   filter: { field: value } for equality; { field: { $op: value } } for operators:
 *     $eq $ne $gt $gte $lt $lte $in $nin $startsWith $exists $isEmpty $hasSome $hasAll
 *   Combine with $and / $or / $not. Dates: { "$date": "2026-05-05T00:00:00.000Z" }.
 *   sort: [{ fieldName: "publishDate", order: "DESC" }]
 * Full reference: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/data-retrieval/about-the-wix-api-query-language.md
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
