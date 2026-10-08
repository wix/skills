// Site Search DTOs — the serializable shapes every hook, component and page consumes. Plain JSON:
// safe as Astro island props and across a server/client boundary. `titleHtml` and `excerptHtml`
// carry text and <mark> only (sanitised once, in search-core); `href` is a route of THIS site — the
// `url` the index carries points at Wix pages a headless site does not have, and never leaves the
// data layer.

/** Our group keys. The Wix spelling of each ("public/stores/products", …) lives in search-core. */
export type SearchDocType = "products" | "services" | "posts" | "events" | "pages";

interface HitBase {
  id: string;
  type: SearchDocType;
  /** Plain text — aria-labels, <title>, the fallback when there is no highlight. */
  title: string;
  /** The title with the matched words wrapped in <mark>; text and <mark> only. */
  titleHtml: string;
  /** The best highlighted passage of the description, else its start; text and <mark> only. "" when none. */
  excerptHtml: string;
  /** Resolved https URL ("" when the document has no image). */
  imageUrl: string;
  /** This site's route for the hit ("" when no slug could be derived — render the row unlinked). */
  href: string;
}

export interface ProductHit extends HitBase {
  type: "products";
  slug: string;
  /** Formatted, as the index carries it ("€54.99"); "" when absent. */
  price: string;
  inStock: boolean;
  collections: string[];
}
export interface ServiceHit extends HitBase {
  type: "services";
  slug: string;
  category: string;
  tagLine: string;
}
export interface PostHit extends HitBase {
  type: "posts";
  slug: string;
  /** ISO date; "" when absent. */
  publishDate: string;
  author: string;
  tags: string[];
}
export interface EventHit extends HitBase {
  type: "events";
  slug: string;
  /** ISO date; "" when absent. */
  startDate: string;
  location: string;
  /** Formatted lowest ticket price ("From €20"), "Free", or "" when unknown. */
  price: string;
}
/** Wix-page content — a headless site has none; off by default (the plan may turn it on). */
export interface PageHit extends HitBase {
  type: "pages";
}
export type SearchHit = ProductHit | ServiceHit | PostHit | EventHit | PageHit;

/** One document type's slice of a federated search. */
export interface SearchGroup {
  type: SearchDocType;
  label: string;
  /** Matching documents of this type across the whole index — usually more than `hits` holds. */
  total: number;
  hits: SearchHit[];
}

export interface FacetValue {
  value: string;
  count: number;
}
export interface SearchFacets {
  /** Term facets by field name (products: `collections`, `inStock`). */
  terms: Record<string, FacetValue[]>;
  /** Numeric bounds by field name (products: `discountedPriceNumeric`). */
  ranges: Record<string, { min: number | null; max: number | null }>;
}

export type SearchSort = "relevance" | "price-asc" | "price-desc" | "date-desc";

export interface SearchFilter {
  /** Products: any of these collection names. */
  collections?: string[];
  /** Products: in stock only. */
  inStockOnly?: boolean;
  /** Products: discounted price bounds. */
  minPrice?: number;
  maxPrice?: number;
}

/** A single-type query — the results page's "show all" view and its pages. */
export interface SearchOptions {
  q: string;
  type: SearchDocType;
  /** 1–100, default 12. */
  limit?: number;
  offset?: number;
  sort?: SearchSort;
  filter?: SearchFilter;
  /** Typo tolerance (default from the config). */
  fuzzy?: boolean;
}

export interface SearchPage {
  type: SearchDocType;
  hits: SearchHit[];
  total: number;
  offset: number;
  limit: number;
  hasNext: boolean;
  facets: SearchFacets;
}

export interface SearchAllResult {
  /** Non-empty groups in the configured type order. */
  groups: SearchGroup[];
  /**
   * Whether the site has an index at all. true: documents came back. false: the response listed no
   * document type — nothing is indexed (the Wix Site Search app is not installed on this site).
   * null: unknown — zero documents is ambiguous (no match, an empty catalog, or an index still
   * back-filling after the install); do not read it as "not installed".
   */
  indexed: boolean | null;
}

export type SuggestHit = Pick<SearchHit, "id" | "type" | "title" | "titleHtml" | "imageUrl" | "href">;

export interface SuggestGroup {
  type: SearchDocType;
  label: string;
  hits: SuggestHit[];
}

/** The resolved configuration every call reads (search-core's resolveConfig, from the plan). */
export interface SiteSearchConfig {
  /** Document types searched and shown, in this order. */
  types: SearchDocType[];
  /** Route templates per type, `[slug]` replaced by the URL-encoded slug. "" = never linked. */
  routes: Record<SearchDocType, string>;
  labels: Record<SearchDocType, string>;
  /** BCP-47 language the index is queried in; null lets the service pick. */
  language: string | null;
  fuzzy: boolean;
}

/** What `plan.capabilities.siteSearch` may say — deploy writes it to config.generated.ts as data. */
export interface SiteSearchPlan {
  /** Install the Wix Site Search app during the seed (the capability's seed/install.mjs). */
  install?: boolean;
  types?: string[];
  routes?: Record<string, string>;
  labels?: Record<string, string>;
  language?: string;
  fuzzy?: boolean;
}
