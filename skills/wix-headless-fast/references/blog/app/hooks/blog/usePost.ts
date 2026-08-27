// One post by slug + its resolved category/tag chips. SSR-friendly: pass the server-fetched
// post (and taxonomy) as `initial*` and no client fetch happens; a SPA passes only the slug.
// Chips resolve from the FULL taxonomy lists (blog taxonomies are small, fetched once) —
// never per-id lookups in a render loop.
import { useEffect, useMemo, useState } from "react";
import { fetchPostBySlug } from "../../wix/blog/posts";
import { fetchBlogCategories, fetchBlogTags } from "../../wix/blog/taxonomy";
import type { BlogCategory, BlogTag, PostDetail } from "../../wix/blog/types";

export interface UsePostOptions {
  slug: string;
  initialPost?: PostDetail;
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
}

export interface UsePost {
  /** null while loading (render a skeleton) AND when not found — disambiguate via notFound. */
  post: PostDetail | null;
  /** True once the slug definitively resolved to nothing — render a not-found state. */
  notFound: boolean;
  /** This post's categories/tags, resolved to full objects (display .label, route by .slug). */
  categories: BlogCategory[];
  tags: BlogTag[];
  error: string | null;
}

export function usePost({ slug, initialPost, initialCategories, initialTags }: UsePostOptions): UsePost {
  const [post, setPost] = useState<PostDetail | null>(initialPost ?? null);
  const [notFound, setNotFound] = useState(false);
  const [allCategories, setAllCategories] = useState<BlogCategory[]>(initialCategories ?? []);
  const [allTags, setAllTags] = useState<BlogTag[]>(initialTags ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!initialPost || initialPost.slug !== slug) {
      setPost(null);
      setNotFound(false);
      fetchPostBySlug(slug)
        .then((p) => {
          if (!alive) return;
          if (p) setPost(p);
          else setNotFound(true);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    }
    if (!initialCategories) {
      fetchBlogCategories().then((c) => alive && setAllCategories(c));
    }
    if (!initialTags) {
      fetchBlogTags().then((t) => alive && setAllTags(t));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const categories = useMemo(
    () => (post ? allCategories.filter((c) => post.categoryIds.includes(c.id)) : []),
    [post, allCategories],
  );
  const tags = useMemo(
    () => (post ? allTags.filter((t) => post.tagIds.includes(t.id)) : []),
    [post, allTags],
  );

  return { post, notFound, categories, tags, error };
}
