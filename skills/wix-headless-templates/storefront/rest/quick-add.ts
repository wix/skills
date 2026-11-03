// DOM renderer for a product tile's purchase control, driven by cart-store and, when a picker
// opens, product-detail-store. The path is decided from the ProductSummary:
// - out of stock and not pre-orderable: a link to the product page reading "Out of stock"
// - subscription plans: a link to the product page reading "Choose a plan"
// - `quickAddable`: one button that adds the cheapest variant, quantity 1
// - otherwise: a button that opens a picker panel; the panel loads the product by slug and
//   renders the option picker (option-picker.js), or a link to the product page when the product
//   has a free-text modifier or plans
// The picker panel follows the overlay contract: Escape and the backdrop close it, focus moves in
// and back, the page scroll is locked while it is open.
//
// No styles. Class names use one prefix (default "quickadd"): quickadd, quickadd-button,
// quickadd-link, quickadd-error, quickadd-backdrop, quickadd-panel, quickadd-panel-header,
// quickadd-panel-name, quickadd-panel-price, quickadd-panel-compare, quickadd-panel-unit,
// quickadd-panel-close, quickadd-panel-loading, quickadd-panel-notfound, quickadd-panel-pdp,
// quickadd-panel-picker. The root carries `data-state`: "idle" | "adding" | "open"; the panel's
// picker uses the option picker's own classes.
//
// To style: the backdrop and the panel are appended to `panelContainer` (default `root`, the
// tile) as siblings, with no position. Give `quickadd-backdrop` `position: fixed; inset: 0` and
// `quickadd-panel` a position (fixed, or absolute inside a tile that has `position: relative`),
// a width, a background and `overflow: auto`. `quickadd-button[disabled]` with `aria-busy="true"`
// is the button while adding. The two links share `quickadd-link`, with `quickadd-link--sold-out`
// and `quickadd-link--plan` for the case.
import { addLine, getCartState, subscribeCart } from "../app/wix/storefront/cart-store.js";
import { createProductDetailStore, type ProductDetailStore } from "../app/wix/storefront/product-detail-store.js";
import type { ProductSummary } from "../app/wix/storefront/types.js";
import { renderOptionPicker, type OptionPicker, type OptionPickerText } from "./option-picker.js";

/** Hides or shows an element. Sets `display` as well as `hidden`, because an author `display` rule overrides the attribute. */
const hide = (node: HTMLElement, on: boolean): void => { node.hidden = on; node.style.display = on ? "none" : ""; };


/** UI strings. */
export interface QuickAddText {
  add: string;
  preorder: string;
  adding: string;
  outOfStock: string;
  choosePlan: string;
  chooseOptions: string;
  close: string;
  loading: string;
  notFound: string;
  customize: string;
  dialogLabel: string;
}

const TEXT: QuickAddText = {
  add: "Add to cart",
  preorder: "Pre-order",
  adding: "Adding…",
  outOfStock: "Out of stock",
  choosePlan: "Choose a plan",
  chooseOptions: "Choose options",
  close: "Close",
  loading: "Loading options…",
  notFound: "This product isn't available anymore.",
  customize: "Customize on the product page",
  dialogLabel: "Choose options for {name}",
};

export interface QuickAddOptions {
  /** The first part of every class name (default "quickadd"). */
  classPrefix?: string;
  text?: Partial<QuickAddText>;
  /** Strings for the option picker inside the panel. */
  pickerText?: Partial<OptionPickerText>;
  /** The product page for a slug (default `/product.html?slug=<slug>`). */
  productUrl?: (slug: string) => string;
  /** Where the picker panel is appended (default: `root`, so the panel anchors to the tile). */
  panelContainer?: HTMLElement;
}

export interface QuickAdd {
  destroy(): void;
}

const defaultProductUrl = (slug: string): string => `/product.html?slug=${encodeURIComponent(slug)}`;

/**
 * Renders the purchase control for `product` into `root`, replacing its content. Place `root`
 * outside the tile's link, as the last row of the tile.
 */
export function renderQuickAdd(root: HTMLElement, product: ProductSummary, options: QuickAddOptions = {}): QuickAdd {
  const { classPrefix = "quickadd", text: words, pickerText, productUrl = defaultProductUrl, panelContainer } = options;
  const t: QuickAddText = { ...TEXT, ...words };
  const c = (name: string): string => (name ? `${classPrefix}-${name}` : classPrefix);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string | undefined> = {}, textContent?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
    if ("hidden" in attrs && attrs.hidden !== undefined) node.style.display = "none";
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  };

  root.replaceChildren();
  const box = el("div", c(""), { "data-state": "idle" });
  root.append(box);
  // A tile is often one link: a click on the control must not navigate.
  box.addEventListener("click", (e) => { e.stopPropagation(); if (!(e.target instanceof HTMLAnchorElement)) e.preventDefault(); });

  let unsubscribe: (() => void) | null = null;
  let closePanel: (() => void) | null = null;

  if (product.availability === "OUT_OF_STOCK" && !product.preorder) {
    box.append(el("a", `${c("link")} ${c("link--sold-out")}`, { href: productUrl(product.slug) }, t.outOfStock));
  } else if (product.hasSubscriptions) {
    box.append(el("a", `${c("link")} ${c("link--plan")}`, { href: productUrl(product.slug) }, t.choosePlan));
  } else if (product.quickAddable) {
    const button = el("button", c("button"), { type: "button" }, product.preorder ? t.preorder : t.add);
    const error = el("p", c("error"), { role: "alert", hidden: "" });
    button.addEventListener("click", () => {
      hide(error, true);
      void addLine(product.id, product.minPriceVariantId, 1).catch((e: unknown) => { error.textContent = e instanceof Error ? e.message : String(e); hide(error, false); });
    });
    box.append(button, error);
    const render = (): void => {
      const adding = getCartState().pendingProductId === product.id;
      button.disabled = adding;
      button.setAttribute("aria-busy", String(adding));
      button.textContent = adding ? t.adding : product.preorder ? t.preorder : t.add;
      box.dataset.state = adding ? "adding" : "idle";
    };
    unsubscribe = subscribeCart(render);
    render();
  } else {
    const button = el("button", c("button"), { type: "button" }, product.optionsSummary ? t.chooseOptions : product.preorder ? t.preorder : t.add);
    button.addEventListener("click", () => openPanel());
    box.append(button);
  }

  function openPanel(): void {
    if (closePanel) return;
    const host = panelContainer ?? root;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const backdrop = el("div", c("backdrop"));
    const panel = el("section", c("panel"), { role: "dialog", "aria-modal": "true", tabindex: "-1", "aria-label": t.dialogLabel.replace("{name}", product.name) });
    const header = el("div", c("panel-header"));
    const titles = el("div", c("panel-titles"));
    const name = el("p", c("panel-name"), {}, product.name);
    const price = el("p", c("panel-price"));
    const compare = el("span", c("panel-compare"), { hidden: "" });
    const unit = el("span", c("panel-unit"), { hidden: "" });
    titles.append(name, price);
    const close = el("button", c("panel-close"), { type: "button", "aria-label": t.close }, "×");
    header.append(titles, close);
    const status = el("p", c("panel-loading"), {}, t.loading);
    const pdp = el("a", c("panel-pdp"), { href: productUrl(product.slug), hidden: "" }, t.customize);
    const pickerRoot = el("div", c("panel-picker"));
    panel.append(header, status, pdp, pickerRoot);
    host.append(backdrop, panel);
    document.body.style.overflow = "hidden";
    box.dataset.state = "open";

    const store: ProductDetailStore = createProductDetailStore({ slug: product.slug });
    let picker: OptionPicker | null = null;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") closePanel?.(); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", () => closePanel?.());
    close.addEventListener("click", () => closePanel?.());

    const render = (): void => {
      const s = store.getState();
      const priceText = el("span", c("panel-amount"), {}, s.price);
      price.replaceChildren(priceText);
      if (s.compareAtPrice) { compare.textContent = s.compareAtPrice; hide(compare, false); price.append(" ", compare); }
      if (s.pricePerUnit) { unit.textContent = s.pricePerUnit; hide(unit, false); price.append(" ", unit); }
      if (!s.product) {
        hide(status, false);
        status.className = c(s.notFound ? "panel-notfound" : "panel-loading");
        status.textContent = s.notFound ? t.notFound : t.loading;
        return;
      }
      hide(status, true);
      // Free text and plans belong on the product page.
      const needsPdp = s.product.modifiers.some((m) => m.type === "text") || s.product.subscriptions.length > 0;
      hide(pdp, !needsPdp);
      if (!needsPdp && !picker) picker = renderOptionPicker(pickerRoot, store, { text: pickerText, onAdded: () => closePanel?.() });
    };
    const unsub = store.subscribe(render);
    render();
    store.start();
    panel.focus();

    closePanel = () => {
      unsub();
      picker?.destroy();
      store.stop();
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      backdrop.remove();
      panel.remove();
      box.dataset.state = "idle";
      closePanel = null;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }

  return {
    destroy() {
      closePanel?.();
      unsubscribe?.();
      root.replaceChildren();
    },
  };
}
