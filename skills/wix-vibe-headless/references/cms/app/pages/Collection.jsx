// Collection / list page — lists items from the configured collection, with a Load-more button and
// an empty state when the collection is empty. Thin view over useCollection (all logic in the hook).
// Route this at whatever path fits your content (e.g. /posts, /recipes); the card links to /item/:key.
import { useCollection } from "@/hooks/useCollection";
import ItemGrid from "@/components/ItemGrid";

export default function Collection() {
  const { items, total, loadMore, hasMore } = useCollection({ limit: 24 });

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      {items === null && total === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : (
          <>
            <ItemGrid items={items} empty="No items yet — add some from your Wix dashboard." />
            {hasMore && (
              <div style={{ textAlign: "center", marginTop: "calc(var(--space) * 1.5)" }}>
                <button onClick={loadMore} style={{
                  padding: "10px 24px", cursor: "pointer",
                  background: "var(--color-primary)", color: "var(--color-on-primary)",
                  border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
                }}>Load more</button>
              </div>
            )}
          </>
        )}
    </main>
  );
}
