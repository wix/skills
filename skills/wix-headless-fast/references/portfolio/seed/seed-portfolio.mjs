// Portfolio seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/references/portfolio/seed/seed-portfolio.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Portfolio app if needed,
// creates collections then projects (collections FIRST — a project's collectionIds are NOT
// validated, so a wrong id is silently accepted and orphans the project), creates each
// project's gallery items, and imports+attaches cover images. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "collections": [{ "title", "description"?, "hidden"?, "coverImageUrl"? }],
//     "projects":    [{ "title", "description"?, "hidden"?,
//                       "collection"? (title),        // resolved to that collection's id
//                       "details"?: [{ "label", "text" }],
//                       "coverImageUrl"?,
//                       "items"?: [{ "sortOrder", "title"?, "imageUrl" }] }] }
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. A fresh Portfolio
// install ships its own sample content ("My Portfolio" + sample projects); removing it is the
// owner's call, not this script's. Unexpected shapes → read the live API reference;
// authoritative source recipe: wix-headless/references/inline-recipes/setup-portfolio.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const API = "https://www.wixapis.com";
const PORTFOLIO_APP_ID = "d90652a2-f5a1-4c7c-84c4-d4cdcc41f130";

export function makeCtx({ cwd = process.cwd() } = {}) {
  const config = JSON.parse(readFileSync(`${cwd}/wix.config.json`, "utf8"));
  const siteId = config.siteId ?? config.projectId;
  if (!siteId) throw new Error("wix.config.json has no siteId — is this a Wix CLI project?");
  const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], {
    encoding: "utf8",
    cwd,
  }).trim();
  if (!token) throw new Error("The Wix CLI returned no token — run `npx @wix/cli@latest login` first.");
  return { token, siteId };
}

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

// ---- operations ----------------------------------------------------------------------------------

// Idempotent — re-installing returns 200.
export async function installPortfolioApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: PORTFOLIO_APP_ID, enabled: true },
    } });
  } catch {
    /* already installed is fine */
  }
}

// Read-only listing helpers (partial re-seeds, verification).
export async function listCollections(ctx) {
  const r = await req(ctx, "/portfolio/v1/collections", { method: "GET" });
  return (r.collections ?? []).map((c) => ({ id: c.id, title: c.title, slug: c.slug }));
}
export async function listProjects(ctx) {
  const r = await req(ctx, "/portfolio/v1/projects", { method: "GET" });
  return (r.projects ?? []).map((p) => ({ id: p.id, title: p.title, slug: p.slug }));
}

// STEP 1 — collections. The display name is `title`, not `name`; `slug` auto-generates from
// the title; `hidden` defaults to false = shown (omit it — send true only to hide). No
// bulk-create: one call per collection.
export async function createCollections(ctx, collections) {
  const out = [];
  for (const c of collections) {
    const body = { collection: { title: c.title, description: c.description } };
    if (c.hidden) body.collection.hidden = true;
    const r = await req(ctx, "/portfolio/v1/collections", { body });
    out.push({ id: r.collection?.id, slug: r.collection?.slug, revision: r.collection?.revision });
  }
  return out;
}

// STEP 2 — projects, AFTER collections: collectionIds must hold real ids from createCollections
// (they are NOT validated — a wrong/missing id silently orphans the project). `details` is an
// optional [{ label, text }] array. No bulk-create: one call per project.
export async function createProjects(ctx, projects) {
  const out = [];
  for (const p of projects) {
    const project = {
      title: p.title,
      description: p.description,
      collectionIds: p.collectionIds ?? [],
    };
    if (p.details) project.details = p.details;
    if (p.hidden) project.hidden = true;
    const r = await req(ctx, "/portfolio/v1/projects", { body: { project } });
    out.push({ id: r.project?.id, slug: r.project?.slug, revision: r.project?.revision });
  }
  return out;
}

// Portfolio binds covers + gallery items by Wix Media file ID — an external url must be
// imported first; a raw url renders nothing.
export async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { body: { url, mimeType: "image/png", displayName } });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

// Cover = the listing-card thumbnail. PATCH per entity, echoing the current revision (missing/
// stale revision fails); height + width are required alongside the imported file id.
export async function attachProjectCovers(ctx, items) {
  for (const it of items) {
    await req(ctx, `/portfolio/v1/projects/${it.id}`, {
      method: "PATCH",
      body: { project: { id: it.id, revision: it.revision, coverImage: { imageInfo: { id: it.imageId, height: it.height, width: it.width } } } },
    });
  }
}
export async function attachCollectionCovers(ctx, items) {
  for (const it of items) {
    await req(ctx, `/portfolio/v1/collections/${it.id}`, {
      method: "PATCH",
      body: { collection: { id: it.id, revision: it.revision, coverImage: { imageInfo: { id: it.imageId, height: it.height, width: it.width } } } },
    });
  }
}

// The detail-page gallery is a SEPARATE `item` entity — one POST per image; sortOrder (1,2,3…)
// sets render order. Lowercase `items` — `/Items` 404s. There is NO public list endpoint.
export async function createProjectItems(ctx, items) {
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
 * ONE-CALL seed: install → collections → projects (into collections) → gallery items →
 * covers, ids threaded in memory. The default path.
 */
export async function setupPortfolio(ctx, { collections = [], projects = [] } = {}) {
  await installPortfolioApp(ctx);

  const cols = await createCollections(ctx, collections);
  const idByTitle = new Map(collections.map((c, i) => [c.title, cols[i].id]));

  const projs = await createProjects(
    ctx,
    projects.map((p) => ({
      title: p.title,
      description: p.description,
      details: p.details,
      hidden: p.hidden,
      collectionIds: p.collection ? [idByTitle.get(p.collection)].filter(Boolean) : [],
    })),
  );

  const toImage = async (url, name) => {
    const file = await importImage(ctx, url, name);
    return { imageId: file.id, height: 1024, width: 1024 };
  };

  // Gallery items (import each image; a failed import skips just that item).
  const itemsFlat = [];
  for (let i = 0; i < projects.length; i++) {
    for (const it of projects[i].items ?? []) {
      if (!it.imageUrl) continue;
      try {
        const img = await toImage(it.imageUrl, `${it.title || "item"}.png`);
        itemsFlat.push({ projectId: projs[i].id, sortOrder: it.sortOrder, title: it.title, ...img });
      } catch {
        /* skip this item's image */
      }
    }
  }
  const items = itemsFlat.length ? await createProjectItems(ctx, itemsFlat) : [];

  // Covers (import each; a failed import skips just that cover — the entity stays text-only).
  const projCovers = [];
  for (let i = 0; i < projects.length; i++) {
    if (!projects[i].coverImageUrl) continue;
    try {
      const img = await toImage(projects[i].coverImageUrl, `${projects[i].title || "project"}-cover.png`);
      projCovers.push({ id: projs[i].id, revision: projs[i].revision, ...img });
    } catch {
      /* skip */
    }
  }
  if (projCovers.length) await attachProjectCovers(ctx, projCovers);

  const colCovers = [];
  for (let i = 0; i < collections.length; i++) {
    if (!collections[i].coverImageUrl) continue;
    try {
      const img = await toImage(collections[i].coverImageUrl, `${collections[i].title || "collection"}-cover.png`);
      colCovers.push({ id: cols[i].id, revision: cols[i].revision, ...img });
    } catch {
      /* skip */
    }
  }
  if (colCovers.length) await attachCollectionCovers(ctx, colCovers);

  return {
    collections: cols,
    projects: projs,
    itemsCreated: items.length,
    coversAttached: projCovers.length + colCovers.length,
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-portfolio.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupPortfolio(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
