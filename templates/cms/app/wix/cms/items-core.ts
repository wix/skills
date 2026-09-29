// Wix Data rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./items.ts
// (the SDK, managed Astro and React) and the REST twin in templates/cms/rest/items.ts (fetch, a
// static site or a port to another language). Every rule about normalizing an item, validating a
// filter, and spelling a query for the wire lives HERE, once. A raw item may come from the SDK
// (dates as Date objects) or from REST (dates as `{ "$date": iso }`); the mappers accept both.
// Imports are type-only so a strip to JS emits no imports.
import type { CmsFilter, CmsItem, CmsPage, CmsQuery, CmsSort } from "./types";

/** A raw data item's payload as either transport returns it (fields flat, `_id` included). */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;
/** Media value → height/width read from its `#originWidth=…&originHeight=…` fragment; null when it carries none. */
export type ImgRatio = (value: any) => number | null;
/** The media seams a transport injects — `imgSrc` and `imgRatio` from its media.ts. */
export interface Media {
  imgSrc: ImgSrc;
  imgRatio: ImgRatio;
}

/** Page size when a query names none. */
export const DEFAULT_LIMIT = 20;
/** Distinct values returned when a call names no limit. */
export const DISTINCT_LIMIT = 100;
/** The width every IMAGE field is resolved at — one URL per item, large enough for a detail page. */
export const IMAGE_WIDTH = 1200;
/** The height when the identifier carries no size (an image imported without its dimensions): 4:3. */
export const IMAGE_HEIGHT = 900;

// ---- DTO normalization ---------------------------------------------------------------------------

/** REST spells DATE/DATETIME fields as `{ "$date": "<iso>" }`; the SDK decodes them into Date objects. */
function isDateWrapper(v: unknown): v is { $date: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as Raw);
  return keys.length === 1 && keys[0] === "$date" && typeof (v as Raw).$date === "string";
}

/**
 * The size an IMAGE field resolves at: IMAGE_WIDTH wide, at the image's own aspect when the
 * `wix:image://` id carries `#originWidth/#originHeight` (a fill at another aspect would crop it),
 * IMAGE_WIDTH × IMAGE_HEIGHT otherwise. The resolved URL carries the size (`/w_1200,h_800/`), so
 * media.ts `imgRatio(url)` reads the aspect back for srcsets.
 */
export function imageSize(ratio: number | null): { width: number; height: number } {
  return { width: IMAGE_WIDTH, height: ratio ? Math.round(IMAGE_WIDTH * ratio) : IMAGE_HEIGHT };
}

/**
 * Raw → DTO value: dates become ISO strings (Date objects aren't serializable as island props;
 * `{ $date }` wrappers aren't dates at all), IMAGE fields holding a `wix:image://` identifier
 * become https URLs a browser can load. Recursive — included reference items too.
 */
export function toValue(v: unknown, media: Media): unknown {
  if (v instanceof Date) return v.toISOString();
  if (isDateWrapper(v)) {
    // Same spelling as the SDK path (REST omits the milliseconds: "…T00:00:00Z").
    const t = new Date(v.$date);
    return Number.isNaN(t.getTime()) ? v.$date : t.toISOString();
  }
  if (typeof v === "string" && v.startsWith("wix:image://")) {
    const { width, height } = imageSize(media.imgRatio(v));
    return media.imgSrc(v, width, height);
  }
  if (Array.isArray(v)) return v.map((x) => toValue(x, media));
  if (v && typeof v === "object") {
    const out: Raw = {};
    for (const [k, val] of Object.entries(v as Raw)) out[k] = toValue(val, media);
    return out;
  }
  return v;
}

export const toItem = (raw: Raw, media: Media): CmsItem => toValue(raw, media) as CmsItem;

export function toPage(items: Raw[], hasNext: boolean, total: number | null | undefined, media: Media): CmsPage {
  return { items: items.map((r) => toItem(r, media)), hasNext, total: total ?? null };
}

/** Distinct values of a field, normalized like item values (a DATE field's values → ISO strings). */
export const toValues = (values: unknown[], media: Media): unknown[] => values.map((v) => toValue(v, media));

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
 * omit the filter entirely when you don't hold a value yet. A `between` needs its two bounds.
 */
export function assertFilterValue(f: CmsFilter): void {
  if (f.op === "isEmpty" || f.op === "isNotEmpty") return;
  if (f.value === undefined) {
    throw new Error(
      `cms: filter on "${f.field}" (${f.op}) has an undefined value — pass a real value or omit the filter.`,
    );
  }
  if (f.op === "between" && !(Array.isArray(f.value) && f.value.length === 2)) {
    throw new Error(`cms: filter on "${f.field}" (between) takes [start, end].`);
  }
}

/** The validated `[start, end]` of a between filter — start inclusive, end exclusive on both transports. */
export function betweenRange(f: CmsFilter): [unknown, unknown] {
  assertFilterValue(f);
  const [start, end] = f.value as unknown[];
  return [start, end];
}

// ---- the REST spelling of a query ---------------------------------------------------------------
// The SDK's query builder serializes these itself; the REST twin sends them literally. Proven live:
// a DATE comparand must travel as `{ "$date": iso }` (a plain ISO string compares as text and
// matches nothing); isEmpty is `{ field: null }` and isNotEmpty `{ field: { $ne: null } }` — the
// `$isEmpty` keyword is rejected (WDE0076).

/**
 * A comparand or field value on the wire: Date → `{ $date }`, arrays element-wise, everything else
 * as-is. DATE and DATETIME fields BOTH travel as `{ "$date": iso }` (the SDK sends a Date the same
 * way) — proven live: the seed writes DATE fields so, reads them back as dates, and date filters
 * match them. Wix's headless-components write a DATE field as a "YYYY-MM-DD" string instead; that
 * form is not copied here (their formatter is also a month off: getUTCMonth() without +1). A TIME
 * field is a "hh:mm:ss.SSS" string and passes through as text.
 */
export function restValue(v: unknown): unknown {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Array.isArray(v)) return v.map(restValue);
  return v;
}

const REST_OPS: Record<Exclude<CmsFilter["op"], "isEmpty" | "isNotEmpty" | "between">, string> = {
  eq: "$eq",
  ne: "$ne",
  gt: "$gt",
  ge: "$gte",
  lt: "$lt",
  le: "$lte",
  contains: "$contains",
  startsWith: "$startsWith",
  endsWith: "$endsWith",
  // `in` is spelled $hasSome on the wire, the same predicate the SDK transport sends (on a scalar
  // field: equal to any of the values) — one behaviour on both transports.
  in: "$hasSome",
  hasSome: "$hasSome",
  hasAll: "$hasAll",
};

/** One predicate → one filter object `{ field: condition }`. `between` is the builder's ge + lt pair. */
export function restCondition(f: CmsFilter): Raw {
  assertFilterValue(f);
  if (f.op === "isEmpty") return { [f.field]: null };
  if (f.op === "isNotEmpty") return { [f.field]: { $ne: null } };
  if (f.op === "between") {
    const [start, end] = betweenRange(f);
    return { [f.field]: { $gte: restValue(start), $lt: restValue(end) } };
  }
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

/**
 * The Count Data Items body — the filter in the same spelling a query carries, top-level.
 * POST /wix-data/v2/items/count  → { totalCount }
 */
export function countBody(collectionId: string, filters: CmsFilter[] = []): Raw {
  return { dataCollectionId: collectionId, filter: restFilter(filters) };
}

/**
 * The Query Distinct Values body — `fieldName` and `filter` sit top-level (not under `query`).
 * POST /wix-data/v2/items/query-distinct-values  → { distinctValues: [...], pagingMetadata }
 */
export function distinctBody(collectionId: string, field: string, filters: CmsFilter[] = [], limit = DISTINCT_LIMIT): Raw {
  return { dataCollectionId: collectionId, fieldName: field, filter: restFilter(filters), paging: { limit, offset: 0 } };
}

// ---- the REST spelling of a write ---------------------------------------------------------------

/**
 * Field values for an insert/update body — restValue per field (dates → `{ $date }`; JSON.stringify
 * would turn a Date into a plain ISO string, which Wix stores as TEXT and never matches a date
 * query). The read-only system fields are Wix's to stamp, never sent.
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

/**
 * The Bulk Insert / Bulk Remove Data Item References body: one entry per referenced id. The key is
 * `dataItemReferences` with `referringItemFieldName` / `referringItemId` / `referencedItemId` — the
 * natural-looking `references` shape is rejected (400 WDE0080).
 * POST /wix-data/v2/bulk/items/insert-references · POST /wix-data/v2/bulk/items/remove-references
 */
export function referencesBody(collectionId: string, field: string, itemId: string, refIds: string[]): Raw {
  if (!refIds.length) throw new Error("cms: linkItems/unlinkItems called with no referenced ids.");
  return {
    dataCollectionId: collectionId,
    dataItemReferences: refIds.map((referencedItemId) => ({ referringItemFieldName: field, referringItemId: itemId, referencedItemId })),
  };
}
