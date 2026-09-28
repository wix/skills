// Product detail as a framework-free store — the logic behind useProductDetail, usable from React
// (useProductDetail wraps it), from a static page's PDP and quick-add picker, from Vue/Svelte, or as
// the specification for a port. Option selection → variant resolution → add-to-cart, plus modifier
// inputs. This is where the "adds variants[0] regardless of the buyer's choice" class of bugs comes
// from — always drive a purchase surface through this store, never resolve variants by hand.
//
// Selections start EMPTY (a buyer who never noticed a pre-picked default buys the wrong colour).
// Pass the server-fetched ProductDetail as `initial` (SSR) or a `slug` (the store fetches on start).
// One store per product surface: createProductDetailStore(), not a singleton.
import { fetchProductBySlug, resolveVariant } from "./catalog";
import { addLine } from "./cart-store";
import type { ProductDetail, ProductOption, ProductVariant } from "./types";

export interface ProductDetailStoreOptions {
  initial?: ProductDetail | null;
  slug?: string;
}

export interface OptionGroupView extends ProductOption {
  choices: (ProductOption["choices"][number] & { selected: boolean })[];
}

export interface ProductDetailState {
  /** null while loading (or when the slug doesn't resolve — check notFound). */
  product: ProductDetail | null;
  notFound: boolean;
  /** Option groups with per-choice `selected`, ready to render as pills/swatches. */
  optionGroups: OptionGroupView[];
  /** Modifier inputs keyed by modifier key. */
  modifierValues: Record<string, string>;
  /** The resolved variant; null while the selection is incomplete. */
  variant: ProductVariant | null;
  /** The RANGE ("€24.99 – €34.99", one value when equal) until every option is picked, then the variant's price. */
  price: string;
  /** Struck "was" price — only once a variant is resolved (or for a single-price product), never beside a range. */
  compareAtPrice: string | null;
  /** The resolved variant is out of stock but pre-orderable — label the action "Pre-order". */
  isPreorder: boolean;
  /** False until every option is selected and the resolved variant is in stock or pre-orderable. */
  canAdd: boolean;
  /** Why the action is disabled — neutral guidance ("Choose Size"), not an error; null when addable. */
  blockedReason: string | null;
  quantity: number;
  adding: boolean;
  error: string | null;
}

export interface ProductDetailStore {
  getState(): ProductDetailState;
  subscribe(listener: () => void): () => void;
  /** Fetch by slug when no `initial` was given. Call once when mounted. */
  start(): void;
  stop(): void;
  selectOption(optionName: string, choiceName: string): void;
  setModifier(key: string, value: string): void;
  setQuantity(n: number): void;
  /** Adds the resolved variant to the cart (the cart store opens the drawer). Throws on refusal. */
  add(): Promise<void>;
}

export function createProductDetailStore({ initial, slug }: ProductDetailStoreOptions): ProductDetailStore {
  let product: ProductDetail | null = initial ?? null;
  let notFound = false;
  let selections: Record<string, string> = {};
  let modifierValues: Record<string, string> = {};
  let quantity = 1;
  let adding = false;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: ProductDetailState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  function getState(): ProductDetailState {
    if (snapshot) return snapshot;
    const variant = product ? resolveVariant(product, selections) : null;
    const optionGroups: OptionGroupView[] = (product?.options ?? []).map((o) => ({
      ...o,
      choices: o.choices.map((c) => ({ ...c, selected: selections[o.name] === c.name })),
    }));
    const missingModifier = (product?.modifiers ?? []).find((m) => m.mandatory && (modifierValues[m.key] ?? "").length === 0);
    const missingOptions = (product?.options ?? []).filter((o) => !selections[o.name]).map((o) => o.name);
    const selectionComplete = missingOptions.length === 0;
    // In stock OR pre-orderable counts as buyable; a preorder add carries preOrderRequested.
    const isPreorder = !!variant && !variant.inStock && variant.preorderEnabled;
    const available = !!variant && (variant.inStock || variant.preorderEnabled);
    const canAdd = !!product && available && !missingModifier;
    const blockedReason: string | null = !product
      ? null
      : !selectionComplete ? `Choose ${missingOptions.join(" and ")}`
      : !variant ? "This combination isn't available"
      : !available ? "Out of stock"
      : missingModifier ? `Add ${missingModifier.name}`
      : null;
    // Before every option is picked, the range — never an empty price, never a lone struck minimum.
    const isRange = !!product && product.price !== product.maxPrice && !!product.maxPrice;
    const rangeDisplay = product ? (isRange ? `${product.price} – ${product.maxPrice}` : product.price) : "";
    snapshot = {
      product, notFound, optionGroups, modifierValues, variant,
      price: variant?.price || rangeDisplay,
      compareAtPrice: variant ? variant.compareAtPrice : isRange ? null : (product?.compareAtPrice ?? null),
      isPreorder, canAdd, blockedReason, quantity, adding, error,
    };
    return snapshot;
  }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (initial || !slug) return;
      fetchProductBySlug(slug)
        .then((p) => { if (!started) return; product = p; notFound = p === null; emit(); })
        .catch(() => { if (started) { notFound = true; emit(); } });
    },
    stop() { started = false; },
    selectOption(optionName, choiceName) {
      selections = { ...selections, [optionName]: choiceName };
      quantity = 1; // the ceiling belongs to the newly resolved variant
      emit();
    },
    setModifier(key, value) { modifierValues = { ...modifierValues, [key]: value }; emit(); },
    setQuantity(n) { quantity = n; emit(); },
    async add() {
      const s = getState();
      if (!product || !s.variant) return;
      adding = true; error = null; emit();
      try {
        const choiceModifiers: Record<string, string> = {};
        const textModifiers: Record<string, string> = {};
        for (const m of product.modifiers) {
          const value = modifierValues[m.key];
          if (!value) continue;
          if (m.type === "text") textModifiers[m.key] = value; else choiceModifiers[m.key] = value;
        }
        await addLine(product.id, s.variant.variantId, quantity, { modifierChoices: choiceModifiers, customTextFields: textModifiers, preorder: s.isPreorder });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        adding = false; emit();
      }
    },
  };
}
