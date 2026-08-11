// Category + tag chips for a post. Resolves the post's categoryIds/tagIds against the SHARED
// taxonomy maps (fetched once by TaxonomyProvider — never re-query here), displays each by .label
// (NOT .name), and routes by .slug. Styled with base44 design tokens (shadcn Tailwind classes).
import { Link } from "react-router-dom";
import { useTaxonomy } from "@/context/TaxonomyContext";

const chip = "inline-flex items-center py-1 px-2.5 text-[12px] no-underline text-foreground bg-card border border-border rounded-full";

export default function PostChips({ post }) {
  const { catById, tagById } = useTaxonomy();
  const cats = (post.categoryIds || []).map((id) => catById.get(id)).filter(Boolean);
  const tags = (post.tagIds || []).map((id) => tagById.get(id)).filter(Boolean);
  if (!cats.length && !tags.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {cats.map((c) => (
        <Link key={c.id} to={`/blog/category/${c.slug}`} className={`${chip} text-primary border-primary`}>{c.label}</Link>
      ))}
      {tags.map((t) => (
        <Link key={t.id} to={`/blog/tag/${t.slug}`} className={chip}>#{t.label}</Link>
      ))}
    </div>
  );
}
