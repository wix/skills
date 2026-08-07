// Category + tag chips for a post. Resolves the post's categoryIds/tagIds against the SHARED
// taxonomy maps (fetched once by TaxonomyProvider — never re-query here), displays each by .label
// (NOT .name), and routes by .slug. Token-styled; re-skin via theme.css.
import { Link } from "react-router-dom";
import { useTaxonomy } from "@/context/TaxonomyContext";

const chip = {
  display: "inline-flex", alignItems: "center", padding: "4px 10px", fontSize: 12,
  textDecoration: "none", color: "var(--color-text)",
  background: "var(--color-surface)", border: "1px solid var(--color-border)",
  borderRadius: 999,
};

export default function PostChips({ post }) {
  const { catById, tagById } = useTaxonomy();
  const cats = (post.categoryIds || []).map((id) => catById.get(id)).filter(Boolean);
  const tags = (post.tagIds || []).map((id) => tagById.get(id)).filter(Boolean);
  if (!cats.length && !tags.length) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {cats.map((c) => (
        <Link key={c.id} to={`/blog/category/${c.slug}`} style={{ ...chip, color: "var(--color-accent)", borderColor: "var(--color-accent)" }}>{c.label}</Link>
      ))}
      {tags.map((t) => (
        <Link key={t.id} to={`/blog/tag/${t.slug}`} style={chip}>#{t.label}</Link>
      ))}
    </div>
  );
}
