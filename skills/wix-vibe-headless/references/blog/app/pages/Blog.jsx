// Blog feed — lists published posts (newest first, pinned lead), paginates via nextCursor, and
// shows the shipped empty state when the blog has no posts. Styled with base44 design tokens (shadcn Tailwind classes).
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
    <main className="max-w-[1100px] mx-auto p-4">
      <h1 className="font-display mb-4">Blog</h1>
      {posts === null
        ? <p className="text-muted-foreground">Loading…</p>
        : <PostGrid posts={posts} empty={total === 0
            ? "No posts yet — publish posts from your Wix dashboard to see them here."
            : "No posts to show."} />}
      {cursor && (
        <div className="text-center mt-8">
          <button onClick={loadMore}
            className="py-3 px-6 cursor-pointer text-[15px] font-semibold bg-primary text-primary-foreground border-none rounded-sm">Load more</button>
        </div>
      )}
    </main>
  );
}
