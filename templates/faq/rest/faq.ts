// FAQ reads over REST — the twin of app/wix/faq/faq.ts. Same exports, same DTOs; the rules and mappers
// come from faq-core (the SAME file the SDK transport uses, deployed flat next to this one by
// deploy.mjs --stack static), so this file is only the transport: one fetch with a literal body per
// function. Both endpoints are the FAQ app's READ scope; whether an anonymous VISITOR token may call
// them is not documented — the reference shows an elevated example — so a 403 here means the site's
// read needs a server-side path, not that the body is wrong (INSTRUCTIONS.md, verification caveats).
// Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/rest/business-management/faq-app/faq/category-v2/query-categories.md
// docs: https://dev.wix.com/docs/rest/business-management/faq-app/faq/question-entry-v2/query-question-entries.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import {
  FAQ_APP_ID,
  assembleFaq,
  categoriesQueryBody,
  loadAllQuestions,
  nextCursor,
  questionByIdBody,
  questionsQueryBody,
  sortCategories,
  toCategory,
  toQuestion,
  type Raw,
} from "./faq-core.js";
import type { FaqCategory, FaqData, FaqQuestion, FaqQuestionPage, FetchQuestionsOptions } from "./types.js";

export { FAQ_APP_ID };

const CATEGORIES_QUERY = "/faq/v2/categories/query";
const QUESTIONS_QUERY = "/faq/v2/question-entries/query";

/**
 * All categories in owner order, one page (a site has few). `questionCount` is 0 here — fetchFaq fills it.
 * POST /faq/v2/categories/query  { query: { sort: [{ fieldName: "sortOrder", order: "ASC" }], cursorPaging: { limit: 100 } } }
 *   → { categories: [{ id, title, sortOrder, revision, createdDate, updatedDate }], pagingMetadata }
 */
export async function fetchCategories(): Promise<FaqCategory[]> {
  const res = await wixRequest<Raw>(CATEGORIES_QUERY, { body: categoriesQueryBody() });
  return sortCategories(((res?.categories ?? []) as Raw[]).map((c) => toCategory(c)));
}

/**
 * One cursor page of questions, optionally one category's; `nextCursor` continues the same query —
 * send it alone, the filter and sort ride inside it.
 * POST /faq/v2/question-entries/query  { query: { filter?: { categoryId: { $eq } }, sort, cursorPaging: { limit } }, contentFormat: "RICH_CONTENT", fieldSet: ["SHARE_LINKS"] }  — first page
 * POST /faq/v2/question-entries/query  { query: { cursorPaging: { limit, cursor } }, contentFormat, fieldSet }                                                        — later pages
 *   → { questionEntries: [{ id, question, richContent | plainText | draftjs, categoryId, sortOrder, slug, shareLink, labels }], pagingMetadata: { count, cursors: { next, prev }, hasNext } }
 */
export async function fetchQuestions(o: FetchQuestionsOptions = {}): Promise<FaqQuestionPage> {
  const res = await wixRequest<Raw>(QUESTIONS_QUERY, { body: questionsQueryBody(o) });
  return {
    questions: ((res?.questionEntries ?? []) as Raw[]).map((r) => toQuestion(r, imgSrc)),
    nextCursor: nextCursor(res?.pagingMetadata),
  };
}

/** Everything the FAQ page needs: categories (counted) + every question (paged until done or MAX_QUESTIONS). */
export async function fetchFaq(): Promise<FaqData> {
  const [cats, { questions, truncated }] = await Promise.all([fetchCategories(), loadAllQuestions(fetchQuestions)]);
  return assembleFaq(cats, questions, truncated);
}

/**
 * One question by id — the same query read as the page, so one permission covers both. Null when missing.
 * POST /faq/v2/question-entries/query  { query: { filter: { _id: { $eq } }, cursorPaging: { limit: 1 } }, contentFormat, fieldSet }
 */
export async function fetchQuestionById(id: string): Promise<FaqQuestion | null> {
  const res = await wixRequest<Raw>(QUESTIONS_QUERY, { body: questionByIdBody(id) });
  const raw: Raw | undefined = res?.questionEntries?.[0];
  return raw ? toQuestion(raw, imgSrc) : null;
}
