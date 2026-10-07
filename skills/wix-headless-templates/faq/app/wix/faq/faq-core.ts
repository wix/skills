// FAQ rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./faq.ts (the SDK,
// managed Astro and React) and the REST twin in templates/faq/rest/faq.ts (fetch, a static site or a
// port to another language). Every rule about ordering, grouping, search, deep links, the answer's
// Ricos-to-HTML rendering, the FAQPage structured data, and the wire spelling of a query lives HERE,
// once. A raw entity may come from the SDK (`_id`) or from REST (`id`); the mappers accept both.
// Imports are type-only so a strip to JS emits no imports.
import type { FaqCategory, FaqData, FaqQuestion, FaqQuestionPage, FaqSection, FetchQuestionsOptions } from "./types";

/** A raw FAQ entity (Category, QuestionEntry) as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix FAQ app id — what the seed installs and read-site.mjs checks for. */
export const FAQ_APP_ID = "14c92d28-031e-7910-c9a8-a670011e062d";
/** The API's page cap: CursorPaging.limit is at most 100 on both services. */
export const PAGE_LIMIT = 100;
/** fetchFaq stops after this many questions and sets `truncated` — a guard, not a feature (an FAQ is small). */
export const MAX_QUESTIONS = 500;
/** Ask for the Ricos answer (the format the Wix dashboard writes) and the share links (only returned when asked). */
export const CONTENT_FORMAT = "RICH_CONTENT" as const;
export const FIELD_SET = ["SHARE_LINKS"] as const;
/** Owner order for categories AND questions: "lower sort order values appear first" (both entities). */
export const SORT = [{ fieldName: "sortOrder", order: "ASC" }] as const;
/** Size an answer's inline image is resolved at — one URL per image, wide enough for a prose column. */
export const ANSWER_IMAGE_WIDTH = 1200;
export const ANSWER_IMAGE_HEIGHT = 800;
/** The synthetic section for a question whose categoryId matches no loaded category. */
export const OTHER_CATEGORY_ID = "uncategorized";
export const OTHER_CATEGORY_TITLE = "Other";

export const rawId = (r: Raw | null | undefined): string => r?._id ?? r?.id ?? "";

const numberOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- DTO mapping --------------------------------------------------------------------------------

export function toCategory(raw: Raw): FaqCategory {
  return { id: rawId(raw), title: raw.title ?? "", sortOrder: numberOrNull(raw.sortOrder), questionCount: 0 };
}

/**
 * The answer is a oneof — richContent | plainText | draftjs — and the request's `contentFormat`
 * decides which one the response carries. Priority here: richContent (what we ask for), then
 * plainText, then a minimal Draft.js read (legacy content; the request never asks for DRAFTJS, but a
 * conversion the backend declines could still arrive that way), then an empty answer.
 */
export function toQuestion(raw: Raw, imgSrc: ImgSrc): FaqQuestion {
  let answerHtml = "";
  let answerText = "";
  if (raw.richContent?.nodes) {
    answerHtml = richContentToHtml(raw.richContent, imgSrc);
    answerText = richContentToText(raw.richContent);
  } else if (typeof raw.plainText === "string" && raw.plainText) {
    answerHtml = plainTextToHtml(raw.plainText);
    answerText = raw.plainText.trim();
  } else if (typeof raw.draftjs === "string" && raw.draftjs) {
    const blocks = draftjsBlocks(raw.draftjs);
    answerHtml = draftjsToHtml(blocks);
    answerText = blocks.map((b) => b.text).join("\n").trim();
  }
  return {
    id: rawId(raw),
    slug: raw.slug ?? "",
    question: raw.question ?? "",
    answerHtml,
    answerText,
    categoryId: raw.categoryId ?? "",
    sortOrder: numberOrNull(raw.sortOrder),
    shareLink: raw.shareLink ?? "",
    labels: Array.isArray(raw.labels) ? raw.labels.map((l: Raw) => l?.title ?? "").filter(Boolean) : [],
  };
}

// ---- ordering and grouping -------------------------------------------------------------------------

const bySortOrder = (a: number | null, b: number | null): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // unnumbered after the numbered ones
  if (b === null) return -1;
  return a - b;
};

/** sortOrder ascending, nulls last, then title — a stable order whatever the API returned. */
export function sortCategories(cs: FaqCategory[]): FaqCategory[] {
  return [...cs].sort((a, b) => bySortOrder(a.sortOrder, b.sortOrder) || a.title.localeCompare(b.title));
}

/** sortOrder ascending, nulls last, then question text. */
export function sortQuestions(qs: FaqQuestion[]): FaqQuestion[] {
  return [...qs].sort((a, b) => bySortOrder(a.sortOrder, b.sortOrder) || a.question.localeCompare(b.question));
}

/** Categories with `questionCount` filled from ALL loaded questions (not the filtered view). */
export function withCounts(cats: FaqCategory[], qs: FaqQuestion[]): FaqCategory[] {
  const counts = new Map<string, number>();
  for (const q of qs) counts.set(q.categoryId, (counts.get(q.categoryId) ?? 0) + 1);
  return cats.map((c) => ({ ...c, questionCount: counts.get(c.id) ?? 0 }));
}

/**
 * Sections in category order, each with its questions in owner order; categories with no question
 * in `qs` are omitted. A question whose categoryId matches no category lands in a synthetic "Other"
 * section at the end (every question must have a category, so this is a stale-reference guard).
 */
export function groupByCategory(cats: FaqCategory[], qs: FaqQuestion[]): FaqSection[] {
  const buckets = new Map<string, FaqQuestion[]>();
  for (const q of qs) {
    const list = buckets.get(q.categoryId) ?? [];
    list.push(q);
    buckets.set(q.categoryId, list);
  }
  const sections: FaqSection[] = [];
  for (const c of sortCategories(cats)) {
    const list = buckets.get(c.id);
    if (list?.length) sections.push({ category: { ...c, questionCount: list.length }, questions: sortQuestions(list) });
    buckets.delete(c.id);
  }
  const orphans = [...buckets.values()].flat();
  if (orphans.length) {
    sections.push({
      category: { id: OTHER_CATEGORY_ID, title: OTHER_CATEGORY_TITLE, sortOrder: null, questionCount: orphans.length },
      questions: sortQuestions(orphans),
    });
  }
  return sections;
}

/** Categories (sorted, counted) + questions (sorted) → the page's data unit. Both transports end here. */
export function assembleFaq(cats: FaqCategory[], qs: FaqQuestion[], truncated: boolean): FaqData {
  const questions = sortQuestions(qs);
  return { categories: sortCategories(withCounts(cats, questions)), questions, truncated };
}

/**
 * Every question, paged until the API says there is no next page or MAX_QUESTIONS is reached. Takes
 * the transport's fetchQuestions so the drain rule lives once; `truncated` says the cap was hit.
 */
export async function loadAllQuestions(
  fetchPage: (o: FetchQuestionsOptions) => Promise<FaqQuestionPage>,
): Promise<{ questions: FaqQuestion[]; truncated: boolean }> {
  const questions: FaqQuestion[] = [];
  let cursor: string | null = null;
  do {
    const page: FaqQuestionPage = await fetchPage({ limit: PAGE_LIMIT, cursor });
    questions.push(...page.questions);
    cursor = page.nextCursor;
    if (cursor && questions.length >= MAX_QUESTIONS) return { questions: questions.slice(0, MAX_QUESTIONS), truncated: true };
  } while (cursor);
  return { questions, truncated: false };
}

// ---- search (client-side by design) -----------------------------------------------------------------
// The API filters `question` with $startsWith only (the query spec: no $contains, no full-text), so
// visitor search is a substring match over the loaded set — question AND answer text, case-insensitive
// — the rule the Wix FAQ widget applies. Never re-implement it against the API.

/** Trim, lowercase, collapse whitespace. */
export const normalizeQuery = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, " ");

export function matches(q: FaqQuestion, needle: string): boolean {
  if (!needle) return true;
  return normalizeQuery(q.question).includes(needle) || normalizeQuery(q.answerText).includes(needle);
}

/** "" → qs unchanged. */
export function search(qs: FaqQuestion[], query: string): FaqQuestion[] {
  const needle = normalizeQuery(query);
  return needle ? qs.filter((q) => matches(q, needle)) : qs;
}

/** Category filter first, then search; sorted. What the accordion renders. */
export function visibleQuestions(data: FaqData | null, activeCategoryId: string | null, query: string): FaqQuestion[] {
  if (!data) return [];
  const inCategory = activeCategoryId ? data.questions.filter((q) => q.categoryId === activeCategoryId) : data.questions;
  return sortQuestions(search(inCategory, query));
}

// ---- deep links -----------------------------------------------------------------------------------------
// `/faq?category=<id>#q-<slug>`: the category pre-selects the nav, the fragment expands one question. The
// slug is the API's readonly slug; the id is the fallback so a question without one still has an anchor.

export const anchorId = (q: Pick<FaqQuestion, "slug" | "id">): string => `q-${q.slug || q.id}`;

export function faqDeepLink(q: Pick<FaqQuestion, "slug" | "id">, base = "/faq", categoryId?: string | null): string {
  return `${base}${categoryId ? `?category=${encodeURIComponent(categoryId)}` : ""}#${anchorId(q)}`;
}

/** location.search + location.hash → the deep link's parts (either null when absent). */
export function parseDeepLink(search: string, hash: string): { categoryId: string | null; anchor: string | null } {
  let categoryId: string | null = null;
  try {
    categoryId = new URLSearchParams(search).get("category") || null;
  } catch {
    /* malformed query string — no category */
  }
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  let anchor: string | null = null;
  if (h.startsWith("q-") && h.length > 2) {
    try {
      anchor = decodeURIComponent(h.slice(2));
    } catch {
      anchor = h.slice(2);
    }
  }
  return { categoryId, anchor };
}

/** The question an anchor names — by slug, then by id (a slug can change when the question is edited). */
export function findByAnchor(qs: FaqQuestion[], anchor: string): FaqQuestion | undefined {
  return qs.find((q) => q.slug && q.slug === anchor) ?? qs.find((q) => q.id === anchor);
}

// ---- structured data ----------------------------------------------------------------------------------

/** schema.org FAQPage over the questions. Answer.text carries the sanitized HTML (Google accepts limited HTML there). */
export function faqJsonLd(qs: FaqQuestion[], pageUrl?: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qs.map((q) => ({
      "@type": "Question",
      name: q.question,
      ...(pageUrl ? { url: `${pageUrl}#${anchorId(q)}` } : {}),
      acceptedAnswer: { "@type": "Answer", text: q.answerHtml },
    })),
  };
}

// ---- Ricos → HTML / text --------------------------------------------------------------------------------
// The subset FAQ answers use. Text is always escaped, attribute values are escaped, no inline styles, no
// event attributes; a node type outside the table degrades to its text; `htmlData` is never emitted.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/** Ricos Link → the anchor's attributes, or null when the URL is not http(s) (javascript:, data:, relative). */
function linkAttrs(link: Raw | undefined): string | null {
  if (!link) return null;
  if (isHttpUrl(link.url)) {
    const rel = ["noopener", "noreferrer"];
    if (link.rel?.nofollow) rel.push("nofollow");
    if (link.rel?.sponsored) rel.push("sponsored");
    if (link.rel?.ugc) rel.push("ugc");
    const target = link.target === "BLANK" ? ` target="_blank"` : "";
    return `href="${escapeHtml(link.url)}" rel="${rel.join(" ")}"${target}`;
  }
  if (typeof link.anchor === "string" && link.anchor) return `href="#${escapeHtml(link.anchor)}"`;
  return null;
}

/** One TEXT node → inline HTML: escaped text wrapped by its decorations (unknown decorations keep the text). */
function textNodeToHtml(node: Raw): string {
  let html = escapeHtml(String(node.textData?.text ?? ""));
  for (const d of (node.textData?.decorations ?? []) as Raw[]) {
    switch (d?.type) {
      case "BOLD":
        // The editor writes fontWeightValue 700 for bold and a lighter weight to un-bold inside a bold block.
        if (typeof d.fontWeightValue !== "number" || d.fontWeightValue >= 600) html = `<strong>${html}</strong>`;
        break;
      case "ITALIC":
        if (d.italicData !== false) html = `<em>${html}</em>`;
        break;
      case "UNDERLINE": html = `<u>${html}</u>`; break;
      case "STRIKETHROUGH": html = `<s>${html}</s>`; break;
      case "SUPERSCRIPT": html = `<sup>${html}</sup>`; break;
      case "SUBSCRIPT": html = `<sub>${html}</sub>`; break;
      case "LINK": {
        const attrs = linkAttrs(d.linkData?.link);
        if (attrs) html = `<a ${attrs}>${html}</a>`;
        break;
      }
      case "ANCHOR":
        if (typeof d.anchorData?.anchor === "string" && d.anchorData.anchor) html = `<a href="#${escapeHtml(d.anchorData.anchor)}">${html}</a>`;
        break;
      default:
        break; // COLOR, FONT_SIZE, FONT_FAMILY, MENTION, SPOILER, SKETCH, EXTERNAL — text kept, styling dropped
    }
  }
  return html;
}

/**
 * The media value in the form imgSrc scales: `wix:image://v1/<id>/<id>#originWidth=W&originHeight=H`
 * (the Ricos FileSource has no filename; the id stands in — the scaler reads only the id). An absolute
 * https URL passes through; anything else is no image.
 */
export function imageValue(image: Raw | undefined): string {
  const src = image?.src;
  if (!src) return "";
  if (typeof src.id === "string" && src.id) {
    const size = image?.width && image?.height ? `#originWidth=${image.width}&originHeight=${image.height}` : "";
    return `wix:image://v1/${src.id}/${src.id}${size}`;
  }
  return isHttpUrl(src.url) ? src.url : "";
}

function childrenToHtml(node: Raw, imgSrc: ImgSrc): string {
  return ((node.nodes ?? []) as Raw[]).map((n) => nodeToHtml(n, imgSrc)).join("");
}

function nodeToHtml(node: Raw, imgSrc: ImgSrc): string {
  switch (node?.type) {
    case "TEXT": return textNodeToHtml(node);
    case "PARAGRAPH": return `<p>${childrenToHtml(node, imgSrc)}</p>`;
    // Every answer heading renders as h4: the page's h1 is the FAQ title, h2 the category, h3 the question.
    case "HEADING": return `<h4>${childrenToHtml(node, imgSrc)}</h4>`;
    case "BULLETED_LIST": return `<ul>${childrenToHtml(node, imgSrc)}</ul>`;
    case "ORDERED_LIST": return `<ol>${childrenToHtml(node, imgSrc)}</ol>`;
    case "LIST_ITEM": return `<li>${childrenToHtml(node, imgSrc)}</li>`;
    case "BLOCKQUOTE": return `<blockquote>${childrenToHtml(node, imgSrc)}</blockquote>`;
    case "CODE_BLOCK": return `<pre><code>${childrenToHtml(node, imgSrc)}</code></pre>`;
    case "DIVIDER": return "<hr>";
    case "IMAGE": {
      const src = imgSrc(imageValue(node.imageData?.image), ANSWER_IMAGE_WIDTH, ANSWER_IMAGE_HEIGHT);
      if (!src) return "";
      const alt = escapeHtml(String(node.imageData?.altText ?? ""));
      const img = `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async">`;
      const attrs = linkAttrs(node.imageData?.link);
      return attrs ? `<a ${attrs}>${img}</a>` : img;
    }
    default: {
      // TABLE, COLLAPSIBLE_LIST, VIDEO, GIF, GALLERY, HTML, EMBED, APP_EMBED, BUTTON, … — text only.
      const text = nodeToText(node).trim();
      return text ? `<p>${escapeHtml(text)}</p>` : "";
    }
  }
}

/** Sanitized HTML for a Ricos document ("" for none). */
export function richContentToHtml(rc: Raw | null | undefined, imgSrc: ImgSrc): string {
  return ((rc?.nodes ?? []) as Raw[]).map((n) => nodeToHtml(n, imgSrc)).join("");
}

const INLINE_TYPES = new Set(["TEXT"]);

function nodeToText(node: Raw): string {
  if (node?.type === "TEXT") return String(node.textData?.text ?? "");
  if (node?.type === "BUTTON") return String(node.buttonData?.text ?? "");
  const children = (node?.nodes ?? []) as Raw[];
  const parts = children.map(nodeToText);
  // Blocks join with newlines; inline runs concatenate.
  return children.every((c) => INLINE_TYPES.has(c?.type)) ? parts.join("") : parts.filter(Boolean).join("\n");
}

/** Plain text of a Ricos document — one line per block ("" for none). */
export function richContentToText(rc: Raw | null | undefined): string {
  return ((rc?.nodes ?? []) as Raw[]).map(nodeToText).filter(Boolean).join("\n").trim();
}

/** A plainText answer → one <p> per blank-line paragraph, single newlines as <br>. */
export function plainTextToHtml(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ---- Draft.js (legacy answers) — a minimal read: block text and block type, no inline styles or entities.
interface DraftBlock { text: string; type: string }

/** The `blocks[]` of a Draft.js raw content string; [] when it is not one. */
export function draftjsBlocks(raw: string): DraftBlock[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.blocks)
      ? parsed.blocks.map((b: Raw) => ({ text: String(b?.text ?? ""), type: String(b?.type ?? "unstyled") }))
      : [];
  } catch {
    return [];
  }
}

export function draftjsToHtml(blocks: DraftBlock[]): string {
  let html = "";
  let openList: "ul" | "ol" | null = null;
  const closeList = () => { if (openList) { html += `</${openList}>`; openList = null; } };
  for (const b of blocks) {
    const text = escapeHtml(b.text);
    const list = b.type === "unordered-list-item" ? "ul" : b.type === "ordered-list-item" ? "ol" : null;
    if (list) {
      if (openList !== list) { closeList(); html += `<${list}>`; openList = list; }
      html += `<li>${text}</li>`;
      continue;
    }
    closeList();
    if (!b.text.trim()) continue;
    if (b.type.startsWith("header-")) html += `<h4>${text}</h4>`;
    else if (b.type === "blockquote") html += `<blockquote><p>${text}</p></blockquote>`;
    else if (b.type === "code-block") html += `<pre><code>${text}</code></pre>`;
    else html += `<p>${text}</p>`;
  }
  closeList();
  return html;
}

// ---- the REST spelling of a query -------------------------------------------------------------------
// The SDK's query builder serializes these itself; the REST twin sends them literally. A cursor encodes
// the original filter+sort, so a cursor request carries ONLY cursorPaging; the first page carries the
// sort and the filter. contentFormat and fieldSet sit beside `query`, not inside it.

/** POST /faq/v2/categories/query body: every category, owner order, one page (a site has few). */
export function categoriesQueryBody(): Raw {
  return { query: { sort: SORT, cursorPaging: { limit: PAGE_LIMIT } } };
}

/** POST /faq/v2/question-entries/query body for one page. */
export function questionsQueryBody({ categoryId = null, limit = PAGE_LIMIT, cursor = null }: FetchQuestionsOptions = {}): Raw {
  const size = Math.min(Math.max(1, limit), PAGE_LIMIT);
  const query: Raw = cursor
    ? { cursorPaging: { limit: size, cursor } }
    : { ...(categoryId ? { filter: { categoryId: { $eq: categoryId } } } : {}), sort: SORT, cursorPaging: { limit: size } };
  return { query, contentFormat: CONTENT_FORMAT, fieldSet: [...FIELD_SET] };
}

/** POST /faq/v2/question-entries/query body for one question by id — the same read (and permission) as the page. */
export function questionByIdBody(id: string): Raw {
  return { query: { filter: { _id: { $eq: id } }, cursorPaging: { limit: 1 } }, contentFormat: CONTENT_FORMAT, fieldSet: [...FIELD_SET] };
}

/** `pagingMetadata` → the next cursor, or null when the response says there is no next page. */
export const nextCursor = (pm: Raw | undefined | null): string | null => (pm?.hasNext ? pm.cursors?.next ?? null : null);
