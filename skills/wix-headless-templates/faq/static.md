# The FAQ on a static site

The pages are HTML files at the root of the site. They import the FAQ modules from `/js/wix/` and
render what the modules return. This file is the whole playbook for that path: the modules, the
accordion the page writes on the store, the home strip, the rules and the seed. The solution is
read-only: visitors read, authoring stays in the dashboard.

## The modules

`/js/wix/faq.js`: `fetchFaq()` (every category with its question count and every question, in
the owner's order, in one call), `fetchQuestions({ categoryId, limit, cursor })`,
`fetchCategories()`, `fetchQuestionById(id)`. `/js/wix/faq-core.js`: `anchorId(q)` ("q-<slug>",
the id of a question's wrapper), `faqDeepLink(q, base, categoryId)` (the link to one question),
`groupByCategory(categories, questions)` (the sections, in order), `MAX_QUESTIONS` (500, the cap
of one load). The store in `/js/wix/faq-store.js` is one for the page: `seedFaq(options)` sets
`expandOnlyOne`, `openFirst` and `syncUrl` (and takes `initialData` when the page has it),
`subscribeFaq(fn)`, `getFaqState()`, and the actions `selectCategory(id)` (null for all),
`setQuery(text)`, `toggleQuestion(id)`, `expandQuestion(id)`, `collapseQuestion(id)`,
`collapseAll()`, `retry()`. The state: `data` (null while loading; `categories`, `questions`,
`truncated`), `activeCategoryId`, `query`, `expandedIds`, `visible` (the questions the filter and
the search leave, in order), `resultsCount` (while a query is typed), `loading`, `error`. The
first `subscribeFaq` in a browser starts the store: it fetches when nothing was seeded, mirrors
the category and the open question into the URL, and opens the question a deep link names. Each
`.js` opens with its declarations. A store calls a listener on every change and not when it
subscribes: render once after subscribing. The visitor token persists in `localStorage` on its
own; never mint one in a page.

A question carries `id`, `slug`, `question`, `answerHtml` (sanitized HTML, the one field that
goes in through `innerHTML`), `answerText` (plain text, for snippets), `categoryId`, `sortOrder`.
A category carries `id`, `title`, `sortOrder`, `questionCount`.

## The FAQ page

`faq.html` holds the heading, one line of intro, the category nav (only when more than one
category has questions), the search, and the accordion. All of it is the page's own markup on the
store: one render function that reads `getFaqState()`, called from `subscribeFaq`, with the
controls calling the store's actions. The states, in order: loading, error with a retry, empty, no
results with a clear control, then the sections. The questions start collapsed, one open at a
time; a copied link reopens the same question.

The accordion is accessible by construction: the question is a `<button aria-expanded
aria-controls>` inside a heading, the answer a `role="region"` panel it labels, collapsed with
`hidden` and still in the DOM. Every question's wrapper carries `id` from `anchorId(q)`, and the
copy-link control uses `faqDeepLink(q, "/faq.html")`.

```html
<section class="faq">
  <h1>Questions and answers</h1>
  <p class="faq-intro">Everything about ordering, shipping and returns.</p>
  <nav class="faq-nav" aria-label="Categories"></nav>
  <form class="faq-search" role="search"><label>Search <input type="search" name="q" autocomplete="off"></label>
    <span class="faq-count" aria-live="polite"></span></form>
  <div class="faq-list"></div>
</section>
```

```js
import { seedFaq, subscribeFaq, getFaqState, selectCategory, setQuery, toggleQuestion, retry } from "/js/wix/faq-store.js";
import { anchorId, faqDeepLink, groupByCategory } from "/js/wix/faq-core.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const page = document.querySelector(".faq");
const nav = page.querySelector(".faq-nav"), list = page.querySelector(".faq-list");
const search = page.querySelector(".faq-search"), count = page.querySelector(".faq-count");
let debounce = 0;

seedFaq({ expandOnlyOne: true });
nav.addEventListener("click", (e) => { const b = e.target.closest("button[data-category]"); if (b) selectCategory(b.dataset.category || null); });
list.addEventListener("click", (e) => {
  const q = e.target.closest("button[data-question]"); if (q) toggleQuestion(q.dataset.question);
  if (e.target.closest("button[data-retry]")) retry();
  if (e.target.closest("button[data-clear]")) { search.elements.q.value = ""; setQuery(""); }
  const copy = e.target.closest("button[data-copy]");
  if (copy) navigator.clipboard?.writeText(location.origin + copy.dataset.copy);
});
search.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => setQuery(search.elements.q.value), 250); });
search.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(debounce); setQuery(search.elements.q.value); });

function renderFaq(s) {
  if (!s.data && s.loading) { list.innerHTML = `<p class="faq-loading">Loading…</p>`; return; }
  if (s.error && !s.data?.questions.length) { list.innerHTML = `<p class="faq-error" role="alert">${esc(s.error)} <button type="button" data-retry>Try again</button></p>`; return; }
  const withQuestions = s.data.categories.filter((c) => c.questionCount > 0);
  nav.hidden = withQuestions.length < 2;
  nav.innerHTML = [{ id: "", title: "All" }, ...withQuestions].map((c) =>
    `<button type="button" class="faq-pill" data-category="${c.id}" aria-pressed="${(s.activeCategoryId ?? "") === c.id}">${esc(c.title)}</button>`).join("");
  count.textContent = s.query ? `${s.resultsCount} result${s.resultsCount === 1 ? "" : "s"}` : "";
  if (s.data.questions.length === 0) { list.innerHTML = `<p class="faq-empty">No questions yet.</p>`; return; }
  if (s.visible.length === 0) { list.innerHTML = `<p class="faq-none">No results for "${esc(s.query)}". <button type="button" data-clear>Clear</button></p>`; return; }
  const sections = groupByCategory(s.data.categories, s.visible);
  list.innerHTML = sections.map((sec) => `
    <section class="faq-section">
      ${withQuestions.length > 1 ? `<h2 class="faq-category">${esc(sec.category.title)}</h2>` : ""}
      ${sec.questions.map((q) => {
        const open = s.expandedIds.includes(q.id), id = anchorId(q);
        return `
        <article class="faq-item" id="${id}" data-state="${open ? "open" : "closed"}">
          <h3 class="faq-question"><button type="button" data-question="${q.id}" aria-expanded="${open}" aria-controls="${id}-answer">${esc(q.question)}</button></h3>
          <div class="faq-answer" id="${id}-answer" role="region" aria-labelledby="${id}" ${open ? "" : "hidden"}>
            ${q.answerHtml}
            <button type="button" class="faq-copy" data-copy="${faqDeepLink(q, "/faq.html")}">Copy link</button>
          </div>
        </article>`; }).join("")}
    </section>`).join("")
    + (s.data.truncated ? `<p class="faq-more">Showing the first ${s.data.questions.length} questions.</p>` : "");
}
subscribeFaq(renderFaq);
renderFaq(getFaqState());
document.title = "Questions and answers";
```

The answer goes in through `innerHTML` because `answerHtml` is the core's sanitized HTML; the
question, the titles and the labels are text. The search and the category filter run in the store
over the loaded set, by design: the API has no full-text search, so the whole FAQ is loaded once,
capped at `MAX_QUESTIONS`, and `data.truncated` says when more exist.

## The home strip

The business first, then real questions under a truthful heading, each a link to its place on the
FAQ page. `fetchFaq()` gives the questions in the owner's order; the strip takes the first few.

```js
import { fetchFaq } from "/js/wix/faq.js";
import { faqDeepLink } from "/js/wix/faq-core.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const strip = document.querySelector("#top-questions");
fetchFaq().then(({ questions }) => {
  strip.innerHTML = questions.slice(0, 4).map((q) => `<li><a href="${faqDeepLink(q, "/faq.html")}">${esc(q.question)}</a></li>`).join("");
}).catch(() => { strip.closest("section").hidden = true; });
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/faq.html`, and a deep link is `/faq.html#q-<slug>` with `?category=` when a category is active,
as `faqDeepLink(q, "/faq.html")` builds it. A link to a folder gives the visitor a 404 page.
Structured data built in the browser is not read by search engines; say so in the close when the
brief asks for indexed FAQ markup.

## Rules

- Data comes through the module exports; extend by adding a function beside them.
- `answerHtml` is the one field rendered through `innerHTML`; everything else is text.
- Search and category filtering run in the store over the loaded set. Render `data.truncated`
  honestly and keep the cap.
- Question and category order is the owner's, already applied.
- Deep links come from `anchorId` and `faqDeepLink`; `shareLink` on a question is Wix's own widget
  URL and stays out of the page.
- The accordion keeps the answer in the DOM, collapsed with `hidden`.
- Live data or an honest empty state; the DTOs carry no view counts or votes, so the page shows
  none. No Wix ids or technical words in visible text.

## The owner's link

`https://manage.wix.com/dashboard/{siteId}/app/14c92d28-031e-7910-c9a8-a670011e062d`, the FAQ
app's dashboard page for categories and questions. Every category and question there appears on
the site; the API exposes no draft state.

## Seeding

Per `seed/SEED.md` and `seed/seed-faq.mjs`: a plain-data plan, run in the script's order with its
waits; categories first, then questions, one call each. Seed two to four categories with two to
four questions each, at least one answer with a list or several paragraphs. A fresh FAQ install
carries Wix's sample categories and questions ("General", "Setting up FAQs") and the page shows
them. Never delete them, or anything else on the site: the seed result's `preexisting[]` names
what is on the page, and the close says so with the dashboard link so the owner removes them
there.
