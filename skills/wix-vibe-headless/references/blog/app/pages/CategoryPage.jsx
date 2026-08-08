// Category landing page — resolves the URL slug to a category (getCategoryBySlug → null on miss),
// then lists that category's posts via queryPostsByCategory (same { posts, nextCursor } shape as the
// feed, so paging is identical). Displays the category by .label; cover from category.coverImage.url
// (a DIFFERENT path from the post cover). Styled with base44 design tokens (shadcn Tailwind classes).
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
    <main className="max-w-[1100px] mx-auto p-4">
      <h1 className="font-display mb-1">{category?.label || "…"}</h1>
      {category?.description && (
        <p className="text-muted-foreground mb-4">{category.description}</p>
      )}
      {posts === null
        ? <p className="text-muted-foreground">Loading…</p>
        : <PostGrid posts={posts} empty="No posts in this category yet." />}
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
