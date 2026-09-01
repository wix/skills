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
//   { "collections": [{ "title", "description"?, "hidden"?, "coverImageUrl"? | "coverImagePrompt"? }],
//     "projects":    [{ "title", "description"?, "hidden"?,
//                       "collection"? (title),        // resolved to that collection's id
//                       "details"?: [{ "label", "text" }],
//                       "coverImageUrl"? | "coverImagePrompt"?,
//                       "items"?: [{ "sortOrder", "title"?, "imageUrl" | "imagePrompt" }] }] }
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. A fresh Portfolio
// install ships its own sample content ("My Portfolio" + sample projects); removing it is the
// owner's call, not this script's. Unexpected shapes → read the live API reference;
// authoritative source recipe: wix-headless/references/inline-recipes/setup-portfolio.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveItemImages } from "../../shared/seed/images.mjs";

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
// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
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
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/list-collections.md
export async function listCollections(ctx) {
  const r = await req(ctx, "/portfolio/v1/collections", { method: "GET" });
  return (r.collections ?? []).map((c) => ({ id: c.id, title: c.title, slug: c.slug }));
}
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/list-projects.md
export async function listProjects(ctx) {
  const r = await req(ctx, "/portfolio/v1/projects", { method: "GET" });
  return (r.projects ?? []).map((p) => ({ id: p.id, title: p.title, slug: p.slug }));
}

// STEP 1 — collections. The display name is `title`, not `name`; `slug` auto-generates from
// the title; `hidden` defaults to false = shown (omit it — send true only to hide). No
// bulk-create: one call per collection.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/create-collection.md
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
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/create-project.md
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
// imported first (a raw url renders nothing); a plan `imagePrompt`/`coverImagePrompt` is
// generated (Wix AI, 1 credit) then imported. Both live in the shared util (parallel,
// resilient, never blocks the seed).
export { importImage } from "../../shared/seed/images.mjs";

// Cover = the listing-card thumbnail. PATCH per entity, echoing the current revision (missing/
// stale revision fails); height + width are required alongside the imported file id.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/update-project.md
export async function attachProjectCovers(ctx, items) {
  for (const it of items) {
    await req(ctx, `/portfolio/v1/projects/${it.id}`, {
      method: "PATCH",
      body: { project: { id: it.id, revision: it.revision, coverImage: { imageInfo: { id: it.imageId, height: it.height, width: it.width } } } },
    });
  }
}
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/update-collection.md
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
// docs: https://dev.wix.com/docs/api-reference/business-solutions/portfolio/project-items/create-project-item.md
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

  // Pass 2 — images: gallery items + project covers + collection covers, flattened into ONE
  // parallel wave (import by url / generate by prompt), then mapped back to each attach.
  // A failed image skips just that item/cover; the seed's exit never depends on images.
  const specs = [];
  const galleryRefs = [];
  projects.forEach((p, pi) => {
    for (const it of p.items ?? []) {
      galleryRefs.push({ pi, it, spec: specs.length });
      specs.push({ path: it.imagePath, url: it.imageUrl, prompt: it.imagePrompt, displayName: `${it.title || "item"}.png` });
    }
  });
  const projCoverAt = specs.length;
  projects.forEach((p) => specs.push({ path: p.coverImagePath, url: p.coverImageUrl, prompt: p.coverImagePrompt, displayName: `${p.title || "project"}-cover.png` }));
  const colCoverAt = specs.length;
  collections.forEach((c) => specs.push({ path: c.coverImagePath, url: c.coverImageUrl, prompt: c.coverImagePrompt, displayName: `${c.title || "collection"}-cover.png` }));
  const files = await resolveItemImages(ctx, specs);
  const dims = { height: 1024, width: 1024 };

  const itemsFlat = galleryRefs
    .map(({ pi, it, spec }) => (files[spec] && projs[pi]?.id
      ? { projectId: projs[pi].id, sortOrder: it.sortOrder, title: it.title, imageId: files[spec].id, ...dims }
      : null))
    .filter(Boolean);
  let items = [];
  try {
    if (itemsFlat.length) items = await createProjectItems(ctx, itemsFlat);
  } catch {
    /* the remaining gallery items stay unseeded */
  }

  const projCovers = projs
    .map((p, i) => (files[projCoverAt + i] && p.id
      ? { id: p.id, revision: p.revision, imageId: files[projCoverAt + i].id, ...dims }
      : null))
    .filter(Boolean);
  const colCovers = cols
    .map((c, i) => (files[colCoverAt + i] && c.id
      ? { id: c.id, revision: c.revision, imageId: files[colCoverAt + i].id, ...dims }
      : null))
    .filter(Boolean);
  let coversAttached = 0;
  try {
    if (projCovers.length) { await attachProjectCovers(ctx, projCovers); coversAttached += projCovers.length; }
  } catch {
    /* those projects stay cover-less */
  }
  try {
    if (colCovers.length) { await attachCollectionCovers(ctx, colCovers); coversAttached += colCovers.length; }
  } catch {
    /* those collections stay cover-less */
  }

  return {
    collections: cols,
    projects: projs,
    itemsCreated: items.length,
    coversAttached,
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
