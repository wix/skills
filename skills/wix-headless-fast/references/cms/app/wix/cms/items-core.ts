// Wix Data rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./items.ts
// (the SDK, managed Astro and React) and the REST twin in references/cms/rest/items.ts (fetch, a
// static site or a port to another language). Every rule about normalizing an item, validating a
// filter, and spelling a query for the wire lives HERE, once. A raw item may come from the SDK
// (dates as Date objects) or from REST (dates as `{ "$date": iso }`); the mappers accept both.
// Imports are type-only so a strip to JS emits no imports.
import type { CmsFilter, CmsItem, CmsPage, CmsQuery, CmsSort } from "./types";

/** A raw data item's payload as either transport returns it (fields flat, `_id` included). */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** Page size when a query names none. */
export const DEFAULT_LIMIT = 20;
/** The size every IMAGE field is resolved at — one URL per item, large enough for a detail page. */
export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 900;

// ---- DTO normalization ---------------------------------------------------------------------------

/** REST spells DATE/DATETIME fields as `{ "$date": "<iso>" }`; the SDK decodes them into Date objects. */
function isDateWrapper(v: unknown): v is { $date: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as Raw);
  return keys.length === 1 && keys[0] === "$date" && typeof (v as Raw).$date === "string";
}

/**
 * Raw → DTO value: dates become ISO strings (Date objects aren't serializable as island props;
 * `{ $date }` wrappers aren't dates at all), IMAGE fields holding a `wix:image://` identifier
 * become https URLs a browser can load. Recursive — included reference items too.
 */
export function toValue(v: unknown, imgSrc: ImgSrc): unknown {
  if (v instanceof Date) return v.toISOString();
  if (isDateWrapper(v)) {
    // Same spelling as the SDK path (REST omits the milliseconds: "…T00:00:00Z").
    const t = new Date(v.$date);
    return Number.isNaN(t.getTime()) ? v.$date : t.toISOString();
  }
  if (typeof v === "string" && v.startsWith("wix:image://")) return imgSrc(v, IMAGE_WIDTH, IMAGE_HEIGHT);
  if (Array.isArray(v)) return v.map((x) => toValue(x, imgSrc));
  if (v && typeof v === "object") {
    const out: Raw = {};
    for (const [k, val] of Object.entries(v as Raw)) out[k] = toValue(val, imgSrc);
    return out;
  }
  return v;
}

export const toItem = (raw: Raw, imgSrc: ImgSrc): CmsItem => toValue(raw, imgSrc) as CmsItem;

export function toPage(items: Raw[], hasNext: boolean, total: number | null | undefined, imgSrc: ImgSrc): CmsPage {
  return { items: items.map((r) => toItem(r, imgSrc)), hasNext, total: total ?? null };
}

/**
 * A DATE/DATETIME field for display — the DTO carries an ISO string; this is the one place it
 * becomes copy. "" for an absent or unparseable value (never "Invalid Date", never the raw ISO).
 *   formatDate(item.publishDate)                       → "August 20, 2026"
 *   formatDate(item.publishDate, "en-GB", { dateStyle: "medium" })
 */
export function formatDate(iso: unknown, locale = "en-US", options: Intl.DateTimeFormatOptions = { dateStyle: "long" }): string {
  if (typeof iso !== "string" || !iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : new Intl.DateTimeFormat(locale, options).format(t);
}

// ---- filter rules --------------------------------------------------------------------------------

/**
 * An undefined comparand silently changes what a query matches (every row, or none) with no
 * server error — the classic "my items shows everyone's items" bug. Throw at the call site;
 * omit the filter entirely when you don't hold a value yet.
 */
export function assertFilterValue(f: CmsFilter): void {
  if (f.op !== "isEmpty" && f.op !== "isNotEmpty" && f.value === undefined) {
    throw new Error(
      `cms: filter on "${f.field}" (${f.op}) has an undefined value — pass a real value or omit the filter.`,
    );
  }
}

// ---- the REST spelling of a query ---------------------------------------------------------------
// The SDK's query builder serializes these itself; the REST twin sends them literally. Proven live:
// a DATE comparand must travel as `{ "$date": iso }` (a plain ISO string compares as text and
// matches nothing); isEmpty is `{ field: null }` and isNotEmpty `{ field: { $ne: null } }` — the
// `$isEmpty` keyword is rejected (WDE0076).

/** A comparand on the wire: Date → `{ $date }`, arrays element-wise, everything else as-is. */
export function restValue(v: unknown): unknown {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Array.isArray(v)) return v.map(restValue);
  return v;
}

const REST_OPS: Record<Exclude<CmsFilter["op"], "isEmpty" | "isNotEmpty">, string> = {
  eq: "$eq",
  ne: "$ne",
  gt: "$gt",
  ge: "$gte",
  lt: "$lt",
  le: "$lte",
  contains: "$contains",
  startsWith: "$startsWith",
  hasSome: "$hasSome",
  hasAll: "$hasAll",
};

/** One predicate → one filter object `{ field: condition }`. */
export function restCondition(f: CmsFilter): Raw {
  assertFilterValue(f);
  if (f.op === "isEmpty") return { [f.field]: null };
  if (f.op === "isNotEmpty") return { [f.field]: { $ne: null } };
  return { [f.field]: { [REST_OPS[f.op]]: restValue(f.value) } };
}

/** All predicates AND-ed: `{}` for none, the one object for one, `{ $and: [...] }` otherwise. */
export function restFilter(filters: CmsFilter[] = []): Raw {
  const conditions = filters.map(restCondition);
  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

export function restSort(sort: CmsSort[] = []): { fieldName: string; order: "ASC" | "DESC" }[] {
  return sort.map((s) => ({ fieldName: s.field, order: s.direction === "desc" ? "DESC" : "ASC" }));
}

/**
 * The full Query Data Items body. Offset paging (`skip` = page N × limit) so every page can carry
 * its own filter/sort and `returnTotalCount` works; `includeReferences[].field` inlines reference
 * items.  POST /wix-data/v2/items/query
 */
export function queryBody(collectionId: string, query: CmsQuery = {}): Raw {
  const { filters = [], sort = [], limit = DEFAULT_LIMIT, skip = 0, include = [], withTotal = false } = query;
  return {
    dataCollectionId: collectionId,
    query: {
      filter: restFilter(filters),
      ...(sort.length ? { sort: restSort(sort) } : {}),
      paging: { limit, offset: skip },
    },
    ...(include.length ? { includeReferences: include.map((field) => ({ field })) } : {}),
    ...(withTotal ? { returnTotalCount: true } : {}),
  };
}

/** Whether another page follows — the response says so; the arithmetic is the fallback. */
export function restHasNext(pagingMetadata: Raw | undefined, offset: number, limit: number): boolean {
  if (typeof pagingMetadata?.hasNext === "boolean") return pagingMetadata.hasNext;
  if (typeof pagingMetadata?.total === "number") return offset + (pagingMetadata.count ?? 0) < pagingMetadata.total;
  return (pagingMetadata?.count ?? 0) >= limit;
}

// ---- the REST spelling of a write ---------------------------------------------------------------

/**
 * Field values for an insert/update body. A DATE field must arrive as `{ $date }` — JSON.stringify
 * turns a Date into a plain ISO string, which Wix stores as TEXT and never matches a date query.
 * The read-only system fields are Wix's to stamp, never sent.
 */
export function restWriteData(data: Record<string, unknown>): Raw {
  const out: Raw = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "_createdDate" || k === "_updatedDate" || k === "_owner") continue;
    out[k] = restValue(v);
  }
  return out;
}

/** The Patch Data Item modifications for "set these fields" — one SET_FIELD per key.  PATCH /wix-data/v2/items/{id} */
export function patchModifications(fields: Record<string, unknown>): Raw[] {
  const entries = Object.entries(fields);
  if (!entries.length) throw new Error("cms: patchItemFields called with no fields.");
  return entries.map(([fieldPath, value]) => ({ fieldPath, action: "SET_FIELD", setFieldOptions: { value: restValue(value) } }));
}
