// Events listing page — category menu + grid + empty state + load more. Thin view over
// useEventsList (all logic lives in the hook). Token-styled; re-skin via theme.css.
import { useEventsList } from "@/hooks/useEventsList";
import CategoryFilter from "@/components/CategoryFilter";
import EventGrid from "@/components/EventGrid";

export default function Events() {
  const { events, categories, active, setActive, total, loading, hasMore, loadMore } = useEventsList();

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Events</h1>

      {total === 0 ? (
        <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>
          No events published yet — add and publish events from your Wix dashboard.
        </p>
      ) : (
        <>
          <CategoryFilter categories={categories} active={active} onSelect={setActive} />
          {loading
            ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
            : <EventGrid events={events} empty="No events in this category yet." />}
          {hasMore && (
            <div style={{ textAlign: "center", marginTop: "calc(var(--space) * 1.5)" }}>
              <button onClick={loadMore} style={{
                padding: "10px 24px", cursor: "pointer", fontSize: 15, fontWeight: 600,
                background: "var(--color-surface)", color: "var(--color-text)",
                border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
              }}>Load more</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
