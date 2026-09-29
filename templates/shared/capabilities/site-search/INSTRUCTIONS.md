# Site search — capability playbook

One search box, one results page, across everything the deployed verticals hold: products,
booking services, blog posts, events. Wix indexes the site's content (the Wix Site Search app), the
shipped code queries the index and links every hit to **this site's routes** — never to a Wix page.
A capability, not a vertical: it has no content and no seed of its own, it rides along with the
verticals whose entities it finds, and it is switched on from the plan.

## Switching it on

```json
{
  "capabilities": {
    "siteSearch": {
      "install": true,
      "types": ["products", "services", "posts", "events"],
      "routes": { "products": "/products/[slug]", "services": "/services/[slug]", "posts": "/blog/[slug]", "events": "/events/[slug]" },
      "labels": { "posts": "Journal" }
    }
  }
}
```

`{}` (or `true`) is enough — every field has a default. `types` is the order of the groups on the
results page, restricted to the verticals the site deploys (a type the site has no app for answers
an empty group and is dropped). `routes` are this site's item-page routes, `[slug]` replaced by the
URL-encoded slug — change one when a route is named differently (`posts: "/journal/[slug]"`).
`labels` are the group headings. `pages` (Wix-page content) exists as a type but stays off: a
headless site has no Wix pages. **`install: true` records that the seed step installs the Wix Site
Search app (below); the deploy never mutates the site.**

The deploy (`deploy.mjs <vertical…> --stack <stack> --plan plan.json`) copies the files below, adds
`@wix/search` to `package.json`, and writes `src/wix/site-search/config.generated.ts` from the plan
(`site/js/wix/site-search-config.generated.ts` on the static stack). Do not hand-edit the generated
file — edit the plan and redeploy.

## The site must be indexed — the one site mutation

Nothing is searchable until the **Wix Site Search app** (`1484cb44-49cd-5b39-9681-75188ab429de`)
is installed on the site. Before that, every search answers 200 with zero documents — silently, no
error. Install it **after the content seed**, from the project root:

```bash
node <SKILL_ROOT>/templates/shared/capabilities/site-search/seed/install.mjs
```

It mints the CLI token in-process, installs the app once (idempotent — an installed app is
reported, not re-installed), and prints `{ installed: "now" | "already" }`. The install back-fills
the site's existing content: products were searchable about 26 s later and services about 14 s
later on the probe sites — **allow half a minute**, then smoke-test before wiring any UI:
`searchAll("<a word from a seeded title>")` from the deployed data layer (or the page
`/search?q=<word>`) must return a non-empty group. Zero documents after a minute means the app is
not installed or the content is not visible to the index (hidden products, draft posts) — never that
the query is wrong. The helper behind the script is `templates/shared/seed/site.mjs`
`installSiteSearch(ctx)`, for a seed that wants to call it itself. How fast a later edit reaches the
index was not measured.

## The file map (deployed into `src/`)

| file | what it is |
|---|---|
| `wix/site-search/types.ts` | the DTOs (`SearchHit` per type, `SearchGroup`, `SearchPage`, `SearchFacets`, `SuggestGroup`, `SearchAllResult`, `SiteSearchConfig`) — contracts inlined below |
| `wix/site-search/search.ts` | `searchAll(q)`, `searchType({ q, type, … })`, `suggest(q)`, `config` — the transport (SDK `siteSearch` from `@wix/search`); every body, field name and href rule is in `search-core.ts` beside it (shared with the REST twin `rest/search.ts`) |
| `wix/site-search/search-store.ts` · `suggest-store.ts` | the results page and the header box as framework-free state machines (`createSearchStore()`, `createSuggestStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly. The suggestion debounce lives in `suggest-store.ts` — the capability's only timer |
| `wix/site-search/config.generated.ts` | written by deploy from the plan — data only |
| `hooks/site-search/useSearch.ts` · `useSuggest.ts` | React bindings of the two stores — contracts below |
| `components/site-search/SearchBox.tsx` | the header search box with suggestions — **wire as-is** in your `SiteLayout` header, `client:only="react"` |
| `components/site-search/SearchResults.tsx` (+ `SearchHit.tsx`) | the results surface — **wire as-is** on the search page, or the reference for your own on `useSearch` |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `pages/search.astro` | `/search?q=&type=` — SSR of the first result set, then the `SearchResults` island. **Keep the frontmatter** (the query clamp, the type check, the `X-Robots-Tag: noindex` header); restyle the template |

Static stack (`--stack static`): `rest/search.ts` lands flat as `js/wix/search.js` beside
`search-core.js`, `search-store.js`, `suggest-store.js`, `site-search-types.js` and the generated
config; the stores import the REST twin under the same names. No components — the page renders from
the stores (subscribe, render `getState()`, call actions), like every other vertical there.

## Wiring

1. **The header box.** In the deployed vertical's `SiteLayout.astro` (the one that won, if several
   are deployed), next to the nav or the cart button:
   `<SearchBox client:only="react" placeholder="Search" />`. It is a `<form role="search">` with a
   suggestions listbox; Enter with no active row opens `/search?q=…`. Pass `searchPath` if the page
   lives elsewhere, `onNavigate` to route client-side.
2. **The results page** ships (`pages/search.astro`) and mounts `SearchResults`. Brand it through
   the layout and the `@theme` tokens; the component's own classes read the same tokens.
3. **The routes** must exist: a hit links to `routes[type]` — the storefront's `/products/[slug]`,
   bookings' `/services/[slug]`, blog's `/blog/[...slug]`, events' `/events/[slug]`. A site that
   names one differently says so in the plan.
4. **Smoke-test** per the section above before calling the surface done.

## Contracts

```ts
// wix/site-search/search.ts
searchAll(q, { limit = 4 }): Promise<{ groups: SearchGroup[]; indexed: boolean | null }>
searchType({ q, type, limit = 12, offset = 0, sort?, filter?, fuzzy? }): Promise<SearchPage>
suggest(q, { limit = 4 }): Promise<SuggestGroup[]>     // [] under 3 chars, no request

// every hit: { id, type, title, titleHtml, excerptHtml, imageUrl, href }
//   title       plain text — aria-labels, fallbacks
//   titleHtml   the title with matched words in <mark>; TEXT AND <mark> ONLY (sanitised in core) — the
//   excerptHtml one thing you may hand to dangerouslySetInnerHTML / set:html
//   imageUrl    resolved https URL, "" when none — through imgAttrs() like every image
//   href        THIS site's route, "" when no slug could be derived → render the row unlinked
// per type: products { slug, price (formatted, as indexed), inStock, collections[] }
//           services { slug, category, tagLine }   posts { slug, publishDate (ISO), author, tags[] }
//           events { slug, startDate (ISO), location, price ("From €20" | "Free" | "") }
// SearchGroup { type, label, total, hits }    — total is the whole index's count for the type
// SearchPage  { type, hits, total, offset, limit, hasNext, facets: { terms, ranges } }
//   facets: products only — terms.collections / terms.inStock [{ value, count }],
//   ranges.discountedPriceNumeric { min, max }
// sort: "relevance" | "price-asc" | "price-desc" (products) | "date-desc" (posts, events) — sortsFor(type)
// filter (products): { collections?: string[], inStockOnly?, minPrice?, maxPrice? }

// hooks/site-search/useSearch.ts
const s = useSearch({ q, type, initialGroups, initialIndexed, initialPage });
// s.groups   SearchGroup[] | null   grouped view; null = first load in flight (skeletons), [] = nothing
// s.indexed  boolean | null         see below
// s.page     SearchPage | null      single-type view
// s.sorts, s.sort, s.filter, s.loading, s.loadingMore, s.hasMore, s.error
// s.setQuery(q) · s.setType(type | null) · s.setSort(sort) · s.setFilter(f) · s.loadMore() · s.retry()

// hooks/site-search/useSuggest.ts
const b = useSuggest({ minChars = 3, debounceMs = 300, limit = 4 });
// b.input, b.groups, b.rows (flattened), b.open, b.activeIndex, b.loading, b.error
// b.setInput(v) · b.show() · b.hide() · b.moveActive(±1) · b.setActive(i)
// b.submit() → { kind: "hit", href } | { kind: "query", q, type } | null — you route
```

**`indexed`** answers "does this site have an index at all": `true` when documents came back;
`false` when the response listed no document type — nothing is indexed, the app is not installed;
`null` when it is **unknown** — zero documents across listed types is ambiguous (no match, an empty
catalog, an index still back-filling) and must not be read as "not installed". The shipped empty
state says "still being set up" only on `false`.

## Hard rules

- **Never render the index's `url`.** On a headless site it is `""` (products) or an absolute URL
  on the Wix fallback host pointing at a page this site does not serve (services). Hrefs come from
  `hrefFor(type, slug, config)` in core; a hit without a slug renders unlinked.
- **Highlights are HTML fragments.** Only `titleHtml`/`excerptHtml` go into `set:html` or
  `dangerouslySetInnerHTML`, and only after `safeHighlight()` in core (everything but `<mark>` is
  dropped). Never interpolate a raw `_highlights` string.
- **Limits are the service's.** 100 chars for search, 50 for suggest, 3-char minimum for suggest;
  the core clamps (the service 400s otherwise). `federatedSearch` has no paging — page 2 is a
  single-type `searchType` with `offset`.
- **Products take two requests** — the default format carries `title` and `_highlights`, the
  `result-format: store-front` format carries the slug (`urlPart`) and neither carries both. The
  transports run the pair and join on id; when the second fails the products render unlinked. A
  suggestion row for a product therefore has no href — `submit()` turns it into a search for its
  title.
- **The search page is `noindex`** (the `X-Robots-Tag` header in the frontmatter).
- **Fail loudly.** A non-2xx from the search service surfaces as the store's `error` with a retry;
  the only swallowed failure is the store-front pass (it degrades to unlinked products).
- **CMS collections are not indexed** — Wix Search has no document type for them. A CMS site
  searches its collections with `queryItems(collectionId, { filters: [{ field, op: "contains", value }] })`
  (`templates/cms`); merging that into these groups is the agent's call, marked as a separate list.

## Not verified live — guarded

Two probe sites (a store with bookings, a spa) answered the observations above; the rest of the
surface is from the SDK typings and the schema page, and the code degrades where a guess would
otherwise show:

- **Blog post and event hrefs.** No probe site had posts or events. The mappers assume `url` has the
  services' shape (`…/<page>/<slug>`) and take the last path segment; an empty `url` → `href: ""`,
  an unlinked row — never a Wix URL. Verify on a site with posts/events; if `url` is empty there,
  the fallback is one read per hit (`GET /blog/v3/posts/{id}` for the slug) or dropping the type
  from `types`.
- **Visitor access.** Both search surfaces accepted an anonymous visitor token on the probe sites,
  while the platformized typings say `@applicableIdentity APP` and the docs show an admin client. If
  that door closes, the fallback is an Astro API route with `auth.elevate(wixSiteSearch.search)` per
  `CUSTOM_OPERATIONS.md`; the failure shows as the store's `error`.
- **Preview API.** The federated module (`suggest`, facets, highlights, `result-format`) is
  `@documentationMaturity preview`; `_highlights`, `documentImage`, `urlPart` are wire names. Each
  is spelled once in `search-core.ts`.
- **Filter operators.** `inStock $eq` was observed; `collections $hasSome` and
  `discountedPriceNumeric $gte/$lte` follow the schema page. A rejected filter surfaces as `error`.
- **Sorts on posts/events** (`publishDate`, `startDate`) follow the schema page's sortable fields.
- **Store-front document id.** The join reads `id` (else `_id`); a store-front document without a
  matching id leaves that product unlinked.
- **Event prices** (`minPrice` + `currency`) follow the schema page; absent → `""`.
- **Propagation of later edits** to the index was not measured (the install back-fill was: ≤ 26 s).

## Extensions (same module, not shipped)

`siteSearch.related({ documentId, documentType })` — "you may also like" on a product page;
`trending` — empty on a new site (no view data), so the empty-input state must not depend on it;
`federatedAutocomplete` — phrase completion. Add each as a function in `search.ts` and
`rest/search.ts` over a body spelled in `search-core.ts`.
