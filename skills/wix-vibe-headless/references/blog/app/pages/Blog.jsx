// Blog feed — lists published posts (newest first, pinned lead), paginates via nextCursor, and
// shows the shipped empty state when the blog has no posts. Token-styled; re-skin via theme.css.
import { useEffect, useState } from "react";
import { queryPosts, getTotalPosts } from "@/rest/wix-blog";
import PostGrid from "@/components/PostGrid";

export default function Blog() {
  const [posts, setPosts] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [total, setTotal] = useState(null);

  useEffect(() => {
    getTotalPosts().then(setTotal);
    // NB: destructure — queryPosts returns { posts, nextCursor }, not a bare array.
    queryPosts({ limit: 20 }).then(({ posts, nextCursor }) => { setPosts(posts); setCursor(nextCursor); });
  }, []);

  const loadMore = () =>
    queryPosts({ limit: 20, cursor }).then(({ posts: more, nextCursor }) => {
      setPosts((p) => [...(p || []), ...more]);
      setCursor(nextCursor);
    });

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Blog</h1>
      {posts === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <PostGrid posts={posts} empty={total === 0
            ? "No posts yet — publish posts from your Wix dashboard to see them here."
            : "No posts to show."} />}
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
