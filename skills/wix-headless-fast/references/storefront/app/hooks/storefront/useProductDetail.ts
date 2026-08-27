// Product detail state: option selection → variant resolution → add-to-cart, plus modifier
// inputs. This is the logic the turtle-run class of bugs comes from (adding variants[0]
// regardless of the buyer's choice) — always drive a PDP through this hook.
//
// SSR-friendly: pass the server-fetched ProductDetail as `initial` (Astro/Next); in a SPA
// pass the slug and it fetches on mount.
import { useEffect, useMemo, useState } from "react";
import { fetchProductBySlug, resolveVariant } from "../../wix/storefront/catalog";
import type { ProductDetail, ProductOption, ProductVariant } from "../../wix/storefront/types";
import { useCart } from "./useCart";

export interface UseProductDetailOptions {
  initial?: ProductDetail | null;
  slug?: string;
}

export interface OptionGroupView extends ProductOption {
  choices: (ProductOption["choices"][number] & { selected: boolean })[];
}

export interface UseProductDetail {
  /** null while loading (or when the slug doesn't resolve — check notFound). */
  product: ProductDetail | null;
  notFound: boolean;
  /** Option groups with per-choice `selected`, ready to render as pills/swatches. */
  optionGroups: OptionGroupView[];
  selectOption: (optionName: string, choiceName: string) => void;
  /** Modifier inputs keyed by modifier key. */
  modifierValues: Record<string, string>;
  setModifier: (key: string, value: string) => void;
  /** The resolved variant; null while the selection is incomplete. */
  variant: ProductVariant | null;
  /** Price to display right now (variant price once resolved, else the product range). */
  price: string;
  compareAtPrice: string | null;
  /** False until every option is selected (and the resolved variant is in stock). */
  canAdd: boolean;
  quantity: number;
  setQuantity: (n: number) => void;
  /** Adds the resolved variant to the cart (opens the drawer). Throws on refusal. */
  add: () => Promise<void>;
  adding: boolean;
  error: string | null;
}

export function useProductDetail({ initial, slug }: UseProductDetailOptions): UseProductDetail {
  const [product, setProduct] = useState<ProductDetail | null>(initial ?? null);
  const [notFound, setNotFound] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [modifierValues, setModifierValues] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToCart } = useCart();

  useEffect(() => {
    if (initial || !slug) return;
    let alive = true;
    fetchProductBySlug(slug)
      .then((p) => {
        if (!alive) return;
        setProduct(p);
        setNotFound(p === null);
      })
      .catch(() => alive && setNotFound(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const variant = useMemo(
    () => (product ? resolveVariant(product, selections) : null),
    [product, selections],
  );

  const optionGroups: OptionGroupView[] = useMemo(
    () =>
      (product?.options ?? []).map((o) => ({
        ...o,
        choices: o.choices.map((c) => ({ ...c, selected: selections[o.name] === c.name })),
      })),
    [product, selections],
  );

  const mandatoryModifiersFilled = (product?.modifiers ?? [])
    .filter((m) => m.mandatory)
    .every((m) => (modifierValues[m.key] ?? "").length > 0);

  const canAdd =
    !!product &&
    product.availability !== "OUT_OF_STOCK" &&
    variant !== null &&
    variant.inStock &&
    mandatoryModifiersFilled;

  async function add(): Promise<void> {
    if (!product || !variant) return;
    setAdding(true);
    setError(null);
    try {
      const choiceModifiers: Record<string, string> = {};
      const textModifiers: Record<string, string> = {};
      for (const m of product.modifiers) {
        const value = modifierValues[m.key];
        if (!value) continue;
        if (m.type === "text") textModifiers[m.key] = value;
        else choiceModifiers[m.key] = value;
      }
      await addToCart(product.id, variant.variantId, quantity, {
        modifierChoices: choiceModifiers,
        customTextFields: textModifiers,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setAdding(false);
    }
  }

  return {
    product,
    notFound,
    optionGroups,
    selectOption: (optionName, choiceName) =>
      setSelections((s) => ({ ...s, [optionName]: choiceName })),
    modifierValues,
    setModifier: (key, value) => setModifierValues((v) => ({ ...v, [key]: value })),
    variant,
    price: variant?.price || product?.price || "",
    compareAtPrice: variant ? variant.compareAtPrice : (product?.compareAtPrice ?? null),
    canAdd,
    quantity,
    setQuantity,
    add,
    adding,
    error,
  };
}
