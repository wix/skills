// Taxonomy state — categories + tags fetched ONCE and shared across every page/card. Wrap the app
// in <TaxonomyProvider>; components read useTaxonomy(). Resolving a post's categoryIds/tagIds to
// chip labels runs on every post render, so this MUST be a single shared fetch — never re-query per
// card. Data wiring (destructuring, .label display, id→object maps) is correct as-is; don't re-derive.
import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { queryCategories, queryTags } from "@/rest/wix-blog";

const TaxonomyContext = createContext(null);

export function TaxonomyProvider({ children }) {
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);

  useEffect(() => {
    // NB: destructure — queryCategories → { categories, total }, queryTags → { tags, total }.
    queryCategories().then(({ categories }) => setCategories(categories));
    queryTags().then(({ tags }) => setTags(tags));
  }, []);

  // display c.label · count c.postCount  /  display t.label · count t.publishedPostCount
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  return (
    <TaxonomyContext.Provider value={{ categories, tags, catById, tagById }}>
      {children}
    </TaxonomyContext.Provider>
  );
}

export function useTaxonomy() {
  const ctx = useContext(TaxonomyContext);
  if (!ctx) throw new Error("useTaxonomy must be used within <TaxonomyProvider>");
  return ctx;
}
