// Product detail as a framework-free store — the logic behind useProductDetail, usable from React
// (useProductDetail wraps it), from a static page's PDP and quick-add picker, from Vue/Svelte, or as
// the specification for a port. Option selection → variant resolution → add-to-cart, plus modifier
// inputs, the plan picker for a subscription product, the live inventory (stock left, purchase
// cap, pre-order message) and "notify me" for a sold-out item. This is where the "adds variants[0]
// regardless of the buyer's choice" class of bugs comes from — always drive a purchase surface
// through this store, never resolve variants by hand.
//
// Selections start EMPTY (a buyer who never noticed a pre-picked default buys the wrong colour).
// Pass the server-fetched ProductDetail as `initial` (SSR) or a `slug` (the store fetches on start).
// One store per product surface: createProductDetailStore(), not a singleton.
import { fetchBackInStockEnabled, fetchInventory, fetchProductBySlug, requestBackInStock, resolveVariant } from "./catalog";
import { choiceAvailability, maxPurchasable, mergeInventory } from "./catalog-core";
import { addLine } from "./cart-store";
import type { OptionChoice, ProductDetail, ProductOption, ProductVariant, SubscriptionPlan } from "./types";

export interface ProductDetailStoreOptions {
  initial?: ProductDetail | null;
  slug?: string;
}

/** The buyer's choice for "buy once" on a product that also sells plans. */
export const ONE_TIME_PLAN = "one-time";

export interface OptionGroupView extends ProductOption {
  /** Each choice judged against the OTHER selections: `inStock` = buyable with them, `exists` = some variant has that combination. */
  choices: (OptionChoice & { selected: boolean; exists: boolean })[];
}

export interface PlanView extends SubscriptionPlan {
  /** This variant's price on the plan, formatted; "" until every option is picked. */
  price: string;
  selected: boolean;
}

export interface ProductDetailState {
  /** null while loading (or when the slug doesn't resolve — check notFound). */
  product: ProductDetail | null;
  notFound: boolean;
  /** Option groups with per-choice `selected` / `inStock` / `exists`, ready to render as pills/swatches. */
  optionGroups: OptionGroupView[];
  /** Modifier inputs keyed by modifier key. */
  modifierValues: Record<string, string>;
  /** The resolved variant; null while the selection is incomplete. */
  variant: ProductVariant | null;
  /**
   * The image for the current selection: the last-picked choice's own image, else any picked
   * choice's, else the resolved variant's; null when none is linked (keep showing the gallery).
   * Render it as the main image so a colour pick changes the photo, as on Wix's own product page.
   */
  imageUrl: string | null;
  /** The RANGE ("€24.99 – €34.99"; "From €24.99" on a discounted range) until every option is picked, then the variant's price — or its price on the selected plan. */
  price: string;
  /** Struck "was" price — only once a variant is resolved (or for a single-price product), never beside a range or a plan price. */
  compareAtPrice: string | null;
  /** Price per unit ("€2.50 / 100 g") of the resolved variant, else the cheapest; null when not sold by unit. */
  pricePerUnit: string | null;
  /** The plans to pick from (plus "one-time" when the merchant allows it — render that from `product.allowOneTimePurchase`); [] for a one-time product. */
  plans: PlanView[];
  /** The picked plan id, ONE_TIME_PLAN, or null (nothing picked yet). */
  subscriptionPlanId: string | null;
  /** The resolved variant is out of stock but pre-orderable — label the action "Pre-order". */
  isPreorder: boolean;
  /** The merchant's pre-order note for the resolved variant ("Ships in 3 weeks"); null when none. */
  preorderMessage: string | null;
  /** Units left of the resolved variant when stock is counted; null when uncounted or unknown. Show "Only N left" when small. */
  remaining: number | null;
  /** The stepper's ceiling: the remaining units when counted, else Wix's 99999 cap. */
  maxQuantity: number;
  /** False until every option is selected and the resolved variant is in stock or pre-orderable (and a plan is picked when plans exist). */
  canAdd: boolean;
  /** Why the action is disabled — neutral guidance ("Choose Size"), not an error; null when addable. */
  blockedReason: string | null;
  quantity: number;
  adding: boolean;
  error: string | null;
  /** The item is sold out (not pre-orderable) and the merchant collects back-in-stock requests — offer an email field. */
  canNotify: boolean;
  notifying: boolean;
  /** The outcome of the last notify(): "created", "already-subscribed", or null. */
  notifyResult: "created" | "already-subscribed" | null;
  notifyError: string | null;
}

export interface ProductDetailStore {
  getState(): ProductDetailState;
  subscribe(listener: () => void): () => void;
  /** Fetch by slug when no `initial` was given; load the live inventory. Call once when mounted. */
  start(): void;
  stop(): void;
  selectOption(optionId: string, choiceId: string): void;
  setModifier(key: string, value: string): void;
  /** Clamped to [1, maxQuantity]. */
  setQuantity(n: number): void;
  /** Pick a plan by id, or ONE_TIME_PLAN. */
  selectPlan(planId: string): void;
  /** Adds the resolved variant to the cart (the cart store opens the drawer). Throws on refusal. */
  add(): Promise<void>;
  /** Ask to be emailed when the sold-out variant is back. Resolves with the outcome; records notifyError on failure. */
  notify(email: string): Promise<"created" | "already-subscribed">;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createProductDetailStore({ initial, slug }: ProductDetailStoreOptions): ProductDetailStore {
  let product: ProductDetail | null = initial ?? null;
  let notFound = false;
  let selections: Record<string, string> = {}; // optionId -> choiceId
  let lastPicked: string | null = null; // the option picked most recently — its choice's image wins
  let modifierValues: Record<string, string> = {};
  let subscriptionPlanId: string | null = null;
  let quantity = 1;
  let adding = false;
  let error: string | null = null;
  let notifyEnabled = false;
  let notifying = false;
  let notifyResult: ProductDetailState["notifyResult"] = null;
  let notifyError: string | null = null;
  let started = false;
  let enriched: string | null = null; // product id whose inventory was loaded
  const listeners = new Set<() => void>();
  let snapshot: ProductDetailState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  function getState(): ProductDetailState {
    if (snapshot) return snapshot;
    const variant = product ? resolveVariant(product, selections) : null;
    const availability = product ? choiceAvailability(product, selections) : {};
    const optionGroups: OptionGroupView[] = (product?.options ?? []).map((o) => ({
      ...o,
      choices: o.choices.map((c) => {
        const a = availability[o.id]?.[c.choiceId];
        return { ...c, selected: selections[o.id] === c.choiceId, inStock: a ? a.inStock : c.inStock, exists: a ? a.exists : true };
      }),
    }));
    const pickedImage = (optionId: string): string | null => {
      const o = product?.options.find((x) => x.id === optionId);
      return o?.choices.find((c) => c.choiceId === selections[optionId])?.imageUrl ?? null;
    };
    const pickedImages = (product?.options ?? []).map((o) => pickedImage(o.id)).filter((u): u is string => !!u);
    const imageUrl = (lastPicked ? pickedImage(lastPicked) : null) ?? pickedImages[pickedImages.length - 1] ?? variant?.imageUrl ?? null;
    const missingOptions = (product?.options ?? []).filter((o) => !selections[o.id]).map((o) => o.name);
    const selectionComplete = missingOptions.length === 0;
    const missingModifier = (product?.modifiers ?? []).find((m) => m.mandatory && (modifierValues[m.key] ?? "").trim().length === 0);
    const shortText = (product?.modifiers ?? []).find((m) => m.type === "text" && m.minChars && (modifierValues[m.key] ?? "").length > 0 && (modifierValues[m.key] ?? "").length < m.minChars);
    const plans = product?.subscriptions ?? [];
    const plan = subscriptionPlanId && subscriptionPlanId !== ONE_TIME_PLAN ? plans.find((p) => p.id === subscriptionPlanId) ?? null : null;
    const planMissing = plans.length > 0 && (!subscriptionPlanId || (subscriptionPlanId === ONE_TIME_PLAN && !product?.allowOneTimePurchase) || (subscriptionPlanId !== ONE_TIME_PLAN && !plan));
    // In stock OR pre-orderable counts as buyable; a preorder add carries preOrderRequested.
    const isPreorder = !!variant && !variant.inStock && variant.preorderEnabled;
    const available = !!variant && (variant.inStock || variant.preorderEnabled);
    const canAdd = !!product && available && !missingModifier && !shortText && !planMissing;
    // Wix's own precedence: unavailable > pre-order > sold out > the inputs still needed.
    const blockedReason: string | null = !product
      ? null
      : !selectionComplete ? `Choose ${missingOptions.join(" and ")}`
      : !variant ? "This combination isn't available"
      : !available ? "Out of stock"
      : missingModifier ? `Add ${missingModifier.title || missingModifier.name}`
      : shortText ? `${shortText.title || shortText.name} needs at least ${shortText.minChars} characters`
      : planMissing ? "Choose a plan"
      : null;
    // Before every option is picked, the range — never an empty price, never a lone struck minimum.
    const isRange = !!product && product.price !== product.maxPrice && !!product.maxPrice;
    const rangeDisplay = product ? (product.fromPrice ? `From ${product.price}` : isRange ? `${product.price} – ${product.maxPrice}` : product.price) : "";
    const planPrice = plan && variant ? variant.subscriptionPrices[plan.id] ?? "" : "";
    snapshot = {
      product, notFound, optionGroups, modifierValues, variant, imageUrl,
      price: planPrice || variant?.price || rangeDisplay,
      // a plan price is its own thing — never strike the one-time price beside it
      compareAtPrice: plan ? null : variant ? variant.compareAtPrice : isRange ? null : (product?.compareAtPrice ?? null),
      pricePerUnit: variant?.pricePerUnit ?? product?.pricePerUnit ?? null,
      plans: plans.map((p) => ({ ...p, price: variant?.subscriptionPrices[p.id] ?? "", selected: subscriptionPlanId === p.id })),
      subscriptionPlanId,
      isPreorder,
      preorderMessage: isPreorder ? variant?.preorderMessage ?? null : null,
      remaining: variant?.quantity ?? null,
      maxQuantity: maxPurchasable(variant),
      canAdd, blockedReason, quantity, adding, error,
      canNotify: !!product && !!variant && !available && notifyEnabled,
      notifying, notifyResult, notifyError,
    };
    return snapshot;
  }

  // The live inventory (stock left, pre-order allowance and message) refines the catalog's flags;
  // "notify me" only shows when the merchant collects requests. Both are non-blocking niceties.
  function enrich(): void {
    if (!product || enriched === product.id) return;
    const id = enriched = product.id;
    fetchInventory(id).then((inv) => {
      if (!started || !product || product.id !== id || !Object.keys(inv).length) return;
      product = { ...product, variants: mergeInventory(product.variants, inv) };
      emit();
    });
    if (product.variants.some((v) => !v.inStock && !v.preorderEnabled) || product.availability !== "IN_STOCK") {
      fetchBackInStockEnabled().then((on) => { if (started && on !== notifyEnabled) { notifyEnabled = on; emit(); } });
    }
  }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (product) { enrich(); return; }
      if (!slug) return;
      fetchProductBySlug(slug)
        .then((p) => { if (!started) return; product = p; notFound = p === null; emit(); enrich(); })
        .catch(() => { if (started) { notFound = true; emit(); } });
    },
    stop() { started = false; },
    selectOption(optionId, choiceId) {
      selections = { ...selections, [optionId]: choiceId };
      lastPicked = optionId;
      quantity = 1; // the ceiling belongs to the newly resolved variant
      notifyResult = null; notifyError = null;
      emit();
    },
    setModifier(key, value) { modifierValues = { ...modifierValues, [key]: value }; emit(); },
    setQuantity(n) {
      const max = getState().maxQuantity;
      quantity = Math.min(Math.max(1, Math.floor(Number(n) || 1)), max);
      emit();
    },
    selectPlan(planId) { subscriptionPlanId = planId; emit(); },
    async add() {
      const s = getState();
      if (!product || !s.variant) return;
      adding = true; error = null; emit();
      try {
        // The variant id AND every option's key/choice-key pair, as Wix's own storefront sends them.
        const optionChoices: Record<string, string> = {};
        for (const o of product.options) {
          const choice = o.choices.find((c) => c.choiceId === s.variant!.choiceIds[o.id]);
          if (o.key && choice?.key) optionChoices[o.key] = choice.key;
        }
        const modifierChoices: Record<string, string> = {};
        const customTextFields: Record<string, string> = {};
        for (const m of product.modifiers) {
          const value = modifierValues[m.key];
          if (!value) continue;
          if (m.type === "text") customTextFields[m.key] = value; else modifierChoices[m.key] = value;
        }
        const plan = subscriptionPlanId && subscriptionPlanId !== ONE_TIME_PLAN ? subscriptionPlanId : undefined;
        await addLine(product.id, s.variant.variantId, quantity, { optionChoices, modifierChoices, customTextFields, preorder: s.isPreorder, subscriptionOptionId: plan });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        adding = false; emit();
      }
    },
    async notify(email) {
      const s = getState();
      if (!product) throw new Error("No product.");
      if (!EMAIL.test(email.trim())) {
        notifyError = "Enter a valid email address.";
        emit();
        throw new Error(notifyError);
      }
      notifying = true; notifyError = null; notifyResult = null; emit();
      try {
        const result = await requestBackInStock(product.id, s.variant?.variantId ?? null, email.trim(), {
          name: product.name,
          price: String(s.variant?.priceAmount ?? product.variants[0]?.priceAmount ?? 0),
          imageUrl: product.imageUrl || undefined,
        });
        notifyResult = result;
        return result;
      } catch (e) {
        notifyError = e instanceof Error && e.message ? e.message : "Couldn't save your request. Please try again.";
        throw e;
      } finally {
        notifying = false; emit();
      }
    },
  };
}
