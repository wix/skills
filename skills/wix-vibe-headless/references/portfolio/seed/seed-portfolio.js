// Portfolio seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// The agent requires this and calls the functions with plain data; all Wix Portfolio
// request/response mechanics (the collection/project wrappers, title-not-name, the
// hidden-defaults-to-false polarity, collections-before-projects, cover PATCH + gallery
// items) live here, once.
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // Base44
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/portfolio/seed/seed-portfolio.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//
//   const collections = await seed.createCollections(ctx, [{ title, description }]);        // STEP 1
//   const projects = await seed.createProjects(ctx, [                                        // STEP 2
//     { title, description, collectionIds: [collections[0].id], details: [{ label, text }] },
//   ]);
//   // optional — import each image url to Wix Media first (portfolio binds by file id), then attach.
//   const files = await Promise.all(imageUrls.map((u) => seed.importImage(ctx, u)));   // → [{ id, url }]
//   await seed.attachProjectCovers(ctx, projects.map((p,i) => ({ id:p.id, revision:p.revision, imageId:files[i].id, height:1024, width:1024 })));
//   await seed.createProjectItems(ctx, [{ projectId: projects[0].id, sortOrder: 1, title, imageId: files[0].id, height:1024, width:1024 }]);
//
// **NOT yet live-verified — transcribed from setup-portfolio.md.** If any call fails with a
// shape the caller didn't expect, fall back to the wix-docs skill (search + read the live Wix
// API reference) — never guess. Source recipe (authoritative):
// wix-headless/references/inline-recipes/setup-portfolio.md.

const API = "https://www.wixapis.com";
const PORTFOLIO_APP_ID = "d90652a2-f5a1-4c7c-84c4-d4cdcc41f130"; // installPortfolioApp installs this before seeding

async function req(ctx, path, { method = "POST", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "wix-site-id": ctx.siteId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

// ---- exported operations ----

// Read-only listing helpers.
async function listProjects(ctx) {
  const r = await req(ctx, "/portfolio/v1/projects", { method: "GET" });
  return (r.projects ?? []).map((p) => ({ id: p.id, title: p.title }));
}
async function listCollections(ctx) {
  const r = await req(ctx, "/portfolio/v1/collections", { method: "GET" });
  return (r.collections ?? []).map((c) => ({ id: c.id, title: c.title }));
}

/**
 * STEP 1 — Create the collections. MUST run before createProjects: a project's collectionIds
 * are NOT validated, so projects need the real collection ids read back from here.
 * @param collections [{ title, description?, hidden? }]  (display name is `title`, not `name`;
 *   `slug` auto-generates from title when omitted; `hidden` defaults to false = shown, so omit
 *   it for a visible collection and send `hidden: true` only to hide.)
 *   No bulk-create — one call per collection; concurrent is safe (no 409 race) but sequential
 *   is just as correct and simplest.
 * @returns [{ id, slug, revision }]  (id feeds each project's collectionIds; revision feeds covers)
 */
async function createCollections(ctx, collections) {
  const out = [];
  for (const c of collections) {
    const body = { collection: { title: c.title, description: c.description } };
    if (c.hidden) body.collection.hidden = true; // omit otherwise — defaults to shown
    const r = await req(ctx, "/portfolio/v1/collections", { body });
    out.push({ id: r.collection?.id, slug: r.collection?.slug, revision: r.collection?.revision });
  }
  return out;
}

/**
 * STEP 2 — Create the projects, each assigned to its collection(s) via collectionIds.
 * @param projects [{ title, description?, collectionIds: [id], details?, hidden? }]
 *   collectionIds MUST hold real ids from createCollections — they are NOT validated, so a
 *   wrong/missing id is accepted silently and orphans the project (reachable only from the
 *   all-projects list). `details` is an optional [{ label, text }] array (Role, Year, Client…).
 *   `hidden` defaults to false = shown. No bulk-create — one call per project; concurrent safe.
 * @returns [{ id, slug, revision }]  (revision feeds attachProjectCovers)
 */
async function createProjects(ctx, projects) {
  const out = [];
  for (const p of projects) {
    const project = {
      title: p.title,
      description: p.description,
      collectionIds: p.collectionIds ?? [],
    };
    if (p.details) project.details = p.details;
    if (p.hidden) project.hidden = true; // omit otherwise — defaults to shown
    const r = await req(ctx, "/portfolio/v1/projects", { body: { project } });
    out.push({ id: r.project?.id, slug: r.project?.slug, revision: r.project?.revision });
  }
  return out;
}

// Import an external image URL into Wix Media → { id, url }. Portfolio binds covers + gallery items
// by the Wix Media file **id**, NOT a url — an external url (e.g. a base44 generate_image result)
// MUST be imported first; the raw url renders nothing. id = wixstatic file id, url = wixstatic url.
async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { body: { url, mimeType: "image/png", displayName } });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

// Optional — pass a cover/items to attach, omit to skip. Cover = the listing-card thumbnail. PATCH per entity,
// echoing the current revision (a missing/stale revision fails). height + width are required
// alongside the imported WixMedia image id (from importImage). items: [{ id, revision, imageId, height, width }].
async function attachProjectCovers(ctx, items) {
  for (const it of items) {
    await req(ctx, `/portfolio/v1/projects/${it.id}`, {
      method: "PATCH",
      body: { project: { id: it.id, revision: it.revision, coverImage: { imageInfo: { id: it.imageId, height: it.height, width: it.width } } } },
    });
  }
}
async function attachCollectionCovers(ctx, items) {
  for (const it of items) {
    await req(ctx, `/portfolio/v1/collections/${it.id}`, {
      method: "PATCH",
      body: { collection: { id: it.id, revision: it.revision, coverImage: { imageInfo: { id: it.imageId, height: it.height, width: it.width } } } },
    });
  }
}

// Optional — the project's media gallery (detail-page images) is a SEPARATE `item` entity,
// one POST per image. sortOrder (1,2,3…) sets render order. lowercase `items` — `/Items` 404s.
// There is NO public list endpoint. items: [{ projectId, sortOrder, title, imageId, height, width }].
async function createProjectItems(ctx, items) {
  const out = [];
  for (const it of items) {
    const r = await req(ctx, "/portfolio/v1/items", {
      body: { item: { projectId: it.projectId, sortOrder: it.sortOrder, title: it.title, image: { imageInfo: { id: it.imageId, height: it.height, width: it.width } } } },
    });
    out.push({ id: r.item?.id });
  }
  return out;
}

/**
 * DEFAULT one-call path — seed a whole portfolio from one plan; ids stay in memory so
 * collections→projects→items→covers are wired without hand-threading ids. Order matches SEED.md:
 * createCollections → createProjects (into collections) → createProjectItems → attach*Covers.
 * @param plan {
 *   collections: [{ title, description?, hidden?, coverImageUrl? }],
 *   projects:    [{ title, description?, details?, hidden?,
 *                   collection?: "<collection title>",   // resolved to that collection's id
 *                   items?: [{ sortOrder, title, imageUrl }],
 *                   coverImageUrl? }],
 * }
 *   coverImageUrl / items[].imageUrl are plain image urls — imported to Wix Media here. Covers/items
 *   are optional — a project/collection without one skips it.
 * @returns { collections:[{id,slug,revision}], projects:[{id,slug,revision}], itemsCreated, coversAttached }
 */
// Install the Wix Portfolio app before seeding — base44 sites aren't guaranteed to have it (no
// separate Setup step here, unlike the wix-headless recipe). Idempotent: re-installing returns 200.
async function installPortfolioApp(ctx) {
  return req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
    tenant: { tenantType: "SITE", id: ctx.siteId },
    appInstance: { appDefId: PORTFOLIO_APP_ID, enabled: true },
  } });
}

async function setupPortfolio(ctx, { collections = [], projects = [] } = {}) {
  await installPortfolioApp(ctx);
  const cols = await createCollections(ctx, collections);               // STEP 1
  const idByName = new Map(collections.map((c, i) => [c.title, cols[i].id]));

  const projs = await createProjects(                                   // STEP 2
    ctx,
    projects.map((p) => ({
      title: p.title, description: p.description, details: p.details, hidden: p.hidden,
      collectionIds: p.collection ? [idByName.get(p.collection)].filter(Boolean) : [],
    })),
  );

  // resolve a plain image url → { imageId, height, width } by importing to Wix Media (binds by file id)
  const toImage = async (url, name) => {
    const file = await importImage(ctx, url, name);
    return { imageId: file.id, height: 1024, width: 1024 };
  };

  // STEP 3 — project media-gallery items (import each image; a failed import skips that item)
  const itemsFlat = [];
  for (let i = 0; i < projects.length; i++) {
    for (const it of projects[i].items ?? []) {
      if (!it.imageUrl) continue;
      try {
        const img = await toImage(it.imageUrl, `${it.title || "item"}.png`);
        itemsFlat.push({ projectId: projs[i].id, sortOrder: it.sortOrder, title: it.title, ...img });
      } catch { /* skip this item's image */ }
    }
  }
  const items = itemsFlat.length ? await createProjectItems(ctx, itemsFlat) : [];

  // STEP 4 — covers (import each; a failed import skips that cover)
  const projCovers = [];
  for (let i = 0; i < projects.length; i++) {
    if (!projects[i].coverImageUrl) continue;
    try {
      const img = await toImage(projects[i].coverImageUrl, `${projects[i].title || "project"}-cover.png`);
      projCovers.push({ id: projs[i].id, revision: projs[i].revision, ...img });
    } catch { /* skip */ }
  }
  if (projCovers.length) await attachProjectCovers(ctx, projCovers);

  const colCovers = [];
  for (let i = 0; i < collections.length; i++) {
    if (!collections[i].coverImageUrl) continue;
    try {
      const img = await toImage(collections[i].coverImageUrl, `${collections[i].title || "collection"}-cover.png`);
      colCovers.push({ id: cols[i].id, revision: cols[i].revision, ...img });
    } catch { /* skip */ }
  }
  if (colCovers.length) await attachCollectionCovers(ctx, colCovers);

  return {
    collections: cols,
    projects: projs,
    itemsCreated: items.length,
    coversAttached: projCovers.length + colCovers.length,
  };
}

module.exports = {
  setupPortfolio, installPortfolioApp,
  listProjects, listCollections,
  createCollections, createProjects, importImage,
  attachProjectCovers, attachCollectionCovers, createProjectItems,
};
