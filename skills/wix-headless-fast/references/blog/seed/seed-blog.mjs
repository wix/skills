// Blog seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/references/blog/seed/seed-blog.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Blog app if needed, resolves
// a real author memberId (every post create requires one), creates categories/tags (idempotent
// by label, with a fresh-install verify-retry), bulk-creates PUBLISHED posts with Ricos
// richContent, and imports+attaches cover images (PATCH + re-publish). Prints a JSON result
// to stdout.
//
// Plan shape (see SEED.md):
//   { "categories"?: [name], "tags"?: [name],
//     "posts": [{ "title", "content": [blocks] | "richContent"?, "category"?|"categories"?,
//                 "tags"?, "coverImageUrl"? | "coverImagePrompt"? }] }
//   content blocks: { type:"heading", text, level? } | { type:"paragraph", text }
//     | { type:"quote", text } | { type:"bulleted"|"ordered", items:[text,…] }
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. Unexpected shapes →
// read the live API reference; authoritative source recipe:
// wix-headless/references/inline-recipes/setup-blog.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveItemImages } from "../../shared/seed/images.mjs";

const API = "https://www.wixapis.com";
const BLOG_APP_ID = "14bcded7-0066-7c35-14d7-466cb3f09103";

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

// A draft-post write can answer 401 "No identity found" right after the app installs — a
// server-side async-identity defect, not a bad token or a bad body. Retry the same request once,
// then fail loud. (wix-headless/references/inline-recipes/setup-blog.md)
async function reqRetryOnce(ctx, path, opts) {
  try {
    return await req(ctx, path, opts);
  } catch (e) {
    if (!/-> 401:/.test(String(e.message))) throw e;
    await sleep(3000);
    return req(ctx, path, opts);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Ricos richContent builder (setup-blog.md § "CRITICAL RICOS NESTING") --------------------
// Rules baked in: TEXT is always a leaf inside a container; BLOCKQUOTE / LIST_ITEM wrap a
// PARAGRAPH; BULLETED_LIST / ORDERED_LIST wrap LIST_ITEM -> PARAGRAPH -> TEXT; every container
// node gets a unique id, TEXT leaves use id "". For node types not covered here (code, images)
// pass a pre-built `richContent` on the post instead — it's used verbatim.
const mkText = (text) => ({ type: "TEXT", id: "", nodes: [], textData: { text: text || "", decorations: [] } });
const mkParagraph = (id, text) => ({ type: "PARAGRAPH", id, nodes: [mkText(text)], paragraphData: {} });

function mkRichContent(blocks = [], postIdx = 0) {
  let n = 0;
  const id = () => `p${postIdx}-n${n++}`;
  const nodes = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        nodes.push({ type: "HEADING", id: id(), nodes: [mkText(b.text)], headingData: { level: b.level ?? 2 } });
        break;
      case "quote":
        nodes.push({ type: "BLOCKQUOTE", id: id(), nodes: [mkParagraph(id(), b.text)], blockquoteData: { indentation: 1 } });
        break;
      case "bulleted":
      case "ordered": {
        const listType = b.type === "bulleted" ? "BULLETED_LIST" : "ORDERED_LIST";
        nodes.push({
          type: listType, id: id(),
          nodes: (b.items ?? []).map((item) => ({ type: "LIST_ITEM", id: id(), nodes: [mkParagraph(id(), item)] })),
        });
        break;
      }
      case "paragraph":
      default:
        nodes.push(mkParagraph(id(), b.text));
    }
  }
  return { nodes };
}

// One post's plain data -> a flat Blog V3 draft-post object. media is omitted — covers are a
// separate pass (attachPostCovers), per the recipe.
function buildPost(p, i, memberId) {
  return {
    title: p.title,
    memberId,
    richContent: p.richContent ?? mkRichContent(p.content, i),
    ...(p.categoryIds ? { categoryIds: p.categoryIds } : {}),
    ...(p.tagIds ? { tagIds: p.tagIds } : {}),
  };
}

// ---- operations ----------------------------------------------------------------------------

// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export async function installBlogApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: BLOG_APP_ID, enabled: true },
    } });
  } catch {
    /* already installed is fine */
  }
}

// Every post create needs a REAL author memberId — a fabricated id fails with
// "memberIds ... do not exist". A provisioned site has the owner as members[0].
// docs: https://dev.wix.com/docs/api-reference/crm/members-contacts/members/members/list-members.md
export async function getAuthorMemberId(ctx) {
  const r = await req(ctx, "/members/v1/members?fieldsets=PUBLIC&paging.limit=1", { method: "GET" });
  const id = r.members?.[0]?.id;
  if (!id) throw new Error(`No site member found for author attribution: ${JSON.stringify(r).slice(0, 400)}`);
  return id;
}

/**
 * Create posts, PUBLISHED (publish:true — unpublished posts never reach visitors).
 * Endpoint auto-selected per the recipe: single-post endpoint for exactly one (nested
 * `{ draftPost }` envelope), bulk for >= 2 — `bulk` sits BETWEEN v3 and draft-posts, and each
 * bulk item is FLAT (wrapping it in `draftPost` 400s). Returns [{ id, index, success }].
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/create-draft-post.md
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/bulk-create-draft-posts.md
 */
export async function createPosts(ctx, posts, { memberId, publish = true } = {}) {
  if (!memberId) throw new Error("createPosts requires opts.memberId (see getAuthorMemberId)");
  if (posts.length === 1) {
    const r = await reqRetryOnce(ctx, "/blog/v3/draft-posts", { body: { draftPost: buildPost(posts[0], 0, memberId), publish } });
    return [{ id: r.draftPost?.id, index: 0, success: !!r.draftPost?.id }];
  }
  const r = await reqRetryOnce(ctx, "/blog/v3/bulk/draft-posts/create", {
    body: { draftPosts: posts.map((p, i) => buildPost(p, i, memberId)), publish },
  });
  // Bulk returns 200 even on partial failure — read per-item results[].itemMetadata.success.
  return (r.results ?? []).map((x) => ({
    id: x.itemMetadata?.id, index: x.itemMetadata?.originalIndex, success: !!x.itemMetadata?.success,
  }));
}

// Existing label -> id, straight from the query (the source of truth for what persisted).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/query-tags.md
async function labelIdMap(ctx, kind) {
  const path = kind === "categories" ? "/blog/v3/categories/query" : "/v3/tags/query";
  const r = await req(ctx, path, { body: { query: { paging: { limit: 100 } } } });
  return new Map((r[kind] ?? []).map((x) => [x.label, x.id]));
}

// Create category/tag labels resiliently. TWO hazards this absorbs:
//  1. Fresh-install provisioning window — for a few seconds after the Blog app installs,
//     per-item category/tag creates return 200 with an id but DON'T persist (the id is a lie).
//     So the create response is never trusted — re-query, treat the query as truth, re-create
//     what's still missing until it sticks.
//  2. Idempotency — an already-present label (a partial-failure re-run) is skipped.
// Category bodies are NESTED (`{ category: { label } }`); tag bodies are FLAT (`{ label }`) —
// a `{ tag: { label } }` body sends an empty top-level label and 400s. Returns [{ id, name }].
async function ensureLabels(ctx, kind, createPath, mkBody, names) {
  let map = await labelIdMap(ctx, kind);
  for (let attempt = 0; attempt < 8; attempt++) {
    const missing = names.filter((n) => !map.has(n));
    if (!missing.length) break;
    if (attempt) await sleep(1500); // backoff only between retries — happy path pays nothing
    for (const name of missing) {
      try { await req(ctx, createPath, { body: mkBody(name) }); }
      catch (e) { if (!String(e.message).includes("-> 409")) throw e; } // 409 = raced, already there
    }
    map = await labelIdMap(ctx, kind);
  }
  return names.map((name) => ({ id: map.get(name), name }));
}

/** Create categories idempotently by label (no bulk endpoint). Feed ids into post.categoryIds. */
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/create-category.md
export async function createCategories(ctx, names) {
  return ensureLabels(ctx, "categories", "/blog/v3/categories", (name) => ({ category: { label: name } }), names);
}

/** Create tags idempotently by label. Feed ids into post.tagIds. */
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/create-tag.md
export async function createTags(ctx, names) {
  return ensureLabels(ctx, "tags", "/blog/v3/tags", (name) => ({ label: name }), names);
}

// Blog binds a post cover by Wix Media file ID — an external url must be imported first; a
// plan `coverImagePrompt` is generated (Wix AI, 1 credit) then imported. Both live in the
// shared util (parallel, resilient, never blocks the seed).
export { importImage } from "../../shared/seed/images.mjs";

// covers: [{ postId, fileId }] where fileId is the Wix Media file.id from importImage. Per
// post: PATCH /blog/v3/draft-posts/{id} (NOT POST …/{id}/update — that 404s), setting
// media.displayed:true + media.custom:true + wixMedia.image.id (the id ALONE is a silent
// no-op), then RE-PUBLISH — the PATCH sets hasUnpublishedChanges, so the live post stays
// cover-less until republished. Image failures never block the run.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/update-draft-post.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/publish-draft-post.md
export async function attachPostCovers(ctx, covers) {
  let attached = 0;
  for (const { postId, fileId } of covers) {
    try {
      await req(ctx, `/blog/v3/draft-posts/${postId}`, {
        method: "PATCH",
        body: { draftPost: { media: { displayed: true, custom: true, wixMedia: { image: { id: fileId } } } } },
      });
      await req(ctx, `/blog/v3/draft-posts/${postId}/publish`, { method: "POST" });
      attached++;
    } catch (e) {
      console.error(`cover attach skipped for post ${postId}: ${e.message}`);
    }
  }
  return attached;
}

/**
 * ONE-CALL seed: install → author memberId → categories/tags (names resolved to ids) →
 * published posts → covers, ids threaded in memory. The default path.
 */
export async function setupBlog(ctx, { posts = [], categories = [], tags = [] } = {}) {
  await installBlogApp(ctx);
  await sleep(3000); // let a fresh Blog install settle so the first category/tag writes stick
                     // (correctness is still guaranteed by ensureLabels' verify-retry).
  const memberId = await getAuthorMemberId(ctx);

  const catNames = [...new Set([...categories, ...posts.flatMap((p) => [].concat(p.category ?? [], p.categories ?? []))])];
  const tagNames = [...new Set([...tags, ...posts.flatMap((p) => [].concat(p.tags ?? []))])];
  const cats = catNames.length ? await createCategories(ctx, catNames) : [];
  const tgs = tagNames.length ? await createTags(ctx, tagNames) : [];
  const catId = new Map(cats.map((c) => [c.name, c.id]));
  const tagId = new Map(tgs.map((t) => [t.name, t.id]));

  const created = await createPosts(ctx, posts.map((p) => {
    const cn = [].concat(p.category ?? [], p.categories ?? []);
    const tn = [].concat(p.tags ?? []);
    return {
      ...p,
      ...(cn.length ? { categoryIds: cn.map((n) => catId.get(n)).filter(Boolean) } : {}),
      ...(tn.length ? { tagIds: tn.map((n) => tagId.get(n)).filter(Boolean) } : {}),
    };
  }), { memberId });

  // Pass 2 — covers: resolve (import by url / generate by prompt) in one parallel wave, then
  // attach (PATCH + re-publish per post). Failures leave the post text-only; the seed's exit
  // never depends on images.
  const files = await resolveItemImages(ctx, created.map((c, i) => (
    c?.id && c?.success
      ? { path: posts[i]?.coverImagePath, url: posts[i]?.coverImageUrl, prompt: posts[i]?.coverImagePrompt, displayName: `post-${i}.png` }
      : null
  )));
  const covers = created
    .map((c, i) => (files[i] ? { postId: c.id, fileId: files[i].id } : null))
    .filter(Boolean);
  const coversAttached = covers.length ? await attachPostCovers(ctx, covers) : 0;

  return { posts: created, categories: cats, tags: tgs, coversAttached };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-blog.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupBlog(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
