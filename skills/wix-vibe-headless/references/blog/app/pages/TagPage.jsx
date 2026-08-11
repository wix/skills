// Tag landing page — resolves the URL slug to a tag (getTagBySlug → null on miss), then lists that
// tag's posts via queryPostsByTag (same { posts, nextCursor } shape as the feed). Displays the tag by
// .label (per-tag count is publishedPostCount). Styled with base44 design tokens (shadcn Tailwind classes).
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
    <main className="max-w-[1100px] mx-auto p-4">
      <h1 className="font-display mb-4">#{tag?.label || "…"}</h1>
      {posts === null
        ? <p className="text-muted-foreground">Loading…</p>
        : <PostGrid posts={posts} empty="No posts with this tag yet." />}
      {cursor && (
        <div className="text-center mt-8">
          <button onClick={loadMore}
            className="py-3 px-6 cursor-pointer text-[15px] font-semibold bg-primary text-primary-foreground border-none rounded-sm">Load more</button>
        </div>
      )}
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
