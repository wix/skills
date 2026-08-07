// Shop / catalog page — lists visible products, empty state when the catalog is empty.
import { useEffect, useState } from "react";
import { queryProducts } from "@/rest/wix-store-catalog";
import ProductGrid from "@/components/ProductGrid";

export default function Shop() {
  const [products, setProducts] = useState(null);

  useEffect(() => { queryProducts({ limit: 100 }).then((r) => setProducts(r.products)); }, []);

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Shop</h1>
      {products === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <ProductGrid products={products} empty="No products yet — add some from your Wix dashboard." />}
    </main>
  );
}
