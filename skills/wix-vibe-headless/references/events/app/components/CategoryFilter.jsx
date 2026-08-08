// Category filter menu for the events listing. Pure UI — the active id + setter come from
// useEventsList. Display field is `name`; key/filter by `category.id`; the per-category
// count is `counts.assignedEventsCount`. Styled with base44 design tokens (shadcn Tailwind classes).

const chipBase = "py-1.5 px-3.5 cursor-pointer text-sm font-body border rounded-full";
const chipIdle = "border-border bg-card text-foreground";
const chipActive = "bg-primary text-primary-foreground border-primary";

export default function CategoryFilter({ categories, active, onSelect }) {
  if (!categories?.length) return null;
  return (
    <nav className="flex flex-wrap gap-2 mb-4">
      <button onClick={() => onSelect(null)} aria-pressed={active === null}
        className={`${chipBase} ${active === null ? chipActive : chipIdle}`}>All</button>
      {categories.map((c) => (
        <button key={c.id} onClick={() => onSelect(c.id)} aria-pressed={active === c.id}
          className={`${chipBase} ${active === c.id ? chipActive : chipIdle}`}>
          {c.name} ({c.counts?.assignedEventsCount ?? 0})
        </button>
      ))}
    </nav>
  );
}
