// Responsive collections grid + empty state. Token-styled; re-skin via theme.css.
import CollectionCard from "./CollectionCard";

export default function CollectionGrid({ collections, empty = "No collections yet." }) {
  if (!collections?.length) {
    return (
      <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>
    );
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: "var(--space)",
    }}>
      {collections.map((c) => <CollectionCard key={c.id} collection={c} />)}
    </div>
  );
}
