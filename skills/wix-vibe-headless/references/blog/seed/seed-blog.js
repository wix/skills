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
//   // imagery ON only: import images per IMAGE_GENERATION.md, then attach covers + re-publish
//   await seed.attachPostCovers(ctx, posts.map((p, i) => ({ postId: p.id, fileId: fileIds[i] })));
//
// **NOT yet live-verified — transcribed from setup-blog.md.** If any call fails with a shape the
// caller didn't expect, fall back to the wix-docs skill (search + read the live Wix Blog API
// reference) — never guess. Source recipe (authoritative):
// wix-headless/references/inline-recipes/setup-blog.md.

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
// media is omitted here — covers are a separate pass (attachPostCovers), imagery-gated. Per recipe.
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

// STEP 3 (optional — only if the request groups posts): create categories, one POST each.
// No bulk endpoint. `label` is the Category display-name field (Category object model; the recipe
// gives the endpoint but not the body). Returns [{ id, name }] — feed ids into post.categoryIds.
async function createCategories(ctx, names) {
  const out = [];
  for (const name of names) {
    const r = await req(ctx, "/blog/v3/categories", { body: { category: { label: name } } });
    out.push({ id: r.category?.id, name });
  }
  return out;
}

// STEP 3 (optional): create tags, one POST each. `label` is the Tag display-name field.
// Returns [{ id, name }] — feed ids into post.tagIds.
async function createTags(ctx, names) {
  const out = [];
  for (const name of names) {
    const r = await req(ctx, "/blog/v3/tags", { body: { tag: { label: name } } });
    out.push({ id: r.tag?.id, name });
  }
  return out;
}

// Attach images step (imagery ON only). covers: [{ postId, fileId }] where fileId is the WixMedia
// file.id from IMAGE_GENERATION.md import (Blog binds the cover by id, not url). Per post:
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

module.exports = {
  getAuthorMemberId, createPosts, createCategories, createTags, attachPostCovers,
};
