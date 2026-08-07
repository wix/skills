// Category landing page — resolves the URL slug to a category (getCategoryBySlug → null on miss),
// then lists that category's posts via queryPostsByCategory (same { posts, nextCursor } shape as the
// feed, so paging is identical). Displays the category by .label; cover from category.coverImage.url
// (a DIFFERENT path from the post cover). Token-styled; re-skin via theme.css.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getCategoryBySlug, queryPostsByCategory } from "@/rest/wix-blog";
import PostGrid from "@/components/PostGrid";

export default function CategoryPage() {
  const { slug } = useParams();
  const [category, setCategory] = useState(undefined);   // undefined=loading, null=not found
  const [posts, setPosts] = useState(null);
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    setCategory(undefined); setPosts(null); setCursor(null);
    getCategoryBySlug(slug).then((c) => {
      setCategory(c);
      if (!c) return;
      queryPostsByCategory(c.id, { limit: 20 }).then(({ posts, nextCursor }) => { setPosts(posts); setCursor(nextCursor); });
    });
  }, [slug]);

  const loadMore = () =>
    queryPostsByCategory(category.id, { limit: 20, cursor }).then(({ posts: more, nextCursor }) => {
      setPosts((p) => [...(p || []), ...more]);
      setCursor(nextCursor);
    });

  if (category === null) return <Centered>Category not found.</Centered>;

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: 4 }}>{category?.label || "…"}</h1>
      {category?.description && (
        <p style={{ color: "var(--color-muted)", marginBottom: "var(--space)" }}>{category.description}</p>
      )}
      {posts === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <PostGrid posts={posts} empty="No posts in this category yet." />}
      {cursor && (
        <div style={{ textAlign: "center", marginTop: "calc(var(--space) * 2)" }}>
          <button onClick={loadMore} style={{
            padding: "12px 24px", cursor: "pointer", fontSize: 15, fontWeight: 600,
            background: "var(--color-primary)", color: "var(--color-on-primary)",
            border: "none", borderRadius: "var(--radius-sm)",
          }}>Load more</button>
        </div>
      )}
    </main>
  );
}

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
