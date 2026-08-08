// Shop / catalog page — lists visible products, empty state when the catalog is empty.
import { useEffect, useState } from "react";
import { queryProducts } from "@/rest/wix-store-catalog";
import ProductGrid from "@/components/ProductGrid";

export default function Shop() {
  const [products, setProducts] = useState(null);

  useEffect(() => { queryProducts({ limit: 100 }).then((r) => setProducts(r.products)); }, []);

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <h1 className="font-display mb-4">Shop</h1>
      {products === null
        ? <p className="text-muted-foreground">Loading…</p>
        : <ProductGrid products={products} empty="No products yet — add some from your Wix dashboard." />}
    </main>
  );
}
