// Wix Data reads/writes over REST — the twin of app/wix/cms/items.ts. Same exports, same DTOs; the
// rules and mappers come from items-core (the SAME file the SDK transport uses, deployed flat next
// to this one by deploy.mjs --stack static), so this file is only the transport: one fetch with a
// literal body per function. The reads are safe from a browser with a visitor token on any
// collection whose read permission is ANYONE; the writes succeed only where the collection's
// insert/update/remove permission covers the caller (403 WDE0027 otherwise — a permissions step,
// not a code bug). Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-data-items.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/get-data-item.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/patch-data-item.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { DEFAULT_LIMIT, patchModifications, queryBody, restHasNext, restWriteData, toItem, toPage, type Raw } from "./items-core.js";
import type { CmsFilter, CmsItem, CmsPage, CmsQuery } from "./types.js";

const notFound = (e: unknown): boolean => e instanceof WixApiError && e.status === 404;

/**
 * Query one page of a collection. An empty result on a PUBLIC collection is a seed permissions bug
 * (read must be "ANYONE"), not a query bug.
 * POST /wix-data/v2/items/query  { dataCollectionId, query: { filter, sort, paging: { limit, offset } }, includeReferences: [{ field }], returnTotalCount }
 * → { dataItems: [{ id, dataCollectionId, data: { _id, …fields } }], pagingMetadata: { count, offset, total?, hasNext } }
 */
export async function queryItems(collectionId: string, query: CmsQuery = {}): Promise<CmsPage> {
  const { limit = DEFAULT_LIMIT, skip = 0 } = query;
  const res = await wixRequest<Raw>("/wix-data/v2/items/query", { body: queryBody(collectionId, query) });
  const items = ((res?.dataItems ?? []) as Raw[]).map((d) => d.data ?? {});
  return toPage(items, restHasNext(res?.pagingMetadata, skip, limit), res?.pagingMetadata?.total, imgSrc);
}

/**
 * Fetch one item by `_id`. Null when not found (404 WDE0073).
 * GET /wix-data/v2/items/{id}?dataCollectionId=…&includeReferences.field=…  → { dataItem: { data } }
 */
export async function getItemById(
  collectionId: string,
  itemId: string,
  { include = [] }: { include?: string[] } = {},
): Promise<CmsItem | null> {
  try {
    const res = await wixRequest<Raw>(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
      method: "GET",
      query: { dataCollectionId: collectionId, ...(include.length ? { "includeReferences.field": include } : {}) },
    });
    return res?.dataItem?.data ? toItem(res.dataItem.data, imgSrc) : null;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

/**
 * Fetch the first item whose `field` equals `value` — slug-style routing (Wix Data has no native
 * get-by-slug). Null when not found → render a not-found state, never invent an item.
 */
export async function getItemBy(
  collectionId: string,
  field: string,
  value: string | number,
  { include = [] }: { include?: string[] } = {},
): Promise<CmsItem | null> {
  const page = await queryItems(collectionId, { filters: [{ field, op: "eq", value }], limit: 1, include });
  return page.items[0] ?? null;
}

/** Count items matching the filters — empty-state logic and result counts (returnTotalCount). */
export async function countItems(collectionId: string, filters: CmsFilter[] = []): Promise<number> {
  const page = await queryItems(collectionId, { filters, limit: 1, withTotal: true });
  return page.total ?? page.items.length;
}

/**
 * Insert an item (visitor form / member submission). Never set `_owner` — Wix stamps it from the
 * caller's identity. Date fields must be Date objects (the core spells them `{ $date }` on the wire;
 * an ISO string is stored as text and breaks date queries).
 * POST /wix-data/v2/items  { dataCollectionId, dataItem: { data } }  → { dataItem: { data } }
 */
export async function insertItem(collectionId: string, data: Record<string, unknown>): Promise<CmsItem> {
  const res = await wixRequest<Raw>("/wix-data/v2/items", { body: { dataCollectionId: collectionId, dataItem: { data: restWriteData(data) } } });
  return toItem(res?.dataItem?.data ?? {}, imgSrc);
}

/**
 * REPLACE an item — fields omitted from `item` are WIPED (update does not patch). Spread the full
 * item you hold and override; for an id + a few changed fields use patchItemFields. Wrap each date
 * field back into a Date (`new Date(iso)`) before updating.
 * PUT /wix-data/v2/items/{id}  { dataCollectionId, dataItem: { id, data } }  → { dataItem: { data } }
 */
export async function updateItem(collectionId: string, item: CmsItem): Promise<CmsItem> {
  const res = await wixRequest<Raw>(`/wix-data/v2/items/${encodeURIComponent(item._id)}`, {
    method: "PUT",
    body: { dataCollectionId: collectionId, dataItem: { id: item._id, data: restWriteData(item) } },
  });
  return toItem(res?.dataItem?.data ?? {}, imgSrc);
}

/**
 * Patch only the named fields — the safe partial change.
 * PATCH /wix-data/v2/items/{id}  { dataCollectionId, patch: { dataItemId, fieldModifications: [{ fieldPath, action: "SET_FIELD", setFieldOptions: { value } }] } }
 */
export async function patchItemFields(
  collectionId: string,
  itemId: string,
  fields: Record<string, unknown>,
): Promise<CmsItem> {
  const res = await wixRequest<Raw>(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: { dataCollectionId: collectionId, patch: { dataItemId: itemId, fieldModifications: patchModifications(fields) } },
  });
  return toItem(res?.dataItem?.data ?? {}, imgSrc);
}

/**
 * Remove an item by `_id`. Irreversible. Returns the removed item (null if it didn't exist).
 * DELETE /wix-data/v2/items/{id}?dataCollectionId=…  → { dataItem: { data } }
 */
export async function removeItem(collectionId: string, itemId: string): Promise<CmsItem | null> {
  try {
    const res = await wixRequest<Raw>(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, { method: "DELETE", query: { dataCollectionId: collectionId } });
    return res?.dataItem?.data ? toItem(res.dataItem.data, imgSrc) : null;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}
