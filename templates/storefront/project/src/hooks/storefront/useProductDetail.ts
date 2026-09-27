// React binding of the product-detail store (wix/storefront/product-detail-store.ts) — option
// selection → variant resolution → add-to-cart lives there, framework-free. Always drive a PDP or
// quick-add picker through this hook (or the store): resolving variants by hand is where
// "added variants[0] regardless of the buyer's choice" comes from.
//
// SSR-friendly: pass the server-fetched ProductDetail as `initial` (Astro/Next); in a SPA pass
// the slug and it fetches on mount.
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createProductDetailStore,
  type ProductDetailState,
  type ProductDetailStore,
  type ProductDetailStoreOptions,
} from "../../wix/storefront/product-detail-store";

export { type OptionGroupView } from "../../wix/storefront/product-detail-store";

export type UseProductDetailOptions = ProductDetailStoreOptions;

export type UseProductDetail = ProductDetailState &
  Pick<ProductDetailStore, "selectOption" | "setModifier" | "setQuantity" | "add">;

export function useProductDetail({ initial, slug }: UseProductDetailOptions): UseProductDetail {
  const ref = useRef<{ slug?: string; store: ProductDetailStore } | null>(null);
  if (!ref.current || ref.current.slug !== slug) ref.current = { slug, store: createProductDetailStore({ initial, slug }) };
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    selectOption: store.selectOption,
    setModifier: store.setModifier,
    setQuantity: store.setQuantity,
    add: store.add,
  };
}
