// Responsive grid of ItemCards + empty state. Token-styled; re-skin via theme.css. Keyed on the
// item's `_id` (always present on a CMS item).
import ItemCard from "./ItemCard";

export default function ItemGrid({ items, empty = "No items yet." }) {
  if (!items?.length) {
    return (
      <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>
    );
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
      gap: "var(--space)",
    }}>
      {items.map((item) => <ItemCard key={item._id} item={item} />)}
    </div>
  );
}
