// Site Search rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./search.ts
// (the SDK, managed Astro and React) and the REST twin in rest/search.ts (fetch, a static site or a
// port to another language). Every request body, every field the index is known by on the wire
// (`_highlights`, `documentImage`, `urlPart`, `result-format`), every href rule and the highlight
// sanitiser live HERE, once. The federated service is a preview API: a renamed field is one edit
// in this file. Imports are type-only so a strip to JS emits no imports.
import type {
  EventHit,
  FacetValue,
  PostHit,
  ProductHit,
  SearchAllResult,
  SearchDocType,
  SearchFacets,
  SearchFilter,
  SearchGroup,
  SearchHit,
  SearchOptions,
  SearchPage,
  SearchSort,
  ServiceHit,
  SiteSearchConfig,
  SiteSearchPlan,
  SuggestGroup,
  SuggestHit,
} from "./types";

/** A raw search document as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

// ---- limits — the service answers 400 past them (observed live) --------------------------------
/** `query` of search and federatedSearch: 101 chars → 400 MAX_LENGTH. */
export const MAX_QUERY = 100;
/** `query` of suggest and autocomplete. */
export const MAX_SUGGEST_QUERY = 50;
/** suggest: "Phrase needs to be at least 3 symbols long". */
export const MIN_SUGGEST_CHARS = 3;
export const SUGGEST_DEBOUNCE_MS = 300;
/** Suggestions per document type. */
export const SUGGEST_LIMIT = 4;
/** Hits per group on the grouped results page (federatedSearch `limit` is PER type, 1–100). */
export const GROUP_LIMIT = 4;
/** Page size of the single-type view. */
export const PAGE_LIMIT = 12;
export const IMAGE_SIZE = 320;
export const EXCERPT_CHARS = 160;

// ---- document types ------------------------------------------------------------------------------
/** Our group key ⇄ the federated service's document type path — the one place both spellings meet. */
export const WIX_DOC_TYPES: Record<SearchDocType, string> = {
  products: "public/stores/products",
  services: "public/booking/services",
  posts: "public/blog/posts",
  events: "public/events/events",
  pages: "public/site/pages",
};

export function docTypeOf(wixType: string | null | undefined): SearchDocType | null {
  for (const [key, path] of Object.entries(WIX_DOC_TYPES)) if (path === wixType) return key as SearchDocType;
  return null;
}

export const isDocType = (v: unknown): v is SearchDocType => typeof v === "string" && v in WIX_DOC_TYPES;

/** `pages` is off: a headless site has no Wix pages (total 0 on every probe). */
export const DEFAULT_TYPES: SearchDocType[] = ["products", "services", "posts", "events"];
/** The routes the verticals ship: storefront /products/[slug], bookings /services/[slug], blog /blog/[...slug], events /events/[slug]. */
export const DEFAULT_ROUTES: Record<SearchDocType, string> = {
  products: "/products/[slug]",
  services: "/services/[slug]",
  posts: "/blog/[slug]",
  events: "/events/[slug]",
  pages: "",
};
export const DEFAULT_LABELS: Record<SearchDocType, string> = {
  products: "Products",
  services: "Services",
  posts: "Blog posts",
  events: "Events",
  pages: "Pages",
};

/** The plan's siteSearch entry (or nothing) → a complete config; unknown type names are dropped. */
export function resolveConfig(plan: SiteSearchPlan | null | undefined): SiteSearchConfig {
  const wanted = Array.isArray(plan?.types) ? plan!.types!.filter(isDocType) : DEFAULT_TYPES;
  const types = [...new Set(wanted)];
  const routes = { ...DEFAULT_ROUTES };
  const labels = { ...DEFAULT_LABELS };
  for (const [k, v] of Object.entries(plan?.routes ?? {})) if (isDocType(k) && typeof v === "string") routes[k] = v;
  for (const [k, v] of Object.entries(plan?.labels ?? {})) if (isDocType(k) && typeof v === "string" && v) labels[k] = v;
  return {
    types: types.length ? types : DEFAULT_TYPES,
    routes,
    labels,
    language: typeof plan?.language === "string" && plan.language ? plan.language : null,
    fuzzy: plan?.fuzzy ?? true,
  };
}

// ---- queries -------------------------------------------------------------------------------------
/** Trim, collapse whitespace, cut at the service's limit — the shape every query is sent in. */
export function clampQuery(q: string | null | undefined, max = MAX_QUERY): string {
  return (q ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** The preview surface's own field: with it a product document is the store-front entity (`urlPart`, `media`) and loses `title`/`_highlights`. */
export const STORE_FRONT_PROPERTIES: Raw[] = [{ name: "result-format", value: "store-front" }];

/**
 * federatedSearch — one request, all configured types, `limit` per type, no paging (page 2 is a
 * single-type `search`).  POST /sitesearch/v1/search/federated
 */
export function federatedBody(
  q: string,
  cfg: SiteSearchConfig,
  { limit = GROUP_LIMIT, types = cfg.types, storeFront = false }: { limit?: number; types?: SearchDocType[]; storeFront?: boolean } = {},
): Raw {
  return {
    query: clampQuery(q),
    documentTypes: types.map((t) => WIX_DOC_TYPES[t]),
    limit: Math.min(100, Math.max(1, limit)),
    fuzzy: cfg.fuzzy,
    highlight: !storeFront,
    ...(cfg.language ? { language: cfg.language } : {}),
    ...(storeFront ? { properties: STORE_FRONT_PROPERTIES } : {}),
  };
}

export const SORTS: Record<SearchSort, { label: string; types: SearchDocType[] }> = {
  relevance: { label: "Relevance", types: ["products", "services", "posts", "events", "pages"] },
  "price-asc": { label: "Price: low to high", types: ["products"] },
  "price-desc": { label: "Price: high to low", types: ["products"] },
  "date-desc": { label: "Newest", types: ["posts", "events"] },
};
// Sortable fields per the schema page: products discountedPriceNumeric (observed live), posts
// publishDate, events startDate (schema only — not observed).
const SORT_FIELDS: Partial<Record<SearchSort, Partial<Record<SearchDocType, string>>>> = {
  "price-asc": { products: "discountedPriceNumeric" },
  "price-desc": { products: "discountedPriceNumeric" },
  "date-desc": { posts: "publishDate", events: "startDate" },
};

export const sortsFor = (type: SearchDocType): SearchSort[] =>
  (Object.keys(SORTS) as SearchSort[]).filter((s) => SORTS[s].types.includes(type));

/** `ordering.ordering[]{fieldName, direction}`; undefined for relevance or a sort the type lacks. */
export function orderingFor(sort: SearchSort | undefined, type: SearchDocType): Raw | undefined {
  const fieldName = sort ? SORT_FIELDS[sort]?.[type] : undefined;
  if (!fieldName) return undefined;
  return { ordering: [{ fieldName, direction: sort === "price-asc" ? "ASC" : "DESC" }] };
}

/**
 * The platformized filter `{ field: { $op: value } }`. `inStock $eq` is observed live; `$hasSome` on
 * `collections` and `$gte`/`$lte` on `discountedPriceNumeric` follow the schema page's operators and
 * are not observed. Products only — the other types carry no filterable field the UI exposes.
 */
export function searchFilter(f: SearchFilter | undefined, type: SearchDocType): Raw | undefined {
  if (!f || type !== "products") return undefined;
  const out: Raw = {};
  if (f.inStockOnly) out.inStock = { $eq: true };
  if (f.collections?.length) out.collections = { $hasSome: f.collections };
  const range: Raw = {};
  if (f.minPrice != null && Number.isFinite(f.minPrice)) range.$gte = f.minPrice;
  if (f.maxPrice != null && Number.isFinite(f.maxPrice)) range.$lte = f.maxPrice;
  if (Object.keys(range).length) out.discountedPriceNumeric = range;
  return Object.keys(out).length ? out : undefined;
}

// Facet clauses per type (`facets.clauses[]`). Products observed live; the schema page marks blog
// `tags` and events `startDate`/`location`/`eventType` facetable too — add a clause here when a
// surface needs one, and the panel reads it from `facets.terms`.
const FACET_CLAUSES: Partial<Record<SearchDocType, Raw[]>> = {
  products: [
    { term: { name: "collections", limit: 20 } },
    { term: { name: "inStock" } },
    { aggregation: { name: "discountedPriceNumeric", aggregation: "MIN" } },
    { aggregation: { name: "discountedPriceNumeric", aggregation: "MAX" } },
  ],
};

/**
 * search — one document type, offset paging, ordering, filter, facets.  POST /sitesearch/v1/search
 * `fields` is never sent: it may name schema fields only (`url`, `documentImage`, `_highlights` → 400
 * SE-1118), and everything the mappers read comes back regardless.
 */
export function searchBody(o: SearchOptions, cfg: SiteSearchConfig, { storeFront = false } = {}): Raw {
  const limit = Math.min(100, Math.max(1, o.limit ?? PAGE_LIMIT));
  const filter = searchFilter(o.filter, o.type);
  const ordering = orderingFor(o.sort, o.type);
  const facets = FACET_CLAUSES[o.type];
  return {
    query: clampQuery(o.q),
    documentType: WIX_DOC_TYPES[o.type],
    paging: { limit, offset: Math.max(0, o.offset ?? 0) },
    fuzzy: o.fuzzy ?? cfg.fuzzy,
    highlight: !storeFront,
    ...(cfg.language ? { language: cfg.language } : {}),
    ...(filter ? { filter } : {}),
    ...(ordering ? { ordering } : {}),
    ...(facets && !storeFront ? { facets: { clauses: facets } } : {}),
    ...(storeFront ? { properties: STORE_FRONT_PROPERTIES } : {}),
  };
}

/** federatedSuggest — `query` ≤ 50, `limit` per type. `result-format` is rejected here (400 SE-1113), so product suggestions carry no slug.  POST /sitesearch/v1/suggest/federated */
export function suggestBody(q: string, cfg: SiteSearchConfig, limit = SUGGEST_LIMIT): Raw {
  return {
    query: clampQuery(q, MAX_SUGGEST_QUERY),
    documentTypes: cfg.types.map((t) => WIX_DOC_TYPES[t]),
    limit: Math.min(100, Math.max(1, limit)),
    ...(cfg.language ? { language: cfg.language } : {}),
  };
}

// ---- safe HTML -----------------------------------------------------------------------------------
/** Plain text → HTML text. */
export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** An HTML fragment → its text (tags dropped, the common entities decoded). */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A `_highlights` fragment → HTML with ONLY <mark> kept. The fragments arrive as raw HTML — the
 * source's own tags (a description's <p>) plus the injected <mark> — so every other tag is dropped
 * and every stray angle bracket escaped; the text between is already HTML-encoded by the index and
 * is passed through. The only thing a component may hand to dangerouslySetInnerHTML.
 */
export function safeHighlight(fragment: string): string {
  return fragment
    .split(/(<\/?mark>)/i)
    .map((part, i) => (i % 2 ? part.toLowerCase() : part.replace(/<[^>]*>/g, "").replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, n = EXCERPT_CHARS): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 20))}…`;
}

// ---- mapping -------------------------------------------------------------------------------------
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const docId = (raw: Raw): string => str(raw?.id ?? raw?._id ?? raw?.documentId);

/** The last path segment of an absolute or relative URL, decoded; "" when there is none. */
export function slugFromUrl(url: unknown): string {
  const s = str(url).trim();
  if (!s) return "";
  const path = s.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const last = path.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The route for a hit: the type's template with `[slug]` URL-encoded in; "" when there is no slug or no route. */
export function hrefFor(type: SearchDocType, slug: string, cfg: SiteSearchConfig): string {
  const route = cfg.routes[type];
  if (!route || !slug) return "";
  return route.replace("[slug]", encodeURIComponent(slug));
}

const STATIC_MEDIA = "https://static.wixstatic.com/media/";

/** `documentImage.name` (default format) or `media[0].url` (store-front) is a bare wixstatic file id — prefixed to the absolute form media.ts scales. */
export function imageOf(raw: Raw | null | undefined, imgSrc: ImgSrc): string {
  const name = str(raw?.documentImage?.name) || str(raw?.media?.[0]?.url) || str(raw?.image);
  if (!name) return "";
  const url = /^https?:\/\//.test(name) ? name : STATIC_MEDIA + name.replace(/^\/+/, "");
  return imgSrc(url, IMAGE_SIZE, IMAGE_SIZE);
}

function highlightOf(raw: Raw, field: string): string {
  const list = raw?._highlights?.[field];
  const first = Array.isArray(list) ? list.find((x) => typeof x === "string" && x.trim()) : null;
  return first ? safeHighlight(first) : "";
}

function excerptOf(raw: Raw): string {
  const highlighted = highlightOf(raw, "description");
  if (highlighted) return highlighted;
  const plain = stripTags(str(raw?.description));
  return plain ? escapeText(truncate(plain)) : "";
}

function isoDate(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString();
  const s = str(typeof v === "object" && v !== null ? (v as Raw).$date : v);
  if (!s) return "";
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? "" : t.toISOString();
}

/** An ISO date for a meta line — "" for an absent or unparseable value, never "Invalid Date". */
export function formatHitDate(iso: string, locale = "en-US", options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : new Intl.DateTimeFormat(locale, options).format(t);
}

/** Events carry `minPrice` + `currency` as numbers/strings, no formatted string (schema page; not observed). */
function eventPrice(raw: Raw): string {
  const min = raw?.minPrice;
  if (min == null || min === "") return "";
  if (Number(min) === 0) return "Free";
  try {
    return `From ${new Intl.NumberFormat(undefined, { style: "currency", currency: str(raw?.currency) || "USD" }).format(Number(min))}`;
  } catch {
    return `From ${min} ${str(raw?.currency)}`.trim();
  }
}

/**
 * One raw document → the DTO of its type. `storeFront` is the same product in `result-format:
 * store-front` (the only place a product's slug, `urlPart`, exists on the wire); null when the pass
 * failed or the id did not match — the hit then renders unlinked rather than at a Wix URL.
 */
export function toHit(raw: Raw, type: SearchDocType, cfg: SiteSearchConfig, imgSrc: ImgSrc, storeFront: Raw | null = null): SearchHit {
  const title = stripTags(str(raw?.title)) || stripTags(str(storeFront?.name));
  const base = {
    id: docId(raw),
    title,
    titleHtml: highlightOf(raw, "title") || escapeText(title),
    excerptHtml: excerptOf(raw),
    imageUrl: imageOf(raw, imgSrc) || imageOf(storeFront, imgSrc),
  };
  switch (type) {
    case "products": {
      // Observed: `url` is "" for products on a headless site; the slug is store-front `urlPart`.
      const slug = str(storeFront?.urlPart);
      const hit: ProductHit = {
        ...base,
        type,
        slug,
        href: hrefFor(type, slug, cfg),
        price: str(raw?.discountedPrice) || str(storeFront?.formattedPrice),
        inStock: typeof raw?.inStock === "boolean" ? raw.inStock : storeFront?.isInStock !== false,
        collections: strings(raw?.collections),
      };
      return hit;
    }
    case "services": {
      // Observed: `url` is the Wix fallback host's /service-page/<slug> — the slug is its last segment.
      const slug = slugFromUrl(raw?.url);
      const hit: ServiceHit = { ...base, type, slug, href: hrefFor(type, slug, cfg), category: str(raw?.category), tagLine: str(raw?.tagLine) };
      return hit;
    }
    case "posts": {
      // Not observed: assumed the same /<page>/<slug> shape as services; "" (unlinked) when `url` is empty.
      const slug = slugFromUrl(raw?.url);
      const hit: PostHit = {
        ...base,
        type,
        slug,
        href: hrefFor(type, slug, cfg),
        publishDate: isoDate(raw?.publishDate),
        author: str(raw?.author),
        tags: strings(raw?.tags),
      };
      return hit;
    }
    case "events": {
      // Not observed: same assumption as posts.
      const slug = slugFromUrl(raw?.url);
      const hit: EventHit = {
        ...base,
        type,
        slug,
        href: hrefFor(type, slug, cfg),
        startDate: isoDate(raw?.startDate),
        location: str(raw?.location),
        price: eventPrice(raw),
      };
      return hit;
    }
    default:
      return { ...base, type: "pages", href: "" };
  }
}

/** The store-front pass's documents by id — what `toHit` joins a product on. */
export function storeFrontById(docs: Raw[] | null | undefined): Map<string, Raw> {
  const m = new Map<string, Raw>();
  for (const d of docs ?? []) {
    const id = docId(d);
    if (id) m.set(id, d);
  }
  return m;
}

/** The products slice of a federated response — the input of storeFrontById. */
export function productsOf(results: Raw[] | null | undefined): Raw[] {
  return (results ?? []).find((r) => r?.documentType === WIX_DOC_TYPES.products)?.documents ?? [];
}

const hitOf = (raw: Raw, type: SearchDocType, cfg: SiteSearchConfig, imgSrc: ImgSrc, storeFront: Map<string, Raw>): SearchHit =>
  toHit(raw, type, cfg, imgSrc, type === "products" ? (storeFront.get(docId(raw)) ?? null) : null);

/** federatedSearch `results[]` → groups in the config's type order; types outside it and empty groups are dropped (the widget does the same). */
export function toGroups(results: Raw[] | null | undefined, cfg: SiteSearchConfig, imgSrc: ImgSrc, storeFront: Map<string, Raw> = new Map()): SearchGroup[] {
  const byType = new Map<SearchDocType, Raw>();
  for (const r of results ?? []) {
    const type = docTypeOf(r?.documentType);
    if (type) byType.set(type, r);
  }
  const groups: SearchGroup[] = [];
  for (const type of cfg.types) {
    const r = byType.get(type);
    const docs: Raw[] = r?.documents ?? [];
    if (!docs.length) continue;
    groups.push({ type, label: cfg.labels[type], total: typeof r?.total === "number" ? r.total : docs.length, hits: docs.map((d) => hitOf(d, type, cfg, imgSrc, storeFront)) });
  }
  return groups;
}

/**
 * The "is anything indexed" reading of a federated response. An indexed site lists every enabled
 * document type even when a type has no match (observed live), so a response with NO types at all
 * is read as no index — the Wix Site Search app is not installed. Zero documents across listed
 * types stays null: no match, an empty catalog and an index still back-filling look identical.
 */
export function indexedFrom(results: Raw[] | null | undefined): boolean | null {
  if (!Array.isArray(results) || results.length === 0) return false;
  if (results.some((r) => (r?.documents?.length ?? 0) > 0 || (r?.total ?? 0) > 0)) return true;
  return null;
}

export function toSearchAll(results: Raw[] | null | undefined, cfg: SiteSearchConfig, imgSrc: ImgSrc, storeFront?: Map<string, Raw>): SearchAllResult {
  return { groups: toGroups(results, cfg, imgSrc, storeFront), indexed: indexedFrom(results) };
}

/** `facets[]` (each a one-of: terms | minAggregation | maxAggregation | minMaxAggregation | …) → terms and ranges by field. */
export function toFacets(facets: Raw[] | null | undefined): SearchFacets {
  const out: SearchFacets = { terms: {}, ranges: {} };
  const range = (name: string) => (out.ranges[name] ??= { min: null, max: null });
  for (const f of facets ?? []) {
    if (f?.terms?.facet) {
      out.terms[f.terms.facet] = ((f.terms.facets ?? []) as Raw[])
        .map((v): FacetValue => ({ value: str(v.facetValue), count: Number(v.count ?? 0) }))
        .filter((v) => v.value);
    }
    if (f?.minAggregation?.facet) range(f.minAggregation.facet).min = f.minAggregation.minValue ?? null;
    if (f?.maxAggregation?.facet) range(f.maxAggregation.facet).max = f.maxAggregation.maxValue ?? null;
    if (f?.minMaxAggregation?.facet) {
      const r = range(f.minMaxAggregation.facet);
      r.min = f.minMaxAggregation.minValue ?? null;
      r.max = f.minMaxAggregation.maxValue ?? null;
    }
  }
  return out;
}

/** A `search` response → one page. `hasNext` is arithmetic on `nextPage.total` (the service sends no flag). */
export function toPage(res: Raw | null | undefined, o: SearchOptions, cfg: SiteSearchConfig, imgSrc: ImgSrc, storeFront: Map<string, Raw> = new Map()): SearchPage {
  const docs: Raw[] = res?.documents ?? [];
  const offset = Math.max(0, o.offset ?? 0);
  const limit = Math.min(100, Math.max(1, o.limit ?? PAGE_LIMIT));
  const total = typeof res?.nextPage?.total === "number" ? res.nextPage.total : offset + docs.length;
  return {
    type: o.type,
    hits: docs.map((d) => hitOf(d, o.type, cfg, imgSrc, storeFront)),
    total,
    offset,
    limit,
    hasNext: offset + docs.length < total,
    facets: toFacets(res?.facets),
  };
}

export const toSuggestHit = (hit: SearchHit): SuggestHit => ({ id: hit.id, type: hit.type, title: hit.title, titleHtml: hit.titleHtml, imageUrl: hit.imageUrl, href: hit.href });

/** federatedSuggest `results[]` → suggestion groups (no totals; product rows carry no href — see suggestBody). */
export function toSuggestGroups(results: Raw[] | null | undefined, cfg: SiteSearchConfig, imgSrc: ImgSrc): SuggestGroup[] {
  return toGroups(results, cfg, imgSrc).map((g) => ({ type: g.type, label: g.label, hits: g.hits.map(toSuggestHit) }));
}

/** The one meta line under a hit, per type — "" when the type carries nothing to say. */
export function metaLine(hit: SearchHit): string {
  switch (hit.type) {
    case "products":
      return [hit.price, hit.inStock ? "" : "Sold out"].filter(Boolean).join(" · ");
    case "services":
      return [hit.category, hit.tagLine].filter(Boolean).join(" · ");
    case "posts":
      return [formatHitDate(hit.publishDate), hit.author].filter(Boolean).join(" · ");
    case "events":
      return [formatHitDate(hit.startDate), hit.location, hit.price].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

/** The results page's URL for a query (and a type) — one spelling for the box, the page and the store. */
export function searchHref(q: string, type: SearchDocType | null = null, searchPath = "/search"): string {
  const p = new URLSearchParams();
  p.set("q", clampQuery(q));
  if (type) p.set("type", type);
  return `${searchPath}?${p.toString()}`;
}
