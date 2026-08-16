// Events listing page — category menu + grid + empty state + load more. Thin view over
// useEventsList (all logic lives in the hook). Styled with base44 design tokens (shadcn Tailwind classes).
import { useEventsList } from "@/hooks/useEventsList";
import CategoryFilter from "@/components/CategoryFilter";
import EventGrid from "@/components/EventGrid";

export default function Events() {
  const { events, categories, active, setActive, total, loading, hasMore, loadMore } = useEventsList();

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <h1 className="font-display mb-4">Events</h1>

      {total === 0 ? (
        <p className="text-muted-foreground p-4 text-center">
          No events published yet — add and publish events from your Wix dashboard.
        </p>
      ) : (
        <>
          <CategoryFilter categories={categories} active={active} onSelect={setActive} />
          {loading
            ? <p className="text-muted-foreground">Loading…</p>
            : <EventGrid events={events} empty="No events in this category yet." />}
          {hasMore && (
            <div className="text-center mt-6">
              <button onClick={loadMore}
                className="py-2.5 px-6 cursor-pointer text-[15px] font-semibold bg-card text-foreground border border-border rounded-sm">
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
