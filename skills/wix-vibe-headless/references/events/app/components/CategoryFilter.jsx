// Category filter menu for the events listing. Pure UI — the active id + setter come from
// useEventsList. Display field is `label` (NOT `name`); key/filter by `category.id`; the per-category
// count is `counts.assignedEventsCount`. Token-styled; re-skin via theme.css.

const chipBase = {
  padding: "6px 14px", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-body)",
  border: "1px solid var(--color-border)", borderRadius: 999,
  background: "var(--color-surface)", color: "var(--color-text)",
};
const chipActive = { background: "var(--color-primary)", color: "var(--color-on-primary)", borderColor: "var(--color-primary)" };

export default function CategoryFilter({ categories, active, onSelect }) {
  if (!categories?.length) return null;
  return (
    <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "var(--space)" }}>
      <button onClick={() => onSelect(null)} aria-pressed={active === null}
        style={{ ...chipBase, ...(active === null ? chipActive : null) }}>All</button>
      {categories.map((c) => (
        <button key={c.id} onClick={() => onSelect(c.id)} aria-pressed={active === c.id}
          style={{ ...chipBase, ...(active === c.id ? chipActive : null) }}>
          {c.label} ({c.counts?.assignedEventsCount ?? 0})
        </button>
      ))}
    </nav>
  );
}
