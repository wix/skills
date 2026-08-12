// Portfolio page — collections gallery (grid + empty state + paging). Thin view over
// usePortfolioGallery (all data logic lives in the hook). Styled with base44 design tokens (shadcn Tailwind classes).
import { usePortfolioGallery } from "@/hooks/usePortfolioGallery";
import CollectionGrid from "@/components/CollectionGrid";

export default function Portfolio() {
  const { collections, total, cursor, loadMore } = usePortfolioGallery({ limit: 24 });

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <h1 className="font-display mb-4">Work</h1>
      {collections === null
        ? <p className="text-muted-foreground">Loading…</p>
        : <CollectionGrid
            collections={collections}
            empty={total === 0 ? "No collections yet — add them from your Wix dashboard." : "No collections to show."} />}
      {cursor && (
        <div className="flex justify-center mt-6">
          <button onClick={loadMore}
            className="px-6 py-2.5 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold">
            Load more
          </button>
        </div>
      )}
    </main>
  );
}
