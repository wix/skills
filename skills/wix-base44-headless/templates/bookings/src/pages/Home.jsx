// Home — brand hero (rewrite copy/imagery per brand) + a strip of the first services.
import { Link } from "react-router-dom";
import { useServices } from "@/hooks/useServices";
import ServiceGrid from "@/components/ServiceGrid";

export default function Home() {
  const { services, loading } = useServices({ limit: 6 });
  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      {/* HERO — rewrite this copy/imagery to the brand */}
      <section style={{
        padding: "calc(var(--space) * 3) var(--space)", textAlign: "center",
        background: "var(--color-surface)", borderRadius: "var(--radius)", marginBottom: "calc(var(--space) * 2)",
      }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 40, margin: "0 0 12px" }}>Book with us</h1>
        <p style={{ color: "var(--color-muted)", maxWidth: 560, margin: "0 auto 20px" }}>
          A short brand tagline goes here — describe the services on offer.
        </p>
        <Link to="/services" style={{
          display: "inline-block", padding: "12px 24px", textDecoration: "none",
          background: "var(--color-primary)", color: "var(--color-on-primary)",
          borderRadius: "var(--radius-sm)", fontWeight: 600,
        }}>See services</Link>
      </section>

      <h2 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Our services</h2>
      {loading
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <ServiceGrid services={services} empty="Services will appear here once your Bookings setup is done." />}
    </main>
  );
}
