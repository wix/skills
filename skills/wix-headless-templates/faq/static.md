# The FAQ on a static site

The pages are HTML files at the root of the site. They import the FAQ layer from `/js/wix/`: the
category and question reads, and one store that holds the state and the rules of the FAQ page.
Nothing on the screen ships; every element is yours, in the design of the site. This file shows
how to drive the layer. The skeletons show the calls and the fields and leave the markup to you.
The solution is read-only: visitors read, authoring stays in the dashboard.

## The layer

`/js/wix/faq.js`: `fetchFaq()` (every category with its question count and every question, in
the owner's order, in one call), `fetchQuestions({ categoryId, limit, cursor })`,
`fetchCategories()`, `fetchQuestionById(id)`. `/js/wix/faq-core.js`: `anchorId(q)` ("q-" and
the slug, the id of a question's wrapper), `faqDeepLink(q, base, categoryId)` (the link to one
question), `groupByCategory(categories, questions)` (the sections, in order), `MAX_QUESTIONS`
(500, the cap of one load).

A question carries `id`, `slug`, `question`, `answerHtml` (sanitized HTML, the one field that
goes in through `innerHTML`), `answerText` (plain text, for snippets), `categoryId`, `sortOrder`.
A category carries `id`, `title`, `sortOrder`, `questionCount`.

The store in `/js/wix/faq-store.js` is one for the page, exported as functions:
`seedFaq(options)` sets `expandOnlyOne`, `openFirst` and `syncUrl`, and takes `initialData` when
the page has it; `subscribeFaq(fn)`; `getFaqState()`; the actions `selectCategory(id)` (null for
all), `setQuery(text)`, `toggleQuestion(id)`, `expandQuestion(id)`, `collapseQuestion(id)`,
`collapseAll()`, `retry()`. The state: `data` (null while loading; then `categories`,
`questions`, `truncated`), `activeCategoryId`, `query`, `expandedIds`, `visible` (the questions
the filter and the search leave, in order), `resultsCount` (while a query is typed), `loading`,
`error`. The store owns the rules: which questions a category and a query leave, which are open,
what the address bar says. A page reads the state and calls the actions; it computes nothing of
its own.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations before writing the page.

## The pattern

The first `subscribeFaq` in a browser starts the store: it fetches when nothing was seeded,
mirrors the category and the open question into the URL, and opens the question a deep link
names. Seed the options first, subscribe a render function, render once. The store calls the
listener on every change and not on subscribe, so the first render is yours. Controls call the
store's actions; delegate from the page's root and read what to do from the element, so a
re-render of the markup keeps the listeners.

```js
import { seedFaq, subscribeFaq, getFaqState } from "/js/wix/faq-store.js";

seedFaq({ expandOnlyOne: true });
function render(s) {
  // read s, write your markup into the page
}
subscribeFaq(render);
render(getFaqState());
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The FAQ page

`faq.html` holds the heading, one line of intro, the category nav, the search, and the
accordion, all written on the store. From the state, and the action each control calls:

- `data` null with `loading` is the loading state; `error` with no questions is the error state
  with a control calling `retry()`.
- `data.categories` filtered to `questionCount` above zero is the nav, one control per category
  calling `selectCategory(id)` and one for all calling `selectCategory(null)`, `activeCategoryId`
  marking the current one; show the nav only when more than one category has questions.
- The search field calls `setQuery(text)` on input, debounced; `query` is the current text and
  `resultsCount` the number it leaves, worth a line beside the field. The search and the
  category filter run in the store over the loaded set, by design: the API has no full-text
  search, so the whole FAQ is loaded once, capped at `MAX_QUESTIONS`, and `data.truncated` says
  when more exist.
- `data.questions` empty is an honest empty state; `visible` empty with a `query` is a no-results
  state with a clear control calling `setQuery("")`.
- `groupByCategory(data.categories, visible)` gives the sections in order; a section heading
  only when more than one category has questions.
- A question is a control calling `toggleQuestion(id)`, open when `expandedIds` holds its id.
  The questions start collapsed, one open at a time with `expandOnlyOne`; a copied link reopens
  the same question.
- The accordion is accessible by construction: the question is a button with `aria-expanded`
  and `aria-controls` inside a heading, the answer a `role="region"` panel it labels, collapsed
  with `hidden` and still in the DOM. Every question's wrapper carries `id` from `anchorId(q)`;
  a copy-link control carries `faqDeepLink(q, "/faq.html")`.
- `answerHtml` goes in through `innerHTML`; the question, the titles and the labels are text.

A sketch of the binding, fields in, markup yours:

```js
import { seedFaq, subscribeFaq, getFaqState, selectCategory, setQuery, toggleQuestion, retry } from "/js/wix/faq-store.js";
import { anchorId, faqDeepLink, groupByCategory } from "/js/wix/faq-core.js";

seedFaq({ expandOnlyOne: true });
root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  var d = b.dataset;
  if (d.category !== undefined) selectCategory(d.category || null);
  else if (d.question) toggleQuestion(d.question);
  else if ("retry" in d) retry();
  else if ("clear" in d) { searchEl.value = ""; setQuery(""); }
  else if (d.copy) navigator.clipboard.writeText(location.origin + d.copy);
});
var timer = 0;
searchEl.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { setQuery(searchEl.value); }, 250); });
subscribeFaq(render);
render(getFaqState());
```

```js
function render(s) {
  if (!s.data) { listEl.textContent = s.error || "Loading…"; return; }
  var withQuestions = s.data.categories.filter(function (c) { return c.questionCount > 0; });
  navEl.hidden = withQuestions.length < 2;
  // the nav from withQuestions with data-category, aria-pressed from s.activeCategoryId
  countEl.textContent = s.query ? s.resultsCount + " results" : "";
  var html = "";
  groupByCategory(s.data.categories, s.visible).forEach(function (sec) {
    sec.questions.forEach(function (q) {
      var open = s.expandedIds.indexOf(q.id) >= 0, id = anchorId(q);
      html += '<article id="' + id + '"><h3><button type="button" data-question="' + q.id + '" aria-expanded="' + open
        + '" aria-controls="' + id + '-answer">' + esc(q.question) + "</button></h3>"
        + '<div id="' + id + '-answer" role="region" aria-labelledby="' + id + '"' + (open ? "" : " hidden") + ">" + q.answerHtml
        + '<button type="button" data-copy="' + faqDeepLink(q, "/faq.html") + '">Copy link</button></div></article>';
    });
  });
  listEl.innerHTML = html;
}
```

`esc` escapes `&`, `<`, `>` and `"` in anything that came from the site; `answerHtml` is the
core's sanitized HTML and is the one value set as HTML. The empty, no-results and truncated
states are lines of your own from `data.questions`, `visible`, `query` and `data.truncated`.

## The home strip

The business first, then real questions under a truthful heading, each a link to its place on the
FAQ page. `fetchFaq()` gives the questions in the owner's order; the strip takes the first few.

```js
import { fetchFaq } from "/js/wix/faq.js";
import { faqDeepLink } from "/js/wix/faq-core.js";

fetchFaq().then(function (data) {
  var html = "";
  data.questions.slice(0, 4).forEach(function (q) {
    html += '<li><a href="' + faqDeepLink(q, "/faq.html") + '">' + esc(q.question) + "</a></li>";
  });
  stripEl.innerHTML = html;
}).catch(function () { stripEl.closest("section").hidden = true; });
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/faq.html`, and a deep link is `/faq.html#q-<slug>` with `?category=` when a category is active,
as `faqDeepLink(q, "/faq.html")` builds it. A link to a folder gives the visitor a 404 page.
Write the pages' scripts as files of their own and keep each file small; a page's code travels
as text in the upload call. Structured data built in the browser is not read by search engines;
say so in the close when the brief asks for indexed FAQ markup.

## Rules

- Data comes through the layer's exports; extend by adding a function beside them.
- `answerHtml` is the one field rendered through `innerHTML`; everything else is text.
- Search and category filtering run in the store over the loaded set. Render `data.truncated`
  honestly and keep the cap.
- Question and category order is the owner's, already applied.
- Deep links come from `anchorId` and `faqDeepLink`; `shareLink` on a question is Wix's own widget
  URL and stays out of the page.
- The accordion keeps the answer in the DOM, collapsed with `hidden`.
- Live data or an honest empty state; the questions carry no view counts or votes, so the page
  shows none. No Wix ids or technical words in visible text.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

## The owner's links

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
