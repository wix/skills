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
  /**
   * Price to display right now: the product RANGE ("€24.99 – €34.99", one value when equal) until
   * every option is picked, then the selected variant's price (an automatic discount applied).
   */
  price: string;
  /** Struck "was" price — only once a variant is resolved (or for a single-price product), never beside a range. */
  compareAtPrice: string | null;
  /** The resolved variant is out of stock but pre-orderable — label the action "Pre-order". */
  isPreorder: boolean;
  /** False until every option is selected and the resolved variant is in stock or pre-orderable. */
  canAdd: boolean;
  /**
   * Why the action is disabled — neutral guidance to render beside it ("Choose Size"), not an
   * error; null when the buyer can add. Promote to error styling only after they try to buy.
   */
  blockedReason: string | null;
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

  const missingModifier = (product?.modifiers ?? []).find(
    (m) => m.mandatory && (modifierValues[m.key] ?? "").length === 0,
  );
  const missingOptions = (product?.options ?? []).filter((o) => !selections[o.name]).map((o) => o.name);
  const selectionComplete = missingOptions.length === 0;

  // In stock OR pre-orderable counts as buyable; a preorder add carries preOrderRequested.
  const isPreorder = !!variant && !variant.inStock && variant.preorderEnabled;
  const available = !!variant && (variant.inStock || variant.preorderEnabled);

  const canAdd = !!product && available && !missingModifier;

  const blockedReason: string | null = !product
    ? null
    : !selectionComplete
      ? `Choose ${missingOptions.join(" and ")}`
      : !variant
        ? "This combination isn't available"
        : !available
          ? "Out of stock"
          : missingModifier
            ? `Add ${missingModifier.name}`
            : null;

  // Before every option is picked, the range — never an empty price, never a lone struck minimum.
  const isRange = !!product && product.price !== product.maxPrice && !!product.maxPrice;
  const rangeDisplay = product ? (isRange ? `${product.price} – ${product.maxPrice}` : product.price) : "";

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
        preorder: isPreorder,
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
    selectOption: (optionName, choiceName) => {
      setSelections((s) => ({ ...s, [optionName]: choiceName }));
      setQuantity(1); // the ceiling belongs to the newly resolved variant
    },
    modifierValues,
    setModifier: (key, value) => setModifierValues((v) => ({ ...v, [key]: value })),
    variant,
    price: variant?.price || rangeDisplay,
    compareAtPrice: variant ? variant.compareAtPrice : isRange ? null : (product?.compareAtPrice ?? null),
    isPreorder,
    canAdd,
    blockedReason,
    quantity,
    setQuantity,
    add,
    adding,
    error,
  };
}
