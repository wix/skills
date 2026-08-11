// useCollectionProjects — one collection's header + its project grid, no markup. Resolve the
// collection by slug (null → not-found), then page its projects. getCollectionBySlug returns the
// object or null; queryProjectsByCollection returns { projects, nextCursor } (an OBJECT) — keep
// the destructuring, or `.map` on the result throws.
import { useState, useEffect } from "react";
import { getCollectionBySlug, queryProjectsByCollection } from "@/rest/wix-portfolio";

export function useCollectionProjects(slug, { limit = 24 } = {}) {
  const [collection, setCollection] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [projects, setProjects] = useState(null); // null = loading
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    setNotFound(false);
    setProjects(null);
    getCollectionBySlug(slug).then((c) => {
      if (!c) return setNotFound(true);
      setCollection(c);
      queryProjectsByCollection(c.id, { limit }).then(({ projects, nextCursor }) => {
        setProjects(projects);
        setCursor(nextCursor);
      });
    });
  }, [slug, limit]);

  const loadMore = () =>
    collection &&
    queryProjectsByCollection(collection.id, { limit, cursor }).then(({ projects: more, nextCursor }) => {
      setProjects((p) => [...(p ?? []), ...more]);
      setCursor(nextCursor);
    });

  return { collection, notFound, projects, cursor, loadMore };
}
