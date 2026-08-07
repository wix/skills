// Tag landing page — resolves the URL slug to a tag (getTagBySlug → null on miss), then lists that
// tag's posts via queryPostsByTag (same { posts, nextCursor } shape as the feed). Displays the tag by
// .label (per-tag count is publishedPostCount). Token-styled; re-skin via theme.css.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getTagBySlug, queryPostsByTag } from "@/rest/wix-blog";
import PostGrid from "@/components/PostGrid";

export default function TagPage() {
  const { slug } = useParams();
  const [tag, setTag] = useState(undefined);   // undefined=loading, null=not found
  const [posts, setPosts] = useState(null);
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    setTag(undefined); setPosts(null); setCursor(null);
    getTagBySlug(slug).then((t) => {
      setTag(t);
      if (!t) return;
      queryPostsByTag(t.id, { limit: 20 }).then(({ posts, nextCursor }) => { setPosts(posts); setCursor(nextCursor); });
    });
  }, [slug]);

  const loadMore = () =>
    queryPostsByTag(tag.id, { limit: 20, cursor }).then(({ posts: more, nextCursor }) => {
      setPosts((p) => [...(p || []), ...more]);
      setCursor(nextCursor);
    });

  if (tag === null) return <Centered>Tag not found.</Centered>;

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>#{tag?.label || "…"}</h1>
      {posts === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <PostGrid posts={posts} empty="No posts with this tag yet." />}
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
