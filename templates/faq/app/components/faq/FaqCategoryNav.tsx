// REFERENCE category filter: "All" plus one pill per category that has questions, on the @theme
// tokens. Correct and complete; per the skill's model you design and build your own on useFaq.
// Renders nothing while fewer than two categories have questions. `asLinks` renders plain anchors to
// `?category=<id>` instead of buttons — a no-JS fallback (the page pre-selects the category server-side).
import { useFaq, type UseFaqOptions } from "../../hooks/faq/useFaq";

export interface FaqCategoryNavProps extends UseFaqOptions {
  /** The FAQ page's path (default "/faq") — the href base in asLinks mode. */
  base?: string;
  asLinks?: boolean;
  allLabel?: string;
}

const pill = (active: boolean) =>
  `rounded-control border px-4 py-1.5 text-sm font-medium transition-colors ${
    active ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-secondary"
  }`;

export default function FaqCategoryNav({ base = "/faq", asLinks = false, allLabel = "All", ...options }: FaqCategoryNavProps) {
  const { data, activeCategoryId, selectCategory } = useFaq(options);
  const categories = (data?.categories ?? []).filter((c) => c.questionCount > 0);
  if (categories.length < 2) return null;

  const items = [{ id: null as string | null, title: allLabel }, ...categories.map((c) => ({ id: c.id as string | null, title: c.title }))];

  return (
    <nav aria-label="Categories" className="mb-8 flex flex-wrap gap-2">
      {items.map((item) =>
        asLinks ? (
          <a
            key={item.id ?? "all"}
            href={item.id ? `${base}?category=${encodeURIComponent(item.id)}` : base}
            aria-current={activeCategoryId === item.id ? "page" : undefined}
            className={`${pill(activeCategoryId === item.id)} no-underline`}
          >
            {item.title}
          </a>
        ) : (
          <button key={item.id ?? "all"} type="button" aria-pressed={activeCategoryId === item.id} onClick={() => selectCategory(item.id)} className={pill(activeCategoryId === item.id)}>
            {item.title}
          </button>
        ),
      )}
    </nav>
  );
}
