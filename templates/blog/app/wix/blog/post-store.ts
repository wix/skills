// One post as a framework-free store — the logic behind usePost, usable from React (usePost wraps
// it), from a static page's post view, from Vue/Svelte, or as the specification for a port. Loads
// the post by slug (unless seeded), resolves its category chips from the catalog and its tag chips
// BY ID (both in the post's own order), loads the related strip, and — in a browser only — the
// viewer's like state with fresh counters, with an optimistic like toggle.
//
// SSR-friendly: pass the server-fetched PostDetail as `initialPost` (plus `initialCategories`,
// `initialTags`, `initialRelated`) and no client read happens except the personal like state; a SPA
// passes only the slug. One store per post surface: createPostStore().
import { fetchPostBySlug, fetchRelatedPosts } from "./posts";
import { fetchLikeState, likePost, unlikePost } from "./post-likes";
import { fetchBlogCategories, fetchTagsByIds, inIdOrder } from "./taxonomy";
import type { BlogCategory, BlogTag, PostDetail, PostSummary } from "./types";

export interface PostStoreOptions {
  slug: string;
  initialPost?: PostDetail;
  /** The category catalog (or just this post's categories) — chips resolve from it in the post's order. */
  initialCategories?: BlogCategory[];
  /** This post's tags, already resolved — skips the by-id read. */
  initialTags?: BlogTag[];
  /** The related strip, server-fetched — skips the client read. */
  initialRelated?: PostSummary[];
  /** Read the viewer's like state and fresh counters, client-side (default true; never runs on a server). */
  engagement?: boolean;
}

export interface PostState {
  /** null while loading (render a skeleton) AND when not found — disambiguate via notFound. */
  post: PostDetail | null;
  /** True once the slug definitively resolved to nothing — render a not-found state. */
  notFound: boolean;
  /** This post's categories/tags, in the post's order, resolved to full objects (display .label, route by .slug). */
  categories: BlogCategory[];
  tags: BlogTag[];
  /** Related posts (curated, else same-category recents); null while loading, [] when there are none. */
  related: PostSummary[] | null;
  /** Whether THIS viewer liked the post (false until the client read lands). */
  isLiked: boolean;
  /** The like count to show: the fresh read (else the post's own) plus this viewer's optimistic change; undefined = unknown. */
  likeCount: number | undefined;
  /** True once the fresh counters landed — render a skeleton for the like count until then. */
  likeCountLoaded: boolean;
  viewCount: number | undefined;
  commentCount: number | undefined;
  /** A like write is in flight — disable the control. */
  liking: boolean;
  error: string | null;
}

export interface PostStore {
  getState(): PostState;
  subscribe(listener: () => void): () => void;
  /** Fetch what was not seeded, then (browser only) the like state. Call once when mounted. */
  start(): void;
  stop(): void;
  /** Like / unlike as the current viewer: optimistic, rolled back on failure, one write at a time. */
  toggleLike(): Promise<void>;
}

export function createPostStore({ slug, initialPost, initialCategories, initialTags, initialRelated, engagement = true }: PostStoreOptions): PostStore {
  let post: PostDetail | null = initialPost && initialPost.slug === slug ? initialPost : null;
  let notFound = false;
  let catalog: BlogCategory[] | null = initialCategories ?? null;
  let tags: BlogTag[] = initialTags && post ? inIdOrder(post.tagIds, initialTags) : [];
  let related: PostSummary[] | null = initialRelated ?? null;
  let liked = false;
  let baselineLiked = false; // what the server said — the optimistic delta is measured against it
  let freshLikes: number | undefined;
  let likeCountLoaded = false;
  let viewCount: number | undefined = post?.viewCount;
  let commentCount: number | undefined = post?.commentCount;
  let liking = false;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: PostState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  function likeCount(): number | undefined {
    const base = freshLikes ?? post?.likeCount;
    return base === undefined ? undefined : Math.max(0, base + Number(liked) - Number(baselineLiked));
  }

  function getState(): PostState {
    if (snapshot) return snapshot;
    snapshot = {
      post,
      notFound,
      categories: post && catalog ? inIdOrder(post.categoryIds, catalog) : [],
      tags,
      related,
      isLiked: liked,
      likeCount: likeCount(),
      likeCountLoaded,
      viewCount,
      commentCount,
      liking,
      error,
    };
    return snapshot;
  }

  // Everything that needs the post: tag chips by id, the related strip, the viewer's like state.
  function afterPost(p: PostDetail): void {
    if (!initialTags) fetchTagsByIds(p.tagIds).then((t) => { if (started) { tags = t; emit(); } });
    if (!initialRelated) fetchRelatedPosts(p).then((r) => { if (started) { related = r; emit(); } });
    // Personal and visitor-scoped: never during SSR (the identity there is the app, not the viewer).
    if (engagement && typeof window !== "undefined") {
      fetchLikeState(p.id).then(({ liked: l, metrics }) => {
        if (!started) return;
        liked = baselineLiked = l;
        if (metrics) {
          freshLikes = metrics.likes;
          viewCount = metrics.views ?? viewCount;
          commentCount = metrics.comments ?? commentCount;
        }
        likeCountLoaded = true;
        emit();
      });
    }
  }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (!catalog) fetchBlogCategories().then((c) => { if (started) { catalog = c; emit(); } });
      if (post) {
        afterPost(post);
      } else {
        notFound = false; emit();
        fetchPostBySlug(slug)
          .then((p) => {
            if (!started) return;
            if (p) { post = p; viewCount = p.viewCount; commentCount = p.commentCount; afterPost(p); } else notFound = true;
            emit();
          })
          .catch((e) => { if (started) { error = e instanceof Error ? e.message : String(e); emit(); } });
      }
    },
    stop() { started = false; },
    async toggleLike() {
      if (!post || liking) return;
      const next = !liked;
      liked = next; liking = true; emit(); // optimistic flip
      try {
        await (next ? likePost(post.id) : unlikePost(post.id));
      } catch {
        liked = !next; // roll back — the control reverting is the whole error surface
      } finally {
        liking = false; emit();
      }
    },
  };
}
