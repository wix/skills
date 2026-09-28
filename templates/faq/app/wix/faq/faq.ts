// FAQ reads (Wix FAQ app: Categories V2 + Question Entries V2) over the SDK — the only file that
// touches raw FAQ entities on this transport. Everything it returns is a plain DTO from ./types. The
// rules and mappers live in ./faq-core (shared with the REST twin in templates/faq/rest/); this file
// is the transport only. Copy as-is; extend by adding functions, not by editing these. The vertical
// is read-only: authoring stays in the dashboard.
// docs: https://dev.wix.com/docs/rest/business-management/faq-app/faq/category-v2/query-categories.md
// docs: https://dev.wix.com/docs/rest/business-management/faq-app/faq/question-entry-v2/query-question-entries.md
import { category as categoryModule, questionEntry as questionModule } from "@wix/faq";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import {
  CONTENT_FORMAT,
  FAQ_APP_ID,
  FIELD_SET,
  PAGE_LIMIT,
  assembleFaq,
  loadAllQuestions,
  sortCategories,
  toCategory,
  toQuestion,
  type Raw,
} from "./faq-core";
import type { FaqCategory, FaqData, FaqQuestion, FaqQuestionPage, FetchQuestionsOptions } from "./types";

export { FAQ_APP_ID };

const categories = wixModule(categoryModule);
const questions = wixModule(questionModule);

/** All categories in owner order (a site has few; one page of 100 is the whole list). `questionCount` is 0 here — fetchFaq fills it. */
export async function fetchCategories(): Promise<FaqCategory[]> {
  const res = await categories.queryCategories().ascending("sortOrder").limit(PAGE_LIMIT).find();
  return sortCategories((res.items ?? []).map((c: Raw) => toCategory(c)));
}

/**
 * One cursor page of questions, optionally one category's, in owner order, with the Ricos answer and
 * the share link. The builder spells faq-core's questionsQueryBody: filter + sort on the first page,
 * the cursor alone after (a cursor encodes the original filter+sort).
 */
export async function fetchQuestions(o: FetchQuestionsOptions = {}): Promise<FaqQuestionPage> {
  const { categoryId = null, limit = PAGE_LIMIT, cursor = null } = o;
  let q = questions.queryQuestionEntries({ contentFormat: CONTENT_FORMAT, fieldSet: [...FIELD_SET] });
  if (cursor) {
    q = q.skipTo(cursor);
  } else {
    if (categoryId) q = q.eq("categoryId", categoryId);
    q = q.ascending("sortOrder");
  }
  const res = await q.limit(Math.min(Math.max(1, limit), PAGE_LIMIT)).find();
  return {
    questions: (res.items ?? []).map((r: Raw) => toQuestion(r, imgSrc)),
    nextCursor: res.hasNext() ? (res.cursors?.next ?? null) : null,
  };
}

/** Everything the FAQ page needs: categories (counted) + every question (paged until done or MAX_QUESTIONS). */
export async function fetchFaq(): Promise<FaqData> {
  const [cats, { questions: all, truncated }] = await Promise.all([fetchCategories(), loadAllQuestions(fetchQuestions)]);
  return assembleFaq(cats, all, truncated);
}

/** One question by id (a redirect page, a widget) — the same query read as the page, so one permission covers both. Null when missing. */
export async function fetchQuestionById(id: string): Promise<FaqQuestion | null> {
  const res = await questions
    .queryQuestionEntries({ contentFormat: CONTENT_FORMAT, fieldSet: [...FIELD_SET] })
    .eq("_id", id)
    .limit(1)
    .find();
  const raw = res.items?.[0];
  return raw ? toQuestion(raw as Raw, imgSrc) : null;
}
