// FAQ seed — a BUILD-TIME script, never shipped in the app. Run from the project root (where
// wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/templates/faq/seed/seed-faq.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix FAQ app if needed, reads what the
// site already holds, creates the missing categories (idempotent by title, with a fresh-install
// verify-retry), creates the missing questions one at a time (idempotent by category + question text;
// the API has no bulk create), and verifies by re-querying. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "categories": [{ "title", "questions": [{ "question", "answer", "labels"? }] }] }
//   answer: a string (plain text) | [blocks] (Ricos richContent) | { nodes: [...] } (a pre-built Ricos document, verbatim)
//   blocks: { type:"heading", text, level? } | { type:"paragraph", text }
//     | { type:"quote", text } | { type:"bulleted"|"ordered", items:[text,…] }
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. A fresh FAQ install may carry
// Wix's own sample categories/questions; removing them is the owner's call, not this script's.
// Unexpected shapes → read the live API reference; every call below carries a docs: line with its
// reference page.
import { seedSiteId } from "../../shared/seed/site-context.mjs";
import { wixToken } from "../../shared/seed/wix-cli.mjs";
import { readFileSync } from "node:fs";

const API = "https://www.wixapis.com";
const FAQ_APP_ID = "14c92d28-031e-7910-c9a8-a670011e062d";
const D = "https://dev.wix.com/docs/rest/business-management/faq-app/faq";
/** The API's page cap (CursorPaging.limit max 100). */
const PAGE_LIMIT = 100;
/** sortOrder step — increments of 10 leave room to insert between items later (the reference's own tip). */
const SORT_STEP = 10;

export function makeCtx({ cwd = process.cwd() } = {}) {
  // The content site: the config's site, or the parent on a migration preview (site-context.mjs stops
  // a seed there unless --allow-parent is passed after the user confirmed).
  const siteId = seedSiteId({ cwd, argv: process.argv });
  const token = wixToken(siteId, cwd);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fresh site's FAQ backend can transiently fail its FIRST calls while provisioning (403, 404 before
// the app instance exists, 5xx). Retry the same body ONCE after ~3s, then fail loud (never loop).
async function reqRetryOnce(ctx, path, opts) {
  try {
    return await req(ctx, path, opts);
  } catch (e) {
    if (/-> (403|404|5\d\d):/.test(String(e.message))) {
      await sleep(3000);
      return req(ctx, path, opts);
    }
    throw e;
  }
}

// ---- Ricos richContent builder (the blog seed's, copied) ------------------------------------------
// Rules baked in: TEXT is always a leaf inside a container; BLOCKQUOTE / LIST_ITEM wrap a PARAGRAPH;
// BULLETED_LIST / ORDERED_LIST wrap LIST_ITEM -> PARAGRAPH -> TEXT; every container node gets a unique
// id, TEXT leaves use id "". For node types not covered here pass a pre-built `answer: { nodes }`.
const mkText = (text) => ({ type: "TEXT", id: "", nodes: [], textData: { text: text || "", decorations: [] } });
const mkParagraph = (id, text) => ({ type: "PARAGRAPH", id, nodes: [mkText(text)], paragraphData: {} });

export function mkRichContent(blocks = [], idx = 0) {
  let n = 0;
  const id = () => `q${idx}-n${n++}`;
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

// A plan answer → the entity's answer field. The answer is a oneof: exactly one of plainText |
// richContent | draftjs is sent.
function answerField(answer, idx) {
  if (typeof answer === "string") return { plainText: answer };
  if (Array.isArray(answer)) return { richContent: mkRichContent(answer, idx) };
  if (answer && typeof answer === "object" && Array.isArray(answer.nodes)) return { richContent: answer };
  throw new Error(`question ${idx}: "answer" must be a string, an array of blocks, or a Ricos { nodes } object`);
}

const rawId = (x) => x?.id ?? x?._id ?? null;
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// ---- operations ----------------------------------------------------------------------------------

// Idempotent — re-installing an installed app is fine.
// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export async function installFaqApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: FAQ_APP_ID, enabled: true },
    } });
  } catch {
    /* already installed is fine */
  }
}

// Existing categories, straight from the query (the source of truth for what persisted).
// docs: https://dev.wix.com/docs/rest/business-management/faq-app/faq/category-v2/query-categories.md
export async function readCategories(ctx) {
  const r = await reqRetryOnce(ctx, "/faq/v2/categories/query", { body: { query: { cursorPaging: { limit: PAGE_LIMIT } } } });
  return (r.categories ?? []).map((c) => ({ id: rawId(c), title: c.title ?? "", sortOrder: typeof c.sortOrder === "number" ? c.sortOrder : null }));
}

// Every existing question (paged by cursor; PLAIN_TEXT keeps the read light — only the text is compared).
// docs: https://dev.wix.com/docs/rest/business-management/faq-app/faq/question-entry-v2/query-question-entries.md
export async function readQuestions(ctx) {
  const out = [];
  let cursor = null;
  do {
    const query = cursor ? { cursorPaging: { limit: PAGE_LIMIT, cursor } } : { cursorPaging: { limit: PAGE_LIMIT } };
    // No contentFormat: the default read. Asking for PLAIN_TEXT made entries stored as rich content
    // drop out of the page while the platform converted them, so a re-run did not see them and created
    // them again (run 153). Only `question`, `categoryId` and `sortOrder` are read here.
    const r = await reqRetryOnce(ctx, "/faq/v2/question-entries/query", { body: { query } });
    for (const q of r.questionEntries ?? []) out.push({ id: rawId(q), question: q.question ?? "", categoryId: q.categoryId ?? "", sortOrder: q.sortOrder ?? null });
    cursor = r.pagingMetadata?.hasNext ? (r.pagingMetadata?.cursors?.next ?? null) : null;
  } while (cursor);
  return out;
}

// Create the missing categories resiliently. TWO hazards this absorbs:
//  1. Fresh-install provisioning window — a create can answer 200 with an id that does not persist.
//     So the create response is never trusted — re-query, treat the query as truth, re-create what's
//     still missing until it sticks (8 attempts, 1.5 s apart).
//  2. Idempotency — an already-present title (a partial-failure re-run, Wix's sample content) is kept.
// New categories append after the existing ones: sortOrder = max(existing) + 10, +20, …
// Body is NESTED: { category: { title, sortOrder } } → { category: { id, … } }.
// docs: https://dev.wix.com/docs/rest/business-management/faq-app/faq/category-v2/create-category.md
export async function ensureCategories(ctx, titles) {
  let existing = await readCategories(ctx);
  const byTitle = () => new Map(existing.map((c) => [norm(c.title), c]));
  const created = new Set();
  for (let attempt = 0; attempt < 8; attempt++) {
    const map = byTitle();
    const missing = titles.filter((t) => !map.has(norm(t)));
    if (!missing.length) break;
    if (attempt) await sleep(1500); // backoff only between retries — the happy path pays nothing
    // Never 0: a zero sortOrder is dropped on the wire (the proto default) and the category then sorts as unnumbered.
    const base = Math.max(0, ...existing.map((c) => c.sortOrder ?? 0));
    for (const [i, title] of missing.entries()) {
      try {
        await req(ctx, "/faq/v2/categories", { body: { category: { title, sortOrder: base + SORT_STEP * (i + 1) } } });
        created.add(norm(title));
      } catch (e) {
        if (!String(e.message).includes("-> 409")) throw e; // 409 = raced, already there
      }
    }
    existing = await readCategories(ctx);
  }
  const map = byTitle();
  return titles.map((title) => {
    const c = map.get(norm(title));
    if (!c?.id) throw new Error(`category "${title}" did not persist after 8 attempts — retry the seed`);
    return { id: c.id, title, created: created.has(norm(title)) };
  });
}

// One question, one call (the SDK exports no bulk create). Body is NESTED: { questionEntry: { … } } →
// { questionEntry: { id, slug, … } }. `question` and `categoryId` are required; the answer is a oneof.
// docs: https://dev.wix.com/docs/rest/business-management/faq-app/faq/question-entry-v2/create-question-entry.md
export async function createQuestion(ctx, { question, categoryId, sortOrder, labels, answer }, idx) {
  const body = {
    questionEntry: {
      question,
      categoryId,
      sortOrder,
      ...(labels?.length ? { labels: labels.map((title, i) => ({ title, sortOrder: i })) } : {}),
      ...answerField(answer, idx),
    },
  };
  const r = await req(ctx, "/faq/v2/question-entries", { body });
  return { id: rawId(r.questionEntry), slug: r.questionEntry?.slug ?? null };
}

/**
 * ONE-CALL seed: install → read existing → categories (idempotent by title) → questions (idempotent
 * by category + question text, one at a time, in plan order) → verify by re-query. The default path.
 */
export async function setupFaq(ctx, { categories = [] } = {}) {
  if (!categories.length) throw new Error("plan.categories is empty — nothing to seed");
  await installFaqApp(ctx);
  await sleep(3000); // let a fresh FAQ install settle so the first writes stick (ensureCategories verifies anyway)

  // What the site held BEFORE this seed and the plan does not name: on a fresh install that is Wix's
  // sample content ("General", "Setting up FAQs", …), which the live page shows above the owner's
  // questions. Reported, never touched: this seed deletes nothing on a site, ever. The owner removes
  // what they do not want in the dashboard; the closing message tells them it is there and where.
  const planTitles = new Set(categories.map((c) => norm(c.title)));
  const preexisting = (await readCategories(ctx)).filter((c) => !planTitles.has(norm(c.title)));
  const preexistingQuestions = preexisting.length ? (await readQuestions(ctx)).filter((q) => preexisting.some((c) => c.id === q.categoryId)) : [];

  const cats = await ensureCategories(ctx, categories.map((c) => c.title));
  const catId = new Map(cats.map((c) => [norm(c.title), c.id]));

  const existing = await readQuestions(ctx);
  const seen = new Set(existing.map((q) => `${q.categoryId}\n${norm(q.question)}`));
  const maxSort = new Map();
  for (const q of existing) if (typeof q.sortOrder === "number") maxSort.set(q.categoryId, Math.max(maxSort.get(q.categoryId) ?? 0, q.sortOrder));

  const created = [];
  const skipped = [];
  const failed = [];
  let idx = 0;
  for (const c of categories) {
    const categoryId = catId.get(norm(c.title));
    let next = Math.max(0, maxSort.get(categoryId) ?? 0) + SORT_STEP; // never 0 (dropped on the wire)
    for (const q of c.questions ?? []) {
      idx++;
      const key = `${categoryId}\n${norm(q.question)}`;
      if (seen.has(key)) { skipped.push({ category: c.title, question: q.question }); continue; }
      try {
        const r = await createQuestion(ctx, { question: q.question, categoryId, sortOrder: next, labels: q.labels, answer: q.answer }, idx);
        created.push({ category: c.title, question: q.question, id: r.id, slug: r.slug });
        seen.add(key);
        next += SORT_STEP;
      } catch (e) {
        if (String(e.message).includes("-> 409")) { skipped.push({ category: c.title, question: q.question }); continue; }
        failed.push({ category: c.title, question: q.question, error: String(e.message).slice(0, 300) });
      }
    }
  }

  // A 200 on create does NOT prove persistence — re-query and count per category.
  const after = await readQuestions(ctx);
  const counts = new Map();
  for (const q of after) counts.set(q.categoryId, (counts.get(q.categoryId) ?? 0) + 1);
  return {
    categories: cats.map((c) => ({ id: c.id, title: c.title, created: c.created, questions: counts.get(c.id) ?? 0 })),
    questionsCreated: created.length,
    questionsSkipped: skipped.length,
    questionsFailed: failed.length,
    created,
    skipped,
    failed,
    questionsOnSite: after.length,
    // Content the plan did not name (Wix's install samples on a fresh site, or the owner's own on an
    // existing one): the closing message names what is on the page and where the owner removes it.
    preexisting: preexisting.map((c) => ({ id: c.id, title: c.title, questions: preexistingQuestions.filter((q) => q.categoryId === c.id).length })),
    dashboardUrl: `https://manage.wix.com/dashboard/${ctx.siteId}/app/${FAQ_APP_ID}`,
    docs: [`${D}/category-v2/create-category`, `${D}/question-entry-v2/create-question-entry`, `${D}/question-entry-v2/query-question-entries`],
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-faq.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupFaq(ctx, plan)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.questionsFailed) process.exit(1);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
