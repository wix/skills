// Blog feed + taxonomy filter + cursor paging. SSR-friendly: pass server-fetched data as
// `initial*` (Astro frontmatter / server component) and no client fetch happens; a SPA passes
// nothing. Category/tag filtering fetches live (server-side-filtered); the two filters are
// mutually exclusive — setting one clears the other.
import { useEffect, useState } from "react";
import { fetchPosts } from "../../wix/blog/posts";
import { fetchBlogCategories, fetchBlogTags } from "../../wix/blog/taxonomy";
import type { BlogCategory, BlogTag, PostPage, PostSummary } from "../../wix/blog/types";

export interface UseBlogFeedOptions {
  initialPage?: PostPage;
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
  pageSize?: number;
}

export interface UseBlogFeed {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  posts: PostSummary[] | null;
  categories: BlogCategory[];
  tags: BlogTag[];
  activeCategoryId: string | null;
  setActiveCategoryId: (id: string | null) => void;
  activeTagId: string | null;
  setActiveTagId: (id: string | null) => void;
  /** True when another page exists — render a "load more" control on it. */
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  error: string | null;
}

export function useBlogFeed({
  initialPage,
  initialCategories,
  initialTags,
  pageSize = 20,
}: UseBlogFeedOptions = {}): UseBlogFeed {
  const [posts, setPosts] = useState<PostSummary[] | null>(initialPage?.posts ?? null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage?.nextCursor ?? null);
  const [categories, setCategories] = useState<BlogCategory[]>(initialCategories ?? []);
  const [tags, setTags] = useState<BlogTag[]>(initialTags ?? []);
  const [activeCategoryId, setCategoryId] = useState<string | null>(null);
  const [activeTagId, setTagId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!initialCategories) {
      fetchBlogCategories().then((c) => alive && setCategories(c));
    }
    if (!initialTags) {
      fetchBlogTags().then((t) => alive && setTags(t));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The unfiltered first page may have come from the server; only fetch when it didn't,
    // or when a filter is active (filters are server-side).
    if (activeCategoryId === null && activeTagId === null && initialPage) {
      setPosts(initialPage.posts);
      setNextCursor(initialPage.nextCursor);
      return;
    }
    let alive = true;
    setPosts(null);
    setError(null);
    fetchPosts({ limit: pageSize, categoryId: activeCategoryId, tagId: activeTagId })
      .then((page) => {
        if (!alive) return;
        setPosts(page.posts);
        setNextCursor(page.nextCursor);
      })
      .catch((e) => {
        if (!alive) return;
        setPosts([]);
        setNextCursor(null);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryId, activeTagId, pageSize]);

  function loadMore(): void {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    fetchPosts({ limit: pageSize, cursor: nextCursor })
      .then((page) => {
        setPosts((prev) => [...(prev ?? []), ...page.posts]);
        setNextCursor(page.nextCursor);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingMore(false));
  }

  return {
    posts,
    categories,
    tags,
    activeCategoryId,
    setActiveCategoryId: (id) => {
      setCategoryId(id);
      setTagId(null);
    },
    activeTagId,
    setActiveTagId: (id) => {
      setTagId(id);
      setCategoryId(null);
    },
    hasMore: nextCursor !== null,
    loadMore,
    loadingMore,
    error,
  };
}
