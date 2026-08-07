// Services / listing page — lists visitor-visible services, empty state when none exist. Thin view
// over useServices (all data lives in the hook). Token-styled; re-skin via theme.css.
import { useServices } from "@/hooks/useServices";
import ServiceGrid from "@/components/ServiceGrid";

export default function Services() {
  const { services, total, nextOffset, loadMore } = useServices({ limit: 24 });

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Services</h1>
      {services === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <>
            <ServiceGrid services={services} empty="No services yet — add one from your Wix dashboard." />
            {total > 0 && nextOffset != null && (
              <div style={{ textAlign: "center", marginTop: "calc(var(--space) * 1.5)" }}>
                <button onClick={loadMore} style={{
                  padding: "10px 20px", cursor: "pointer",
                  background: "var(--color-surface)", color: "var(--color-text)",
                  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
                }}>Load more</button>
              </div>
            )}
          </>}
    </main>
  );
}
