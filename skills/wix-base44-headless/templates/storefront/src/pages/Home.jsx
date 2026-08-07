// Home — brand hero + a "featured" strip of the first products. The hero copy/imagery is the
// app-specific part to rewrite per brand; the product strip and layout come from the template.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { queryProducts } from "@/rest/wix-store-catalog";
import ProductGrid from "@/components/ProductGrid";

export default function Home() {
  const [products, setProducts] = useState(null);

  useEffect(() => { queryProducts({ limit: 8 }).then((r) => setProducts(r.products)); }, []);

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      {/* HERO — rewrite this copy/imagery to the brand */}
      <section style={{
        padding: "calc(var(--space) * 3) var(--space)", textAlign: "center",
        background: "var(--color-surface)", borderRadius: "var(--radius)", marginBottom: "calc(var(--space) * 2)",
      }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 40, margin: "0 0 12px" }}>Welcome</h1>
        <p style={{ color: "var(--color-muted)", maxWidth: 560, margin: "0 auto 20px" }}>
          A short brand tagline goes here — describe what the shop sells.
        </p>
        <Link to="/shop" style={{
          display: "inline-block", padding: "12px 24px", textDecoration: "none",
          background: "var(--color-primary)", color: "var(--color-on-primary)",
          borderRadius: "var(--radius-sm)", fontWeight: 600,
        }}>Shop now</Link>
      </section>

      <h2 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Featured</h2>
      {products === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <ProductGrid products={products} empty="Products will appear here once your catalog is set up." />}
    </main>
  );
}
