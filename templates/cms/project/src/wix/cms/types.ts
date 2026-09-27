// CMS DTOs — the serializable shapes every hook, component, and page consumes. CMS is
// schema-generic: field keys come from the seed plan (seed/SEED.md), so an item is a flat
// field map rather than a fixed interface. Plain JSON: safe as Astro island props or across
// server/client boundaries. By the time an item leaves the data layer, Date fields are ISO
// strings and IMAGE fields are resolved https URLs.

/**
 * One collection item: `_id` plus the collection's fields, flat on the item (there is no
 * `item.data.*` — that is the REST shape and reads undefined here).
 * Field values by type: TEXT/URL/EMAIL → string, NUMBER → number, BOOLEAN → boolean,
 * DATE/DATETIME → ISO string, IMAGE → https URL ("" never happens — absent fields are
 * undefined), RICH_TEXT → the stored HTML string, REFERENCE/MULTI_REFERENCE → id(s), or
 * full CmsItem(s) when the query included the field.
 */
export interface CmsItem {
  _id: string;
  /** ISO string (the SDK's Date objects are serialized by the data layer). */
  _createdDate?: string;
  _updatedDate?: string;
  /** Id of the member who created the row (member-scoped collections). */
  _owner?: string;
  [key: string]: unknown;
}

export type CmsFilterOp =
  | "eq"
  | "ne"
  | "gt"
  | "ge"
  | "lt"
  | "le"
  | "contains"
  | "startsWith"
  | "hasSome"
  | "hasAll"
  | "isEmpty"
  | "isNotEmpty";

/**
 * One query predicate. Comparands must match the field's stored type — a DATE/DATETIME
 * field only matches a Date object (an ISO string compares as text and matches nothing).
 */
export interface CmsFilter {
  field: string;
  op: CmsFilterOp;
  /** Required except for isEmpty/isNotEmpty; hasSome/hasAll take an array. */
  value?: string | number | boolean | Date | (string | number | Date)[];
}

export interface CmsSort {
  field: string;
  /** Default "asc". */
  direction?: "asc" | "desc";
}

export interface CmsQuery {
  filters?: CmsFilter[];
  sort?: CmsSort[];
  /** Page size (default 20). */
  limit?: number;
  /** Items to skip — page N is skip = N * limit. */
  skip?: number;
  /** Reference field keys to inline as full items (otherwise the field holds ids). */
  include?: string[];
  /** true → the page carries `total` (slower query; for counts/empty-state logic). */
  withTotal?: boolean;
}

/** One page of items. Load the next page with skip = items shown so far. */
export interface CmsPage {
  items: CmsItem[];
  hasNext: boolean;
  /** Total matching items — only when the query asked `withTotal`, else null. */
  total: number | null;
}
