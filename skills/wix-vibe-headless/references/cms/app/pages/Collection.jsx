// Collection / list page — lists items from the configured collection, with a Load-more button and
// an empty state when the collection is empty. Thin view over useCollection (all logic in the hook).
// Route this at whatever path fits your content (e.g. /posts, /recipes); the card links to /item/:key.
import { useCollection } from "@/hooks/useCollection";
import ItemGrid from "@/components/ItemGrid";

export default function Collection() {
  const { items, total, loadMore, hasMore } = useCollection({ limit: 24 });

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      {items === null && total === null
        ? <p className="text-muted-foreground">Loading…</p>
        : (
          <>
            <ItemGrid items={items} empty="No items yet — add some from your Wix dashboard." />
            {hasMore && (
              <div className="text-center mt-6">
                <button onClick={loadMore}
                  className="px-6 py-2.5 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold">
                  Load more
                </button>
              </div>
            )}
          </>
        )}
    </main>
  );
}
