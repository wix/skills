// Services / listing page — lists visitor-visible services, empty state when none exist. Thin view
// over useServices (all data lives in the hook). Styled with base44 design tokens (shadcn Tailwind classes).
import { useServices } from "@/hooks/useServices";
import ServiceGrid from "@/components/ServiceGrid";

export default function Services() {
  const { services, total, nextOffset, loadMore } = useServices({ limit: 24 });

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <h1 className="font-display mb-4">Services</h1>
      {services === null
        ? <p className="text-muted-foreground">Loading…</p>
        : <>
            <ServiceGrid services={services} empty="No services yet — add one from your Wix dashboard." />
            {total > 0 && nextOffset != null && (
              <div className="text-center mt-6">
                <button onClick={loadMore}
                  className="px-5 py-2.5 cursor-pointer bg-card text-foreground border border-border rounded-sm">
                  Load more
                </button>
              </div>
            )}
          </>}
    </main>
  );
}
