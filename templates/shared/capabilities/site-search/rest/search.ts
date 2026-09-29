// Site Search reads over REST — the twin of app/wix/site-search/search.ts. Same exports, same DTOs;
// the bodies and mappers come from search-core (the SAME file the SDK transport uses, deployed flat
// next to this one by deploy.mjs --stack static), so this file is only the transport: one fetch with
// a literal body per function. Every call here answers a visitor token (observed live). Porting:
// keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-management/site-search/wix-site-search/search.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { siteSearchPlan } from "./site-search-config.generated.js";
import {
  GROUP_LIMIT,
  MIN_SUGGEST_CHARS,
  MAX_SUGGEST_QUERY,
  SUGGEST_LIMIT,
  clampQuery,
  federatedBody,
  productsOf,
  resolveConfig,
  searchBody,
  storeFrontById,
  suggestBody,
  toPage,
  toSearchAll,
  toSuggestGroups,
  type Raw,
} from "./search-core.js";
import type { SearchAllResult, SearchOptions, SearchPage, SiteSearchConfig, SuggestGroup } from "./types.js";

/** The plan's siteSearch entry resolved — types in order, routes, labels. */
export const config: SiteSearchConfig = resolveConfig(siteSearchPlan);

// The store-front pass only adds product slugs and media; when it fails the products render unlinked.
async function storeFrontPass(run: () => Promise<Raw>): Promise<Raw | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

/**
 * Every configured type at once, `limit` hits per type. Products are fetched twice (default format
 * for title and highlights, store-front for the slug) and joined on id.
 * POST /sitesearch/v1/search/federated  { query, documentTypes, limit, fuzzy, highlight, properties? }
 * → { results: [{ documentType, documents, total }] }
 */
export async function searchAll(q: string, { limit = GROUP_LIMIT }: { limit?: number } = {}): Promise<SearchAllResult> {
  const query = clampQuery(q);
  if (!query) return { groups: [], indexed: null };
  const wantsProducts = config.types.includes("products");
  const [res, sf] = await Promise.all([
    wixRequest<Raw>("/sitesearch/v1/search/federated", { body: federatedBody(query, config, { limit }) }),
    wantsProducts ? storeFrontPass(() => wixRequest<Raw>("/sitesearch/v1/search/federated", { body: federatedBody(query, config, { limit, types: ["products"], storeFront: true }) })) : null,
  ]);
  return toSearchAll(res?.results, config, imgSrc, storeFrontById(productsOf(sf?.results)));
}

/**
 * One type with paging, ordering, filter and facets.
 * POST /sitesearch/v1/search  { query, documentType, paging: { limit, offset }, ordering?, filter?, facets?, fuzzy, highlight }
 * → { documents, nextPage: { total, skip, limit }, facets }
 */
export async function searchType(o: SearchOptions): Promise<SearchPage> {
  const query = clampQuery(o.q);
  if (!query) return toPage(null, o, config, imgSrc);
  const [res, sf] = await Promise.all([
    wixRequest<Raw>("/sitesearch/v1/search", { body: searchBody({ ...o, q: query }, config) }),
    o.type === "products" ? storeFrontPass(() => wixRequest<Raw>("/sitesearch/v1/search", { body: searchBody({ ...o, q: query }, config, { storeFront: true }) })) : null,
  ]);
  return toPage(res, { ...o, q: query }, config, imgSrc, storeFrontById(sf?.documents));
}

/**
 * Suggestions for a partial phrase (3 to 50 chars; fewer → [] without a request), `limit` per type.
 * POST /sitesearch/v1/suggest/federated  { query, documentTypes, limit }  → { results: [{ documentType, documents }] }
 */
export async function suggest(q: string, { limit = SUGGEST_LIMIT }: { limit?: number } = {}): Promise<SuggestGroup[]> {
  const query = clampQuery(q, MAX_SUGGEST_QUERY);
  if (query.length < MIN_SUGGEST_CHARS) return [];
  const res = await wixRequest<Raw>("/sitesearch/v1/suggest/federated", { body: suggestBody(query, config, limit) });
  return toSuggestGroups(res?.results, config, imgSrc);
}
