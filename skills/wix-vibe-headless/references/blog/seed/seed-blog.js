// Blog seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// The agent requires this and calls the functions with plain data; all Wix Blog V3
// request/response mechanics (the required author memberId, single-vs-bulk endpoint switch,
// the flat-per-item bulk shape, Ricos richContent nesting, sequential category/tag creates,
// the cover-image PATCH + re-publish) live here, once.
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // Base44
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/blog/seed/seed-blog.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//   const memberId = await seed.getAuthorMemberId(ctx);                    // STEP 1 — required for every post
//   const cats = await seed.createCategories(ctx, ["Recipes", "Brewing"]); // STEP 3 — only if the brief groups posts
//   const posts = await seed.createPosts(ctx, [
//     { title: "How We Roast Our Beans", categoryIds: [cats[0].id], content: [
//       { type: "heading", text: "From farm to cup", level: 2 },
//       { type: "paragraph", text: "Every batch starts with beans from a single estate." },
//       { type: "quote", text: "Great coffee is grown, not made." },
//     ] },
//   ], { memberId });
//   // optional — import each image url to Wix Media (blog binds by file id), then attach covers + re-publish
//   const files = await Promise.all(imageUrls.map((u) => seed.importImage(ctx, u)));   // → [{ id, url }]
//   await seed.attachPostCovers(ctx, posts.map((p, i) => ({ postId: p.id, fileId: files[i].id })));
//
// Live-verified end-to-end (members author, categories, posts single+bulk, tags, covers, idempotent
// re-runs). If any call ever fails with a shape the caller didn't expect, fall back to the wix-docs
// skill (search + read the live Wix Blog API reference) — never guess. Source recipe:
// wix-headless/references/inline-recipes/setup-blog.md.

const API = "https://www.wixapis.com";
const BLOG_APP_ID = "14bcded7-0066-7c35-14d7-466cb3f09103"; // installBlogApp installs this before seeding

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

// ---- Ricos richContent builder (per recipe § "CRITICAL RICOS NESTING") ----
// A post's `content` is a list of plain block descriptors; this builds the Ricos node tree.
// Rules baked in: TEXT is always a leaf inside a container; BLOCKQUOTE / LIST_ITEM wrap a
// PARAGRAPH; BULLETED_LIST / ORDERED_LIST wrap LIST_ITEM -> PARAGRAPH -> TEXT; every container
// node gets a unique id, TEXT leaves use id "". Supported block types: heading, paragraph,
// quote, bulleted, ordered. For node types the recipe doesn't spell out (CODE_BLOCK, IMAGE, …)
// pass a pre-built `richContent` on the post instead and it's used verbatim (see fall-back below).
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
        // BLOCKQUOTE wraps a PARAGRAPH, per recipe
        nodes.push({ type: "BLOCKQUOTE", id: id(), nodes: [mkParagraph(id(), b.text)], blockquoteData: { indentation: 1 } });
        break;
      case "bulleted":
      case "ordered": {
        // LIST -> LIST_ITEM -> PARAGRAPH -> TEXT, per recipe
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

// One post's plain data -> a flat Blog V3 draft-post object.
// `content` (block list) is turned into Ricos richContent unless a pre-built `richContent` is given.
// media is omitted here — covers are a separate pass (attachPostCovers), optional (a separate covers pass). Per recipe.
function buildPost(p, i, memberId) {
  return {
    title: p.title,
    memberId,
    richContent: p.richContent ?? mkRichContent(p.content, i),
    ...(p.categoryIds ? { categoryIds: p.categoryIds } : {}),
    ...(p.tagIds ? { tagIds: p.tagIds } : {}),
  };
}

// ---- exported operations ----

// STEP 1: fetch a real author memberId (required — every post create needs it; a fabricated id
// fails with "memberIds ... do not exist"). Returns members[0].id; throws loudly if none exist.
async function getAuthorMemberId(ctx) {
  const r = await req(ctx, "/members/v1/members?fieldsets=PUBLIC&paging.limit=1", { method: "GET" });
  const id = r.members?.[0]?.id;
  if (!id) throw new Error(`No site member found for author attribution: ${JSON.stringify(r).slice(0, 400)}`);
  return id;
}

/**
 * STEP 2: create posts, published (publish:true so they go live immediately).
 * Auto-selects the endpoint per recipe: single-post endpoint for exactly one post (nested
 * `{ draftPost }` envelope), the bulk endpoint for >= 2 (flat per-item objects, NOT wrapped).
 * @param posts [{ title, content: [blocks] | richContent?, categoryIds?, tagIds? }]
 *   content blocks: { type:"heading", text, level? } | { type:"paragraph", text }
 *     | { type:"quote", text } | { type:"bulleted"|"ordered", items:[text,...] }.
 *   Pass a pre-built Ricos `richContent` instead of `content` for node types not covered here.
 * @param opts { memberId }  memberId from getAuthorMemberId — required; publish defaults to true.
 * @returns [{ id, index, success }]  (id is the draftPostId; feeds attachPostCovers)
 */
async function createPosts(ctx, posts, { memberId, publish = true } = {}) {
  if (!memberId) throw new Error("createPosts requires opts.memberId (see getAuthorMemberId)");
  if (posts.length === 1) {
    // single-post endpoint uses the nested { draftPost } envelope
    const r = await req(ctx, "/blog/v3/draft-posts", { body: { draftPost: buildPost(posts[0], 0, memberId), publish } });
    return [{ id: r.draftPost?.id, index: 0, success: !!r.draftPost?.id }];
  }
  // bulk endpoint: `bulk` is a path segment BETWEEN v3 and draft-posts; each item is FLAT (no draftPost wrapper)
  const r = await req(ctx, "/blog/v3/bulk/draft-posts/create", {
    body: { draftPosts: posts.map((p, i) => buildPost(p, i, memberId)), publish },
  });
  // Bulk returns 200 even on partial failure — read per-item results[].itemMetadata.success.
  return (r.results ?? []).map((x) => ({
    id: x.itemMetadata?.id, index: x.itemMetadata?.originalIndex, success: !!x.itemMetadata?.success,
  }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Existing label -> id, straight from the query (the source of truth for what actually persisted).
async function labelIdMap(ctx, kind) {
  const path = kind === "categories" ? "/blog/v3/categories/query" : "/v3/tags/query";
  const r = await req(ctx, path, { body: { query: { paging: { limit: 100 } } } });
  return new Map((r[kind] ?? []).map((x) => [x.label, x.id]));
}

// Create category/tag labels resiliently. TWO hazards this absorbs:
//  1. Fresh-install provisioning window — for a few seconds after the Blog app is installed, per-item
//     category/tag creates return 200 with an id but DON'T persist (last-write-wins; the id is a lie).
//     Posts (bulk) are unaffected. So we never trust the create response — we re-query and treat what
//     the query returns as truth, re-creating anything still missing until it sticks (store warms in ~s).
//  2. Idempotency — an already-present label (e.g. a partial-failure re-run) is skipped, not re-created.
// Category bodies are NESTED (`{ category: { label } }`); tag bodies are FLAT (`{ label }`) — a
// `{ tag: { label } }` body sends an empty top-level label and 400s. Returns [{ id, name }].
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

// STEP 3 (optional — only if the request groups posts): create categories. No bulk endpoint.
async function createCategories(ctx, names) {
  return ensureLabels(ctx, "categories", "/blog/v3/categories", (name) => ({ category: { label: name } }), names);
}

// STEP 3 (optional): create tags. Feed the returned ids into post.tagIds.
async function createTags(ctx, names) {
  return ensureLabels(ctx, "tags", "/blog/v3/tags", (name) => ({ label: name }), names);
}

// Import an external image URL into Wix Media → { id, url }. Blog binds the cover by the Wix Media
// file **id**, NOT a url — an external url (e.g. a base44 generate_image result) MUST be imported
// first; the raw url renders nothing. id = wixstatic file id, url = the permanent wixstatic url.
async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { body: { url, mimeType: "image/png", displayName } });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

// Attach images step (optional). covers: [{ postId, fileId }] where fileId is the WixMedia
// file.id from importImage (Blog binds the cover by id, not url). Per post:
//   PATCH /blog/v3/draft-posts/{id}  (NOT POST …/{id}/update — that 404s for a single post),
// setting media.displayed:true + media.custom:true + wixMedia.image.id (id ALONE is a silent no-op),
// then re-publish (the PATCH sets hasUnpublishedChanges, so the live post stays cover-less until republish).
// Image failures never block the run — skip a failed cover, leave the post text-only.
async function attachPostCovers(ctx, covers) {
  for (const { postId, fileId } of covers) {
    try {
      await req(ctx, `/blog/v3/draft-posts/${postId}`, {
        method: "PATCH",
        body: { draftPost: { media: { displayed: true, custom: true, wixMedia: { image: { id: fileId } } } } },
      });
      await req(ctx, `/blog/v3/draft-posts/${postId}/publish`, { method: "POST" });
    } catch (e) {
      console.warn(`cover attach skipped for post ${postId}: ${e.message}`);
    }
  }
}

/**
 * DEFAULT one-call path — seed a whole blog in ONE exec call. Resolves the author memberId and
 * category/tag names → ids internally and keeps every id in memory, so nothing is hand-threaded
 * across exec calls. Order: memberId → categories/tags → posts (with resolved ids) → covers.
 * @param plan {
 *   posts: [{ title, content?|richContent?, category?|categories?(name|names), tags?(names), coverImageUrl? }],
 *   categories?: [name],  // pre-create categories even if no post references them
 *   tags?: [name],
 * }
 *   category/categories/tags are display NAMES (resolved to ids here); coverImageUrl is a plain image
 *   url — imported to Wix Media here — and a cover is attached only for posts that provide one.
 * @returns { posts:[{id,index,success}], categories:[{id,name}], tags:[{id,name}], coversAttached }
 */
// Install the Wix Blog app before seeding — base44 sites aren't guaranteed to have it (no separate
// Setup step here, unlike the wix-headless recipe). Idempotent: re-installing returns 200.
async function installBlogApp(ctx) {
  return req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
    tenant: { tenantType: "SITE", id: ctx.siteId },
    appInstance: { appDefId: BLOG_APP_ID, enabled: true },
  } });
}

async function setupBlog(ctx, { posts = [], categories = [], tags = [] } = {}) {
  await installBlogApp(ctx);
  await sleep(3000); // let a fresh Blog install settle so the first category/tag writes stick (see ensureLabels);
                     // correctness is still guaranteed by ensureLabels' verify-retry — this just cuts the retries.
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
  const covers = [];
  for (let i = 0; i < created.length; i++) {
    const url = posts[i]?.coverImageUrl;
    if (!created[i]?.id || !url) continue;
    try {
      const file = await importImage(ctx, url, `post-${i}.png`);   // → Wix Media file id
      covers.push({ postId: created[i].id, fileId: file.id });
    } catch { /* never block on image failure — leave the post cover-less */ }
  }
  if (covers.length) await attachPostCovers(ctx, covers);
  return { posts: created, categories: cats, tags: tgs, coversAttached: covers.length };
}

module.exports = {
  setupBlog, installBlogApp,
  getAuthorMemberId, createPosts, createCategories, createTags, importImage, attachPostCovers,
};
