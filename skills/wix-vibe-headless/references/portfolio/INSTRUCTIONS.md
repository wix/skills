
# Wix Portfolio Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and this vertical's `references/portfolio/wix-portfolio.js`. Copy **both** into your app's `src/rest/` side by side — the helper does `import { wixApiRequest } from "./wix-client.js"`, so they must land in the same folder.

Builds a real, client-only Wix portfolio showcase. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Portfolio is **read-only**: never mock projects, never invent media,
and always render live Wix data (or an honest empty state). The content tree is
**Collection → Project → Project Item (image/video)**.

## When to use
- User wants a Wix portfolio / showcase site or asks to "connect Wix Portfolio".
- Replacing placeholder/mock galleries with live Wix Portfolio data.
- Adding a collections gallery, project grids, or a project detail page (media gallery +
  details/links) over an existing Wix Portfolio.

## Prerequisites
1. A Wix site with **Wix Portfolio installed and content already added** — at least one
   collection with projects, and projects with items (this skill does NOT provision; it is
   read-only over the content).
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the Wix
   Business Manager surfaces a copyable prompt with the id filled in — see the router `SKILL.md`).
   Paste it into `src/rest/wix-client.js` in place of the placeholder. It is a visitor-facing
   credential (it only mints anonymous visitor tokens), **not** a secret, so
   hardcoding/committing it is fine.
3. If the read calls return `403`/`428` before content is published, the Portfolio app or its
   content may not be live yet. That is a **Wix dashboard setup step the owner completes** —
   out of this skill's scope. Flag it and continue; don't fall back to mock data.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the portfolio's UI however the
project wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only
adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to the
  id from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor refresh token is
  persisted to localStorage; do not re-mint anonymously per load.
- `src/rest/wix-portfolio.js` — exports:
  - **Collections:** `queryCollections`, `getCollectionBySlug`, `countCollections`
  - **Projects:** `queryProjects`, `queryProjectsByCollection`, `getProjectBySlug`, `getProject`
  - **Project items (media):** `listProjectItems`

The Collection, Project, and Project Item shapes are documented as JSDoc comments at the top of
`wix-portfolio.js`. Read them before building the UI — they describe the key fields (cover
image/video, media resolutions, details rows) and link to the full API reference.

## How to wire it (UI is the project's choice)

**Every list helper returns an object, not a bare array** — destructure the named key first, or
`.map`/`.filter` on the result throws `… is not a function` (the #1 portfolio-listing bug):
`queryCollections()` → `{ collections, nextCursor }`; `queryProjects()` /
`queryProjectsByCollection(id)` → `{ projects, nextCursor }`; `listProjectItems(id)` →
`{ items, total }`. Single fetches (`getCollectionBySlug`, `getProjectBySlug`, `getProject`)
return the object or `null`; `countCollections()` returns a number.

- **Collections gallery (home)** — `const { collections, nextCursor } = await queryCollections()`
  for the listing (visible collections only, in dashboard order); pass `nextCursor` back as
  `cursor` to load the next page. Render `collection.title`, `collection.description`, and
  `collection.coverImage.imageInfo.url`. Link each card to a collection page keyed on
  `collection.slug`.
- **Collection page** — `getCollectionBySlug(slug)` for the header (returns null on miss — show
  a not-found state, never invent one). Then
  `const { projects, nextCursor } = await queryProjectsByCollection(collection.id, { limit?, cursor? })`
  for its project grid; paginate exactly like `queryCollections`.
- **All-work gallery (optional)** —
  `const { projects, nextCursor } = await queryProjects()` to list every visible project across
  collections (newest-first); paginate the same way.
- **Project grid card** — render `project.title` and the cover: use `project.coverImage.imageInfo.url`
  when present, else the `project.coverVideo.videoInfo.posters[0]` / first
  `coverVideo.videoInfo.resolutions[]` entry. Link each card to a project page keyed on `project.slug`.
- **Project detail page** — `getProjectBySlug(slug)` for the header (title, description, and the
  `details[]` rows: each has a `label` plus either `text` or `link: { text, url, target }`).
  Then `const { items, total } = await listProjectItems(project.id)` for the media gallery —
  `items` is the array (the helper returns `{ items, total }`, **not** a bare array; iterate
  `items`). Branch on **`item.type`**, which is `"IMAGE" | "VIDEO" | "UNDEFINED"`: render IMAGE
  items from `item.image.imageInfo.url` and VIDEO items from the first
  `item.video.videoInfo.resolutions[]` entry's `url` (with `item.video.videoInfo.posters[0]` as
  the poster). Honor each item's optional `item.link: { text, url, target }` (same link shape as
  the `details[]` rows above).
  - If you already hold a project id (not a slug), use `getProject(projectId)` instead.
- **Empty state** — if `countCollections()` is 0, show an empty state telling the user to add
  collections and projects in their Wix dashboard. Never invent projects or media.

## Worked snippets (headless — adapt the logic, restyle freely)

Portfolio ships no UI components; these are illustrative wiring, not files to copy verbatim.
The data paths (return-object destructuring, field paths, `item.type` branching, `details[]`
link shape) are the load-bearing part — keep those exactly and restyle the markup to the brand.

**`pages/Portfolio.jsx`** — collections gallery (grid + empty state + paging). `queryCollections`
returns `{ collections, nextCursor }` — an object, not an array. Keep the destructuring.

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryCollections, countCollections } from "@/rest/wix-portfolio";

export default function Portfolio() {
  const [collections, setCollections] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [total, setTotal] = useState(null);

  useEffect(() => {
    countCollections().then(setTotal);                       // number → 0 means empty state
    // NB: destructure — queryCollections returns { collections, nextCursor }, not an array.
    queryCollections({ limit: 24 }).then(({ collections, nextCursor }) => {
      setCollections(collections);
      setCursor(nextCursor);
    });
  }, []);

  const loadMore = () =>
    queryCollections({ limit: 24, cursor }).then(({ collections: more, nextCursor }) => {
      setCollections((c) => [...c, ...more]);
      setCursor(nextCursor);
    });

  if (total === 0) return <p>{/* empty state — add collections in the Wix dashboard */}</p>;
  return (
    <div /* restyle */>
      <div /* grid */>
        {collections.map((c) => (
          <Link key={c.id} to={`/collection/${c.slug}`} /* restyle */>
            {c.coverImage?.imageInfo?.url && (
              <img src={c.coverImage.imageInfo.url} alt={c.title} loading="lazy" />
            )}
            <h3>{c.title}</h3>
            {c.description && <p>{c.description}</p>}
          </Link>
        ))}
      </div>
      {cursor && <button onClick={loadMore}>Load more</button>}
    </div>
  );
}
```

**`pages/ProjectDetail.jsx`** — project header + `details[]` rows + media gallery. Two shapes to
keep: `listProjectItems` returns `{ items, total }` (iterate `items`), and each item branches on
`item.type`. Videos render from `resolutions[].url` (the confirmed field).

```jsx
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { getProjectBySlug, listProjectItems } from "@/rest/wix-portfolio";

// media item: branch on item.type ("IMAGE" | "VIDEO" | "UNDEFINED")
function ProjectMedia({ item }) {
  if (item.type === "IMAGE")
    return <img src={item.image?.imageInfo?.url} alt={item.title || ""} loading="lazy" />;
  if (item.type === "VIDEO") {
    const src = item.video?.videoInfo?.resolutions?.[0]?.url; // resolutions[].url is the confirmed field
    // poster: item.video.videoInfo.posters[0] — poster-entry sub-shape isn't in the helper
    // JSDoc; if you need the poster image URL, confirm the field in wix-docs before using it.
    return <video src={src} controls playsInline />;
  }
  return null; // UNDEFINED — nothing renderable
}

export default function ProjectDetail() {
  const { slug } = useParams();
  const [project, setProject] = useState(null);
  const [items, setItems] = useState([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getProjectBySlug(slug).then((p) => {
      if (!p) return setNotFound(true);                      // null on miss → not-found state
      setProject(p);
      // NB: destructure — listProjectItems returns { items, total }, not an array.
      listProjectItems(p.id).then(({ items }) => setItems(items));
    });
  }, [slug]);

  if (notFound) return <div>Project not found.</div>;
  if (!project) return <div>Loading…</div>;
  return (
    <div /* restyle */>
      <h1>{project.title}</h1>
      {project.description && <p>{project.description}</p>}
      {/* details[] row: { label, text? } OR { label, link: { text, url, target } } */}
      <dl>
        {(project.details || []).map((d, i) => (
          <div key={i}>
            <dt>{d.label}</dt>
            <dd>
              {d.link ? (
                <a href={d.link.url} target={d.link.target}>{d.link.text}</a>
              ) : (
                d.text
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div /* gallery grid */>
        {items.map((item) => (
          <figure key={item.id}>
            {item.link ? (
              <a href={item.link.url} target={item.link.target}><ProjectMedia item={item} /></a>
            ) : (
              <ProjectMedia item={item} />
            )}
            {item.title && <figcaption>{item.title}</figcaption>}
          </figure>
        ))}
      </div>
    </div>
  );
}
```

## Hard rules (do not violate)
- ✅ Render only live Wix Portfolio data — collections, projects, and items as returned.
- ❌ Never mock projects, collections, or media — render live data or the empty state.
- ❌ Never hand-build Wix Media URLs or page permalinks — use the `url`/`imageInfo.url`/
  `videoInfo.resolutions[].url` fields Wix returns.
- ❌ Never invent project details, captions, dates, or testimonials. Show only what the API returns.
- ❌ Never show `hidden: true` collections or projects to visitors (the helpers already filter
  `hidden` out — don't add them back).
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ Route on `slug` (`getCollectionBySlug` / `getProjectBySlug`); fall back to `getProject(id)`
  only when you hold a GUID.
- The helpers fail soft on read: single fetches return `null` on a miss so you render a
  not-found/empty state rather than a crash — surface that state, don't paper over it with fake data.

## Beyond the snippets
The snippets cover the common portfolio paths. If you hit a use case they don't cover (e.g.
collection SEO tags, project watermark settings, portfolio-wide settings, or filtering by a
field not shown), make the call yourself with `wixApiRequest` — but look up the exact endpoint,
HTTP method, and request body in the **official Wix API reference** first; never guess:
- Wix Portfolio API reference: https://dev.wix.com/docs/api-reference/business-solutions/portfolio.md
- Portfolio Settings (logo, layout, options): https://dev.wix.com/docs/api-reference/business-solutions/portfolio/portfolio-settings/get-portfolio-settings.md
- API query language (filters, sort, paging): https://dev.wix.com/docs/rest/articles/getting-started/api-query-language.md

Keep the snippets as the default for everything they already do; reach for the API reference
only for the gap.

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the portfolio content for their site. To facilitate this, provide the user with deep links directly to the relevant dashboard pages. For portfolio data those pages are:
- **Portfolio** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-portfolio/projects` (`Dashboard → Portfolio`). Projects and Collections are tabs on this one page: the **Projects** tab adds projects and their media galleries; the **Collections** tab groups projects into collections.

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (no re-mint storm; reads stay fast)
- [ ] Collections gallery renders live collections with cover images, in dashboard order
- [ ] Clicking a collection lists its projects via `queryProjectsByCollection`
- [ ] Project page renders the project's media gallery from `listProjectItems` (images AND videos)
- [ ] Project `details[]` rows render (text rows and link rows both)
- [ ] Slug routing works; an unknown slug shows a not-found state (no invented project)
- [ ] Hidden collections/projects never appear
- [ ] Empty state shown when `countCollections()` is 0
- [ ] No mock projects, collections, or media anywhere
- [ ] Told the user at least once that they can continue setting up their portfolio in the dashboard and provided deep links.
