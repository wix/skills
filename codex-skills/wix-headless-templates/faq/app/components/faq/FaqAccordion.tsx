// REFERENCE accordion: the visible questions grouped by category, one expandable answer per question,
// on the @theme tokens. Correct and complete; per the skill's model you design and build your own on
// useFaq. Accessible by construction — the question is a <button aria-expanded aria-controls> inside a
// heading, the answer a role="region" panel labelled by it, collapsed with `hidden` (so a no-JS visitor
// and a search engine still get every answer in the HTML). No fetching, no routing; the ONLY HTML render
// is `answerHtml`, which the core sanitized.
import { useState, type ComponentType, type ReactNode } from "react";
import { useFaq, type UseFaqOptions } from "../../hooks/faq/useFaq";
import { anchorId, faqDeepLink } from "../../wix/faq/faq-core";
import type { FaqQuestion, FaqSection } from "../../wix/faq/types";

export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: ReactNode;
}

const PlainLink = ({ href, className, children }: LinkLikeProps) => (
  <a href={href} className={className}>
    {children}
  </a>
);

// The answer's HTML is plain tags (p, h4, ul/ol/li, blockquote, pre/code, a, img, hr, strong/em/u/s):
// styled here through Tailwind's arbitrary-descendant variants, on the tokens.
const ANSWER_CLASS =
  "text-[15px] leading-relaxed text-foreground [&_p]:my-2 [&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:font-semibold " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 " +
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary [&_pre]:p-3 [&_pre]:text-sm " +
  "[&_a]:underline [&_a]:underline-offset-2 [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_hr]:my-4 [&_hr]:border-border";

export interface FaqAccordionProps extends UseFaqOptions {
  /** The FAQ page's path — the base of every copied deep link (default "/faq"). */
  base?: string;
  emptyMessage?: string;
  /** Category headings above each group. Default: only while every category shows (no active filter). */
  showCategoryHeadings?: boolean;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

function Skeleton() {
  return (
    <div aria-busy="true" className="divide-y divide-border">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="py-5">
          <div className="h-4 w-3/4 animate-pulse rounded bg-secondary" />
        </div>
      ))}
    </div>
  );
}

export default function FaqAccordion({
  base = "/faq",
  emptyMessage = "No questions yet.",
  showCategoryHeadings,
  LinkComponent = PlainLink,
  ...options
}: FaqAccordionProps) {
  const { data, sections, visible, query, activeCategoryId, error, loading, isExpanded, toggleQuestion, setQuery, retry } = useFaq(options);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const headings = showCategoryHeadings ?? activeCategoryId === null;

  // The deep link to one question, absolute when a browser is present. Clipboard access is browser-only
  // and may be refused (insecure context); the link is also rendered as an <a>, so nothing is lost.
  const copyLink = (q: FaqQuestion) => {
    const href = faqDeepLink(q, base, activeCategoryId);
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    const abs = typeof location !== "undefined" ? new URL(href, location.href).toString() : href;
    navigator.clipboard.writeText(abs).then(
      () => {
        setCopiedId(q.id);
        setTimeout(() => setCopiedId((c) => (c === q.id ? null : c)), 2000);
      },
      () => {},
    );
  };

  if (data === null) return <Skeleton />;

  return (
    <div>
      {error && (
        <p className="mb-4 flex items-center gap-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" onClick={retry} disabled={loading} className="rounded-md border border-border px-3 py-1 text-foreground hover:bg-secondary disabled:opacity-50">
            Try again
          </button>
        </p>
      )}
      {data.questions.length === 0 ? (
        !error && <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
      ) : visible.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          {query.trim() ? (
            <>
              No results for &ldquo;{query.trim()}&rdquo;.{" "}
              <button type="button" onClick={() => setQuery("")} className="underline underline-offset-2 text-foreground">
                Clear search
              </button>
            </>
          ) : (
            emptyMessage
          )}
        </p>
      ) : (
        sections.map((section: FaqSection) => (
          <section key={section.category.id} aria-labelledby={headings ? `faq-cat-${section.category.id}` : undefined} className="mb-10">
            {headings && (
              <h2 id={`faq-cat-${section.category.id}`} className="mb-2 text-xl font-semibold tracking-tight">
                {section.category.title}
              </h2>
            )}
            <div className="divide-y divide-border border-y border-border">
              {section.questions.map((q) => {
                const expanded = isExpanded(q.id);
                const id = anchorId(q);
                return (
                  <div key={q.id} id={id} className="scroll-mt-24">
                    <h3 className="m-0">
                      <button
                        type="button"
                        id={`${id}-button`}
                        aria-expanded={expanded}
                        aria-controls={`${id}-panel`}
                        onClick={() => toggleQuestion(q.id)}
                        className="flex w-full items-start justify-between gap-4 py-4 text-left text-base font-medium text-foreground hover:text-muted-foreground"
                      >
                        <span>{q.question}</span>
                        <span aria-hidden="true" className={`mt-1 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-45" : ""}`}>
                          +
                        </span>
                      </button>
                    </h3>
                    <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-button`} hidden={!expanded} className="pb-5">
                      <div className={ANSWER_CLASS} dangerouslySetInnerHTML={{ __html: q.answerHtml }} />
                      <p className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                        <LinkComponent href={faqDeepLink(q, base, activeCategoryId)} className="underline underline-offset-2">
                          Link to this question
                        </LinkComponent>
                        <button type="button" onClick={() => copyLink(q)} className="underline underline-offset-2">
                          {copiedId === q.id ? "Copied" : "Copy link"}
                        </button>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      {data.truncated && (
        <p className="mt-6 text-sm text-muted-foreground">Showing the first {data.questions.length} questions.</p>
      )}
    </div>
  );
}
