// What the FAQ holds: categories and questions.
//   node <SKILL_ROOT>/templates/faq/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const FAQ_APP_ID = "14c92d28-031e-7910-c9a8-a670011e062d";
const D = "https://dev.wix.com/docs/rest/business-management/faq-app/faq";

await runReader({
  vertical: "faq",
  appId: FAQ_APP_ID,
  async read(api, { limit }) {
    const cats = await api.call({ path: "/faq/v2/categories/query", body: { query: { sort: [{ fieldName: "sortOrder", order: "ASC" }], cursorPaging: { limit: 100 } } }, docs: `${D}/category-v2/query-categories` });
    const qs = await api.call({ path: "/faq/v2/question-entries/query", body: { query: { sort: [{ fieldName: "sortOrder", order: "ASC" }], cursorPaging: { limit } }, contentFormat: "PLAIN_TEXT" }, docs: `${D}/question-entry-v2/query-question-entries` });
    const questions = qs.questionEntries ?? [];
    return {
      categoryCount: (cats.categories ?? []).length,
      categories: (cats.categories ?? []).map((c) => ({ id: c.id, title: c.title, sortOrder: c.sortOrder ?? null })),
      // The query has no total: the count is exact only when this page is the last one.
      questionCount: qs.pagingMetadata?.hasNext ? null : questions.length,
      questions: questions.map((q) => ({ question: q.question, categoryId: q.categoryId, sortOrder: q.sortOrder ?? null, slug: q.slug ?? null, hasAnswer: !!(q.plainText || q.richContent || q.draftjs) })),
    };
  },
});
