# FAQ — seeding

Seed by **running `seed-faq.mjs` with a plan file** — don't hand-write the REST calls. The script
mints its own site token via the Wix CLI (logged-in session + `wix.config.json` required), installs
the Wix FAQ app if needed, reads what the site already holds, and creates everything in order:
categories first (idempotent by title, with a fresh-install verify-retry), then questions (idempotent
by category + question text, one call each — the API has no bulk create), then a re-query that counts
what persisted.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/templates/faq/seed/seed-faq.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 2–4 categories with 2–4 questions
each** (the seed shows the shape; the owner writes the rest in the dashboard). Group by how a visitor
thinks ("Orders & Shipping", "Returns", "Sizing"), write answers as `blocks` where the brief has
structure (steps, options), as a plain string otherwise. No images: an FAQ without pictures does not
look broken.

```json
{
  "categories": [
    {
      "title": "Orders & Shipping",
      "questions": [
        { "question": "How long does delivery take?",
          "answer": "Orders ship within 2 business days. Delivery takes 3-5 days in the EU and 7-10 days elsewhere." },
        { "question": "Can I change my order after placing it?",
          "answer": [
            { "type": "paragraph", "text": "Yes, within 12 hours of ordering." },
            { "type": "bulleted", "items": ["Reply to your confirmation email", "Or call the studio during opening hours"] }
          ],
          "labels": ["support"] }
      ]
    },
    {
      "title": "Returns",
      "questions": [
        { "question": "What is your return policy?", "answer": "14 days, unused, in the original packaging." }
      ]
    }
  ]
}
```

- `categories[].title` — the category as visitors see it (1–500 chars). Plan order is display order:
  new categories get `sortOrder` after the site's existing ones, in steps of 10.
- `questions[].question` — the question text (≤1000 chars). Plan order within a category is display
  order (`sortOrder` in steps of 10, after that category's existing questions).
- `answer` — a **string** (stored as `plainText`), an **array of blocks** (stored as Ricos
  `richContent`: `{type:"heading",text,level?}` · `{type:"paragraph",text}` · `{type:"quote",text}` ·
  `{type:"bulleted"|"ordered",items:[…]}`), or a pre-built Ricos `{ "nodes": [...] }` document used
  verbatim for node types the blocks don't cover. Exactly one format is sent per question.
- `labels` — optional strings; not visible to visitors (grouping for chatbots and integrations).
- Idempotent by text: a category whose title already exists is reused; a question whose text already
  exists in that category is skipped (`skipped` in the result). Nothing is updated or deleted.

**Seeding is additive — the seed never deletes or overwrites anything on the site, and neither do
you.** There is no cleanup flag and no cleanup step. A fresh FAQ install comes with Wix's own sample
categories and questions ("General", "Setting up FAQs", …); the live page shows them above the
owner's, so they are never silent: the result's `preexisting[]` lists every category the plan did not
name with its question count, and the closing message names them with the dashboard link so the owner
removes them there if they want to.

The result lists every category with its id, whether this run created it, and how many questions it
holds after the run; `created[]` carries each new question's `id` and `slug` (the anchor the page
uses is `#q-<slug>`); `failed[]` (exit code 1 when non-empty) carries the API message per question.

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For an FAQ, each question/answer
pair the user hands over is one `questions[]` entry: the question verbatim as `question`, the answer
as a string, or as `blocks` (one block per paragraph or list) when the source has structure. A heading
above a group of questions becomes that group's category `title`; a source with no headings is one
category named after the business's subject. A question with no answer is a question for the user.

## Escape hatch — individual functions
`setupFaq` composes exported steps — `installFaqApp`, `readCategories`, `readQuestions`,
`ensureCategories`, `createQuestion`, `mkRichContent`, plus `makeCtx()` — import them only for a
partial re-seed.

## Verification caveats

The FAQ API's reference pages exist (`dev.wix.com/docs/rest/business-management/faq-app/…`) and
every path, verb, and body here follows them; the following were not checked on a live site:

- Whether the create endpoints answer 409 on a duplicate title/question or create a second copy. The
  seed compares text before creating, so a duplicate only arises from a race.
- Whether the fresh-install provisioning window (a create that answers 200 but does not persist) exists
  for FAQ as it does for Blog; the verify-retry covers it either way.
- Whether install creates Wix's sample content (the SDK carries a "default content" job type). The seed
  reads before writing and reports what it found.
- The reference's sample flow mentions a question `status` of `PUBLISHED`; the entity has no `status`
  field in the SDK or the reference schema, so the seed sends none. If a question is created but does
  not show on the page, look for a visibility control in the FAQ dashboard.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; every call the script
makes carries a `docs:` line with its reference page.
Endpoints used: `POST /faq/v2/categories` (Create Category), `POST /faq/v2/categories/query`
(Query Categories), `POST /faq/v2/question-entries` (Create Question Entry),
`POST /faq/v2/question-entries/query` (Query Question Entries — the read-before and verify steps),
`POST /apps-installer-service/v1/app-instance/install` (Install App).
