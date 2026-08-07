// Services / catalog page — lists visitor-visible services, empty state when none exist.
import { useServices } from "@/hooks/useServices";
import ServiceGrid from "@/components/ServiceGrid";

export default function Services() {
  const { services, loading } = useServices({ limit: 100 });
  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Services</h1>
      {loading
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <ServiceGrid services={services} empty="No services yet — add one from your Wix dashboard." />}
    </main>
  );
}
