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
//   // Clean is JUDGMENT — never auto-delete. Only obvious install samples on a fresh install;
//   // projects BEFORE collections. If it could be the owner's real content, ask first.
//   const projs = await seed.listProjects(ctx);
//   // await seed.deleteProjects(ctx, projs.filter(isObviousSample).map(p => p.id));
//   const cols = await seed.listCollections(ctx);
//   // await seed.deleteCollections(ctx, cols.filter(isObviousSample).map(c => c.id));
//
//   const collections = await seed.createCollections(ctx, [{ title, description }]);        // STEP 1
//   const projects = await seed.createProjects(ctx, [                                        // STEP 2
//     { title, description, collectionIds: [collections[0].id], details: [{ label, text }] },
//   ]);
//   // imagery ON only:
//   await seed.attachProjectCovers(ctx, projects.map((p,i) => ({ id:p.id, revision:p.revision, imageId:ids[i], height:2880, width:1920 })));
//   await seed.createProjectItems(ctx, [{ projectId: projects[0].id, sortOrder: 1, title, imageId, height:896, width:1200 }]);
//
// **NOT yet live-verified — transcribed from setup-portfolio.md.** If any call fails with a
// shape the caller didn't expect, fall back to the wix-docs skill (search + read the live Wix
// API reference) — never guess. Source recipe (authoritative):
// wix-headless/references/inline-recipes/setup-portfolio.md.

const API = "https://www.wixapis.com";

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

// STEP 0 clean helpers. Clean is JUDGMENT — never auto-delete. Delete children before parents:
// projects first, then collections (deleting a collection does not clean up its projects).
async function listProjects(ctx) {
  const r = await req(ctx, "/portfolio/v1/projects", { method: "GET" });
  return (r.projects ?? []).map((p) => ({ id: p.id, title: p.title }));
}
// No bulk-delete for projects — one DELETE call per id (each returns 200).
async function deleteProjects(ctx, ids) {
  if (!ids || !ids.length) return;
  for (const id of ids) await req(ctx, `/portfolio/v1/projects/${id}`, { method: "DELETE" });
}
async function listCollections(ctx) {
  const r = await req(ctx, "/portfolio/v1/collections", { method: "GET" });
  return (r.collections ?? []).map((c) => ({ id: c.id, title: c.title }));
}
// No bulk-delete for collections — one DELETE call per id (each returns 200).
async function deleteCollections(ctx, ids) {
  if (!ids || !ids.length) return;
  for (const id of ids) await req(ctx, `/portfolio/v1/collections/${id}`, { method: "DELETE" });
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

// Imagery opt-in — skip when imagery is off. Cover = the listing-card thumbnail. PATCH per entity,
// echoing the current revision (a missing/stale revision fails). height + width are required
// alongside the imported WixMedia image id. items: [{ id, revision, imageId, height, width }].
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

// Imagery opt-in — the project's media gallery (detail-page images) is a SEPARATE `item` entity,
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

module.exports = {
  listProjects, deleteProjects, listCollections, deleteCollections,
  createCollections, createProjects,
  attachProjectCovers, attachCollectionCovers, createProjectItems,
};
