// Wix Data reads/writes (@wix/data `items`) — the only file that touches raw data items.
// CMS is schema-generic: every function takes the collection id from the seed plan
// (seed/SEED.md) and returns plain CmsItem DTOs from ./types. Copy as-is; extend by adding
// functions, not by editing these.
import { items as itemsModule } from "@wix/data";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type { CmsFilter, CmsItem, CmsPage, CmsQuery } from "./types";

const items = wixModule(itemsModule);

type Raw = Record<string, any>;

// SDK → DTO: the SDK decodes date fields into Date objects (not serializable as island
// props) and IMAGE fields arrive as wix:image:// identifiers a browser can't load
// (ERR_UNKNOWN_URL_SCHEME). Normalize recursively — included reference items too.
function toValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.startsWith("wix:image://")) return imgSrc(v, 1200, 900);
  if (Array.isArray(v)) return v.map(toValue);
  if (v && typeof v === "object") {
    const out: Raw = {};
    for (const [k, val] of Object.entries(v as Raw)) out[k] = toValue(val);
    return out;
  }
  return v;
}

const toItem = (raw: Raw): CmsItem => toValue(raw) as CmsItem;

// An undefined comparand silently changes what a query matches (every row, or none) with no
// server error — the classic "my items shows everyone's items" bug. Throw at the call site;
// omit the filter entirely when you don't hold a value yet.
function assertFilterValue(f: CmsFilter): void {
  if (f.op !== "isEmpty" && f.op !== "isNotEmpty" && f.value === undefined) {
    throw new Error(
      `cms: filter on "${f.field}" (${f.op}) has an undefined value — pass a real value or omit the filter.`,
    );
  }
}

/**
 * Query one page of a collection. An empty result on a PUBLIC collection is a seed
 * permissions bug (read must be "ANYONE"), not a query bug — never reach for auth.elevate.
 */
export async function queryItems(collectionId: string, query: CmsQuery = {}): Promise<CmsPage> {
  const { filters = [], sort = [], limit = 20, skip = 0, include = [], withTotal = false } = query;
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
      case "hasSome": q = q.hasSome(f.field, v); break;
      case "hasAll": q = q.hasAll(f.field, v); break;
      case "isEmpty": q = q.isEmpty(f.field); break;
      case "isNotEmpty": q = q.isNotEmpty(f.field); break;
    }
  }
  for (const s of sort) q = s.direction === "desc" ? q.descending(s.field) : q.ascending(s.field);
  if (include.length) q = q.include(...include);
  const res = await q.limit(limit).skip(skip).find(withTotal ? { returnTotalCount: true } : undefined);
  return {
    items: (res.items ?? []).map((r: Raw) => toItem(r)),
    hasNext: res.hasNext(),
    total: res.totalCount ?? null,
  };
}

/** Fetch one item by `_id`. Null when not found. */
export async function getItemById(
  collectionId: string,
  itemId: string,
  { include = [] }: { include?: string[] } = {},
): Promise<CmsItem | null> {
  const raw = await items.get(collectionId, itemId, {
    ...(include.length ? { includeReferences: include.map((field) => ({ field })) } : {}),
  });
  return raw ? toItem(raw as Raw) : null;
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

/** Count items matching the filters — empty-state logic and result counts. */
export async function countItems(collectionId: string, filters: CmsFilter[] = []): Promise<number> {
  const page = await queryItems(collectionId, { filters, limit: 1, withTotal: true });
  return page.total ?? page.items.length;
}

/**
 * Insert an item (visitor form / member submission). Succeeds only when the collection's
 * insert permission covers the caller (403 otherwise — a seed permissions step, not a code
 * bug). Never set `_owner` — Wix stamps it from the caller's identity.
 * Date fields must be Date objects (an ISO string is stored as text and breaks date queries).
 */
export async function insertItem(collectionId: string, data: Record<string, unknown>): Promise<CmsItem> {
  const created = await items.insert(collectionId, data as Raw);
  return toItem(created as Raw);
}

/**
 * REPLACE an item — fields omitted from `item` are WIPED (update does not patch). Spread the
 * full item you hold and override; for an id + a few changed fields use patchItemFields.
 * A round-tripped DTO carries dates as ISO strings — wrap each date field back
 * (`new Date(iso)`) before updating, or the DATE field is silently rewritten as text.
 */
export async function updateItem(collectionId: string, item: CmsItem): Promise<CmsItem> {
  const updated = await items.update(collectionId, item as Raw & { _id: string });
  return toItem(updated as Raw);
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
  return toItem(patched as Raw);
}

/** Remove an item by `_id`. Irreversible. Returns the removed item (null if it didn't exist). */
export async function removeItem(collectionId: string, itemId: string): Promise<CmsItem | null> {
  const removed = await items.remove(collectionId, itemId);
  return removed ? toItem(removed as Raw) : null;
}
