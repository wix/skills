// Responsive grid of ItemCards + empty state. Styled with base44 design tokens (shadcn Tailwind classes). Keyed on the
// item's `_id` (always present on a CMS item).
import ItemCard from "./ItemCard";

export default function ItemGrid({ items, empty = "No items yet." }) {
  if (!items?.length) {
    return (
      <p className="text-muted-foreground p-4 text-center">{empty}</p>
    );
  }
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
      {items.map((item) => <ItemCard key={item._id} item={item} />)}
    </div>
  );
}
