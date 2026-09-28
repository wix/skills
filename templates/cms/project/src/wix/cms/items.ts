// Wix Data reads/writes (@wix/data `items`) over the SDK — the only file that touches raw data
// items on this transport. CMS is schema-generic: every function takes the collection id from the
// seed plan (seed/SEED.md) and returns plain CmsItem DTOs from ./types. The rules and mappers live
// in ./items-core (shared with the REST twin in templates/cms/rest/); this file is the transport
// only. Copy as-is; extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/sdk/business-solutions/data/items/query.md
// docs: https://dev.wix.com/docs/sdk/business-solutions/data/items/update.md
import { items as itemsModule } from "@wix/data";
import { wixModule } from "../sdk";
import { imgRatio, imgSrc } from "../media";
import { DEFAULT_LIMIT, DISTINCT_LIMIT, assertFilterValue, betweenRange, toItem, toValues, type Media, type Raw } from "./items-core";
import type { CmsFilter, CmsItem, CmsPage, CmsQuery } from "./types";

const items = wixModule(itemsModule);
const media: Media = { imgSrc, imgRatio };

/** The query builder with every predicate applied — one place for the op → builder mapping (query, count, distinct). */
function withFilters(collectionId: string, filters: CmsFilter[]) {
  let q = items.query(collectionId);
  for (const f of filters) {
    assertFilterValue(f);
    const v = f.value as any;
    switch (f.op) {
      case "eq": q = q.eq(f.field, v); break;
      case "ne": q = q.ne(f.field, v); break;
      case "gt": q = q.gt(f.field, v); break;
      case "ge": q = q.ge(f.field, v); break;
      case "lt": q = q.lt(f.field, v); break;
      case "le": q = q.le(f.field, v); break;
      case "contains": q = q.contains(f.field, v); break;
      case "startsWith": q = q.startsWith(f.field, v); break;
      case "endsWith": q = q.endsWith(f.field, v); break;
      // `in` rides hasSome, as Wix's own CMS components map it: on a scalar field hasSome matches a
      // value equal to ANY of the list (the builder's own in() is not in its public type).
      case "in": q = q.hasSome(f.field, v); break;
      case "hasSome": q = q.hasSome(f.field, v); break;
      case "hasAll": q = q.hasAll(f.field, v); break;
      case "between": {
        // The builder spells between as ge(start) + lt(end): start inclusive, end exclusive.
        const [start, end] = betweenRange(f);
        q = q.between(f.field, start as any, end as any);
        break;
      }
      case "isEmpty": q = q.isEmpty(f.field); break;
      case "isNotEmpty": q = q.isNotEmpty(f.field); break;
    }
  }
  return q;
}

/**
 * Query one page of a collection. An empty result on a PUBLIC collection is a seed
 * permissions bug (read must be "ANYONE"), not a query bug — never reach for auth.elevate.
 */
export async function queryItems(collectionId: string, query: CmsQuery = {}): Promise<CmsPage> {
  const { filters = [], sort = [], limit = DEFAULT_LIMIT, skip = 0, include = [], withTotal = false } = query;
  let q = withFilters(collectionId, filters);
  for (const s of sort) q = s.direction === "desc" ? q.descending(s.field) : q.ascending(s.field);
  if (include.length) q = q.include(...include);
  const res = await q.limit(limit).skip(skip).find(withTotal ? { returnTotalCount: true } : undefined);
  return {
    items: (res.items ?? []).map((r: Raw) => toItem(r, media)),
    hasNext: res.hasNext(),
    total: res.totalCount ?? null,
  };
}

/**
 * Fetch one item by `_id`. Null when not found. `includeReferences` is the get request's key in the
 * installed typings (`includeReferencedItems` is the deprecated one) — confirm once on a live site
 * that get honours it; if the referenced fields come back as ids, route through getItemBy("_id", …).
 */
export async function getItemById(
  collectionId: string,
  itemId: string,
  { include = [] }: { include?: string[] } = {},
): Promise<CmsItem | null> {
  const raw = await items.get(collectionId, itemId, {
    ...(include.length ? { includeReferences: include.map((field) => ({ field })) } : {}),
  });
  return raw ? toItem(raw as Raw, media) : null;
}

/**
 * Fetch the first item whose `field` equals `value` — slug-style routing (Wix Data has no
 * native get-by-slug). Null when not found → render a not-found state, never invent an item.
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

/** Count items matching the filters — the builder's count(), no items transferred. */
export async function countItems(collectionId: string, filters: CmsFilter[] = []): Promise<number> {
  return withFilters(collectionId, filters).count();
}

/**
 * The distinct values a field holds across the collection (optionally within `filters`) — filter
 * chips and selects from live data, not from the page in hand. Values normalized like item values
 * (a DATE field's → ISO strings); a reference field yields ids.
 */
export async function distinctValues(
  collectionId: string,
  field: string,
  { filters = [], limit = DISTINCT_LIMIT }: { filters?: CmsFilter[]; limit?: number } = {},
): Promise<unknown[]> {
  const res = await withFilters(collectionId, filters).limit(limit).distinct(field);
  return toValues(res.items ?? [], media);
}

/**
 * Insert an item (visitor form / member submission). Succeeds only when the collection's
 * insert permission covers the caller (403 otherwise — a seed permissions step, not a code
 * bug). Never set `_owner` — Wix stamps it from the caller's identity.
 * Date fields must be Date objects (an ISO string is stored as text and breaks date queries).
 * A MULTI_REFERENCE value inside `data` is DROPPED by the insert endpoint (200, no error) — pass
 * those as `link: { field: [referencedIds] }` and they are linked right after the insert (create,
 * then link). The returned item predates the links: re-read with `include` to see them.
 */
export async function insertItem(
  collectionId: string,
  data: Record<string, unknown>,
  { link = {} }: { link?: Record<string, string[]> } = {},
): Promise<CmsItem> {
  const created = await items.insert(collectionId, data as Raw);
  const item = toItem(created as Raw, media);
  for (const [field, refIds] of Object.entries(link)) await linkItems(collectionId, field, item._id, refIds);
  return item;
}

/**
 * REPLACE an item — fields omitted from `item` are WIPED (update does not patch). Spread the
 * full item you hold and override; for an id + a few changed fields use patchItemFields.
 * A round-tripped DTO carries dates as ISO strings — wrap each date field back
 * (`new Date(iso)`) before updating, or the DATE field is silently rewritten as text.
 */
export async function updateItem(collectionId: string, item: CmsItem): Promise<CmsItem> {
  const updated = await items.update(collectionId, item as Raw & { _id: string });
  return toItem(updated as Raw, media);
}

/** Patch only the named fields — the safe partial change (no replace-wipes-fields footgun). */
export async function patchItemFields(
  collectionId: string,
  itemId: string,
  fields: Record<string, unknown>,
): Promise<CmsItem> {
  const entries = Object.entries(fields);
  if (!entries.length) throw new Error("cms: patchItemFields called with no fields.");
  let p = items.patch(collectionId, itemId);
  for (const [k, v] of entries) p = p.setField(k, v);
  const patched = await p.run();
  return toItem(patched as Raw, media);
}

/** Remove an item by `_id`. Irreversible. Returns the removed item (null if it didn't exist). */
export async function removeItem(collectionId: string, itemId: string): Promise<CmsItem | null> {
  const removed = await items.remove(collectionId, itemId);
  return removed ? toItem(removed as Raw, media) : null;
}

/**
 * Add references to a MULTI_REFERENCE field of `itemId` — the only way a multi-reference is set
 * (insert/update drop the value silently). Existing references stay; needs the collection's update
 * permission. A no-op for an empty list.
 */
export async function linkItems(collectionId: string, field: string, itemId: string, refIds: string[]): Promise<void> {
  if (!refIds.length) return;
  await items.insertReference(collectionId, field, itemId, refIds);
}

/** Remove references from a MULTI_REFERENCE field of `itemId`. Other references stay. A no-op for an empty list. */
export async function unlinkItems(collectionId: string, field: string, itemId: string, refIds: string[]): Promise<void> {
  if (!refIds.length) return;
  await items.removeReference(collectionId, field, itemId, refIds);
}
