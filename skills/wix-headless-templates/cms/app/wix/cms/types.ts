// CMS DTOs — the serializable shapes every hook, component, and page consumes. CMS is
// schema-generic: field keys come from the seed plan (seed/SEED.md), so an item is a flat
// field map rather than a fixed interface. Plain JSON: safe as Astro island props or across
// server/client boundaries. By the time an item leaves the data layer, Date fields are ISO
// strings and IMAGE fields are resolved https URLs.

/**
 * One collection item: `_id` plus the collection's fields, flat on the item (there is no
 * `item.data.*` — that is the REST shape and reads undefined here).
 * Field values by type: TEXT/URL/EMAIL → string, NUMBER → number, BOOLEAN → boolean,
 * DATE/DATETIME → ISO string, TIME → "hh:mm:ss.SSS" string (text on the wire, passed through),
 * IMAGE → https URL at the image's natural aspect ("" never happens — absent fields are
 * undefined), RICH_TEXT → the stored HTML string, ARRAY_STRING (tags) → string[], ADDRESS →
 * object with `formatted`, MEDIA_GALLERY → array of { src, type, title } (`src` resolved),
 * REFERENCE/MULTI_REFERENCE → id(s), or full CmsItem(s) when the query included the field.
 * VIDEO/DOCUMENT identifiers (`wix:video://`, `wix:document://`) and RICH_CONTENT (Ricos JSON)
 * pass through unresolved.
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

/**
 * Predicate operators — the SDK query builder's names. `in` matches a scalar field equal to ANY of
 * the values (an id list; hasSome on the wire, as Wix's own components send it); `between` takes
 * `[start, end]`, start inclusive, end EXCLUSIVE (the builder spells it ge + lt — a date range
 * ends at the first excluded day).
 */
export type CmsFilterOp =
  | "eq"
  | "ne"
  | "gt"
  | "ge"
  | "lt"
  | "le"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "hasSome"
  | "hasAll"
  | "between"
  | "isEmpty"
  | "isNotEmpty";

/**
 * One query predicate. Comparands must match the field's stored type — a DATE/DATETIME
 * field only matches a Date object (an ISO string compares as text and matches nothing).
 */
export interface CmsFilter {
  field: string;
  op: CmsFilterOp;
  /** Required except for isEmpty/isNotEmpty; in/hasSome/hasAll take an array; between takes `[start, end]`. */
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
  /** Items to skip — page N (0-based) is skip = N * limit. */
  skip?: number;
  /** Reference field keys to inline as full items (otherwise the field holds ids). */
  include?: string[];
  /** true → the page carries `total` (slower query; for counts, page numbers, empty-state logic). */
  withTotal?: boolean;
}

/** One page of items. Load the next page with skip = items shown so far. */
export interface CmsPage {
  items: CmsItem[];
  hasNext: boolean;
  /** Total matching items — only when the query asked `withTotal`, else null. */
  total: number | null;
}

/** A field's type as the collection schema spells it (Wix Data `Type`; open for values added later). */
export type CmsFieldType =
  | "TEXT"
  | "NUMBER"
  | "BOOLEAN"
  | "DATE"
  | "DATETIME"
  | "TIME"
  | "URL"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "AUDIO"
  | "RICH_TEXT"
  | "RICH_CONTENT"
  | "MEDIA_GALLERY"
  | "ADDRESS"
  | "ARRAY_STRING"
  | "ARRAY"
  | "OBJECT"
  | "REFERENCE"
  | "MULTI_REFERENCE"
  | (string & {});

/** Who may run a verb on a collection (Wix Data `Role`). */
export type CmsRole = "ANYONE" | "SITE_MEMBER" | "SITE_MEMBER_AUTHOR" | "ADMIN" | (string & {});

/** One field of a collection's schema. */
export interface CmsFieldSchema {
  key: string;
  displayName: string;
  type: CmsFieldType;
  /** `_id`, `_createdDate`, `_updatedDate`, `_owner` — Wix's to stamp, never written. */
  systemField: boolean;
  required: boolean;
  /** REFERENCE/MULTI_REFERENCE: the collection the field points at. */
  referencedCollectionId?: string;
}

/**
 * A collection's schema — field types, reference targets, and permissions at runtime: the
 * source of truth for a field's type when the seed plan isn't at hand (an imported site).
 */
export interface CmsCollectionSchema {
  id: string;
  displayName: string;
  fields: CmsFieldSchema[];
  permissions: { read: CmsRole; insert: CmsRole; update: CmsRole; remove: CmsRole };
}
