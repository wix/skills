// FAQ DTOs — the serializable shapes every hook, component, and page consumes. Plain JSON: safe as
// Astro island props or across server/client boundaries. Answers arrive as HTML the core produced
// from the API's rich content (sanitized: text escaped, only http(s) links, no scripts or styles),
// plus a plain-text twin for search, snippets, and structured data. No dates: the API's
// _createdDate/_updatedDate are not visitor-facing and are dropped in the data layer.

export interface FaqCategory {
  id: string;
  /** Category title as the owner typed it (the API has no description or visibility on a category). */
  title: string;
  /** The API's sortOrder — lower first; null sorts after the numbered ones, stable by title. */
  sortOrder: number | null;
  /** Filled by the core from the loaded questions — hide empty categories with it. */
  questionCount: number;
}

export interface FaqQuestion {
  id: string;
  /** The API's readonly slug, generated from the question text ("" when absent). The anchor id is `q-<slug || id>`. */
  slug: string;
  question: string;
  /** Sanitized HTML for the answer body — render with set:html / dangerouslySetInnerHTML on a wrapper you control. */
  answerHtml: string;
  /** Plain text of the answer — search, meta descriptions, JSON-LD. */
  answerText: string;
  categoryId: string;
  /** Order within the category — lower first; null sorts last. */
  sortOrder: number | null;
  /** Wix's own share link (points at the Wix-hosted FAQ widget, "" when the query did not ask for it). Our deep link is `faqDeepLink()`. */
  shareLink: string;
  /** Label titles — not shown to visitors; grouping for chatbots and integrations. */
  labels: string[];
}

/** One category with its questions in display order. */
export interface FaqSection {
  category: FaqCategory;
  questions: FaqQuestion[];
}

/** Everything the FAQ page renders from — the unit the SSR fetch hands the islands. */
export interface FaqData {
  categories: FaqCategory[];
  questions: FaqQuestion[];
  /** True when the loader hit MAX_QUESTIONS before the site's last page (more questions exist). */
  truncated: boolean;
}

/** One cursor page of questions — the paged path for a very large FAQ. */
export interface FaqQuestionPage {
  questions: FaqQuestion[];
  /** Pass back as `cursor` for the next page; null → no more. */
  nextCursor: string | null;
}

export interface FetchQuestionsOptions {
  /** First page only — the cursor carries the filter on later pages. */
  categoryId?: string | null;
  /** Page size (default and maximum 100 — the API's CursorPaging.limit cap). */
  limit?: number;
  /** `nextCursor` from a previous page. */
  cursor?: string | null;
}
