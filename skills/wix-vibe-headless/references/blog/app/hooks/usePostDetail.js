// usePostDetail — all post-detail logic, no markup: load a post by slug, expose a not-found state,
// resolve its categoryIds/tagIds to full category/tag objects via the shared taxonomy, and split the
// plain-text body into paragraphs. The field paths (media cover, id→label resolution, contentText
// split) are the bug-prone part — keep them verbatim; the PostDetail page only renders what this
// returns. richContent is available on the loaded post for a richer render (see INSTRUCTIONS).
import { useState, useEffect, useMemo } from "react";
import { getPostBySlug } from "@/rest/wix-blog";
import { useTaxonomy } from "@/context/TaxonomyContext";

export function usePostDetail(slug) {
  const { catById, tagById } = useTaxonomy();
  const [post, setPost] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setPost(null);
    setNotFound(false);
    getPostBySlug(slug).then((p) => (p ? setPost(p) : setNotFound(true)));
  }, [slug]);

  // Resolve ids → full objects; display .label, route by .slug (drop ids with no match).
  const cats = useMemo(
    () => (post?.categoryIds || []).map((id) => catById.get(id)).filter(Boolean),
    [post, catById],
  );
  const tags = useMemo(
    () => (post?.tagIds || []).map((id) => tagById.get(id)).filter(Boolean),
    [post, tagById],
  );

  // contentText is plain text — split on "\n" for simple paragraphs (drop blank lines).
  const paragraphs = useMemo(
    () => (post?.contentText || "").split("\n").map((s) => s.trim()).filter(Boolean),
    [post],
  );

  return { post, notFound, cats, tags, paragraphs };
}
