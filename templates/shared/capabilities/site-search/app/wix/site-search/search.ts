// Site Search reads (@wix/search `siteSearch`, the federated service) over the SDK — the only file on
// this transport that sees raw search documents. The rules, bodies and mappers live in ./search-core
// (shared with the REST twin in rest/search.ts); this file is the transport only. Every call runs as
// the visitor: both search surfaces answer an anonymous visitor token (observed live; the typings say
// APP and the docs show an admin client — a closed door here means an Astro API route with
// auth.elevate(wixSiteSearch.search), per CUSTOM_OPERATIONS.md). Copy as-is; extend by adding
// functions (`related`, `trending`, `federatedAutocomplete` exist on the same module).
// docs: https://dev.wix.com/docs/api-reference/business-management/site-search/wix-site-search/search.md
import { siteSearch } from "@wix/search";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { siteSearchPlan } from "./config.generated";
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
} from "./search-core";
import type { SearchAllResult, SearchOptions, SearchPage, SiteSearchConfig, SuggestGroup } from "./types";

const search = wixModule(siteSearch);

/** The plan's siteSearch entry resolved — types in order, routes, labels. */
export const config: SiteSearchConfig = resolveConfig(siteSearchPlan);

// The store-front pass is a second request that only adds product slugs and media; when it fails the
// products render unlinked instead of failing the search.
async function storeFrontPass(run: () => Promise<Raw>): Promise<Raw | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

/**
 * Every configured type at once, `limit` hits per type — the grouped results page.
 * Products are fetched twice (default format for title and highlights, store-front for the slug,
 * see search-core) and joined on id. Empty `q` → no request, `indexed: null`.
 */
export async function searchAll(q: string, { limit = GROUP_LIMIT }: { limit?: number } = {}): Promise<SearchAllResult> {
  const query = clampQuery(q);
  if (!query) return { groups: [], indexed: null };
  const wantsProducts = config.types.includes("products");
  const [res, sf] = await Promise.all([
    search.federatedSearch(federatedBody(query, config, { limit }) as siteSearch.FederatedSearchOptions),
    wantsProducts ? storeFrontPass(() => search.federatedSearch(federatedBody(query, config, { limit, types: ["products"], storeFront: true }) as siteSearch.FederatedSearchOptions)) : null,
  ]);
  return toSearchAll(res.results as Raw[], config, imgSrc, storeFrontById(productsOf(sf?.results as Raw[] | undefined)));
}

/** One type with paging, ordering, filter and facets — the "show all" view and its pages. */
export async function searchType(o: SearchOptions): Promise<SearchPage> {
  const query = clampQuery(o.q);
  if (!query) return toPage(null, o, config, imgSrc);
  const [res, sf] = await Promise.all([
    search.search(searchBody({ ...o, q: query }, config) as siteSearch.SearchOptions),
    o.type === "products" ? storeFrontPass(() => search.search(searchBody({ ...o, q: query }, config, { storeFront: true }) as siteSearch.SearchOptions)) : null,
  ]);
  return toPage(res as Raw, { ...o, q: query }, config, imgSrc, storeFrontById(sf?.documents as Raw[] | undefined));
}

/** Suggestions for a partial phrase (3 to 50 chars; fewer → [] without a request), `limit` per type. */
export async function suggest(q: string, { limit = SUGGEST_LIMIT }: { limit?: number } = {}): Promise<SuggestGroup[]> {
  const query = clampQuery(q, MAX_SUGGEST_QUERY);
  if (query.length < MIN_SUGGEST_CHARS) return [];
  const res = await search.federatedSuggest(suggestBody(query, config, limit) as siteSearch.FederatedSuggestOptions);
  return toSuggestGroups(res.results as Raw[], config, imgSrc);
}
