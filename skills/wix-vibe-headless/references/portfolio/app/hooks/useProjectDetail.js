// useProjectDetail — project-detail data, no markup: load a project by slug (null → not-found),
// then load its media gallery. listProjectItems returns { items, total } (an OBJECT, not a bare
// array) — iterate `items`; that shape is the bug-prone part. The PDP page only renders what this
// returns. details[] rows come through untouched: [{ label, text? OR link: { text, url, target } }].
import { useState, useEffect } from "react";
import { getProjectBySlug, listProjectItems } from "@/rest/wix-portfolio";

export function useProjectDetail(slug) {
  const [project, setProject] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    setNotFound(false);
    setProject(null);
    setItems([]);
    getProjectBySlug(slug).then((p) => {
      if (!p) return setNotFound(true);
      setProject(p);
      listProjectItems(p.id).then(({ items }) => setItems(items));
    });
  }, [slug]);

  return { project, notFound, items };
}
