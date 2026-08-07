// Portfolio page — collections gallery (grid + empty state + paging). Thin view over
// usePortfolioGallery (all data logic lives in the hook). Token-styled; re-skin via theme.css.
import { usePortfolioGallery } from "@/hooks/usePortfolioGallery";
import CollectionGrid from "@/components/CollectionGrid";

export default function Portfolio() {
  const { collections, total, cursor, loadMore } = usePortfolioGallery({ limit: 24 });

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Work</h1>
      {collections === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <CollectionGrid
            collections={collections}
            empty={total === 0 ? "No collections yet — add them from your Wix dashboard." : "No collections to show."} />}
      {cursor && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "calc(var(--space) * 1.5)" }}>
          <button onClick={loadMore} style={buttonStyle}>Load more</button>
        </div>
      )}
    </main>
  );
}

const buttonStyle = {
  padding: "10px 24px", cursor: "pointer",
  background: "var(--color-primary)", color: "var(--color-on-primary)",
  border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
};
