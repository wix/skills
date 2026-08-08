// Responsive collections grid + empty state. Styled with base44 design tokens (shadcn Tailwind classes).
import CollectionCard from "./CollectionCard";

export default function CollectionGrid({ collections, empty = "No collections yet." }) {
  if (!collections?.length) {
    return (
      <p className="text-muted-foreground p-4 text-center">{empty}</p>
    );
  }
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
      {collections.map((c) => <CollectionCard key={c.id} collection={c} />)}
    </div>
  );
}
