// DOM renderer for the cart drawer and the header cart button, driven by cart-store (the
// module-scope cart shared by every surface on the page). The cart's contents, the operations and
// the checkout URL live in the store; this file renders its state and calls its actions.
//
// The drawer renders while `state.open`: a backdrop, a dialog with the line list (image, name,
// option lines, subscription terms, the line's availability in buyer words, a quantity stepper
// capped at the stock left, remove, the line price with the struck catalog price when discounted),
// the coupon (applied code with remove, or a code field), a note to the merchant saved on blur,
// the totals from the cart estimate (subtotal, each discount, each fee, each tax unless prices
// include tax, the total), a shipping note, `state.error`, and the checkout button. Opening moves
// focus into the dialog and locks the page scroll; Escape and the backdrop close it; closing
// returns focus to the element that had it.
//
// No styles. Class names use one prefix (default "cart"): cart-button, cart-button-count,
// cart-backdrop, cart-drawer, cart-header, cart-title, cart-close, cart-body, cart-empty,
// cart-lines, cart-line, cart-line-image, cart-line-placeholder, cart-line-info, cart-line-name,
// cart-line-option, cart-line-subscription, cart-line-status, cart-line-controls, cart-stepper,
// cart-stepper-button, cart-stepper-value, cart-line-remove, cart-line-prices, cart-line-price,
// cart-line-compare, cart-extras, cart-coupon, cart-coupon-applied, cart-coupon-code,
// cart-coupon-remove, cart-coupon-form, cart-coupon-input, cart-coupon-apply, cart-coupon-toggle,
// cart-note, cart-note-label, cart-note-input, cart-footer, cart-totals, cart-row,
// cart-row--total, cart-row-label, cart-row-value, cart-shipping-note, cart-error, cart-checkout.
// The drawer root carries `data-state`: "closed" | "open" | "busy".
import {
  applyCartCoupon,
  getCartState,
  goToCheckout,
  removeCartCoupon,
  removeCartLine,
  setCartNote,
  setCartOpen,
  subscribeCart,
  updateLineQuantity,
  type CartState,
} from "../app/wix/storefront/cart-store.js";
import type { CartLine } from "../app/wix/storefront/types.js";

/** Hides or shows an element. Sets `display` as well as `hidden`, because an author `display` rule overrides the attribute. */
const hide = (node: HTMLElement, on: boolean): void => { node.hidden = on; node.style.display = on ? "none" : ""; };


/** UI strings. `{n}` is a placeholder. */
export interface CartDrawerText {
  title: string;
  close: string;
  empty: string;
  decrease: string;
  increase: string;
  remove: string;
  subscription: string;
  partiallyInStock: string;
  partiallyInStockUnknown: string;
  removedFromCatalog: string;
  outOfStock: string;
  unavailable: string;
  couponApplied: string;
  couponRemove: string;
  couponToggle: string;
  couponPlaceholder: string;
  couponApply: string;
  noteLabel: string;
  subtotal: string;
  discount: string;
  fee: string;
  tax: string;
  total: string;
  shippingWithTax: string;
  shippingTaxesAtCheckout: string;
  shippingAtCheckout: string;
  checkout: string;
  checkoutBusy: string;
  buttonLabel: string;
}

const TEXT: CartDrawerText = {
  title: "Cart",
  close: "Close cart",
  empty: "Your cart is empty.",
  decrease: "Decrease quantity",
  increase: "Increase quantity",
  remove: "Remove",
  subscription: "Subscription: ",
  partiallyInStock: "Only {n} available — lower the quantity",
  partiallyInStockUnknown: "Only part of this quantity is available",
  removedFromCatalog: "No longer sold",
  outOfStock: "Out of stock",
  unavailable: "No longer available at this quantity",
  couponApplied: "Code ",
  couponRemove: "Remove",
  couponToggle: "Have a promo code?",
  couponPlaceholder: "Promo code",
  couponApply: "Apply",
  noteLabel: "Note to seller",
  subtotal: "Subtotal",
  discount: "Discount",
  fee: "Fee",
  tax: "Tax",
  total: "Total",
  shippingWithTax: "Prices include tax. Shipping is calculated at checkout.",
  shippingTaxesAtCheckout: "Shipping and taxes are calculated at checkout.",
  shippingAtCheckout: "Shipping is calculated at checkout.",
  checkout: "Continue to secure checkout",
  checkoutBusy: "One moment…",
  buttonLabel: "Cart, {n} items",
};

export interface CartDrawerOptions {
  /** The first part of every class name (default "cart"). */
  classPrefix?: string;
  text?: Partial<CartDrawerText>;
  /** The page for a cart line's product; default: the line's own `productUrl`, or nothing. */
  productUrl?: (line: CartLine) => string;
}

export interface CartDrawer {
  /** Stop listening and remove the drawer from the document. */
  destroy(): void;
}

function statusCopy(line: CartLine, t: CartDrawerText): string {
  switch (line.status) {
    case "IN_STOCK": return "";
    case "PARTIALLY_IN_STOCK": return line.availableQuantity !== null ? t.partiallyInStock.replace("{n}", String(line.availableQuantity)) : t.partiallyInStockUnknown;
    case "REMOVED_FROM_CATALOG": return t.removedFromCatalog;
    case "OUT_OF_STOCK": return t.outOfStock;
    default: return t.unavailable;
  }
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string | undefined> = {}, textContent?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
    if ("hidden" in attrs && attrs.hidden !== undefined) node.style.display = "none";
  if (textContent !== undefined) node.textContent = textContent;
  return node;
};

/**
 * Renders the cart drawer once per page, appended to `container` (default `document.body`), and
 * keeps it in step with the cart store. It is hidden until `setCartOpen(true)` (an add opens it).
 */
export function renderCartDrawer(options: CartDrawerOptions = {}, container: HTMLElement = document.body): CartDrawer {
  const { classPrefix = "cart", text: words, productUrl } = options;
  const t: CartDrawerText = { ...TEXT, ...words };
  const c = (name: string): string => `${classPrefix}-${name}`;
  const el = make;

  const backdrop = el("div", c("backdrop"), { hidden: "", "data-state": "closed" });
  const drawer = el("aside", c("drawer"), { role: "dialog", "aria-modal": "true", "aria-label": t.title, tabindex: "-1" });
  const header = el("div", c("header"));
  const title = el("span", c("title"), {}, t.title);
  const close = el("button", c("close"), { type: "button", "aria-label": t.close }, "×");
  header.append(title, close);
  const body = el("div", c("body"));
  const empty = el("p", c("empty"), { hidden: "" }, t.empty);
  const lines = el("div", c("lines"));
  const extras = el("div", c("extras"), { hidden: "" });
  // Coupon: applied row, code form, toggle. Which one shows depends on state and a local flag.
  const couponApplied = el("div", `${c("coupon")} ${c("coupon-applied")}`, { hidden: "" });
  const couponLabel = el("span", c("coupon-label"));
  const couponRemove = el("button", c("coupon-remove"), { type: "button" }, t.couponRemove);
  couponApplied.append(couponLabel, couponRemove);
  const couponForm = el("form", `${c("coupon")} ${c("coupon-form")}`, { hidden: "", novalidate: "" });
  const couponInput = el("input", c("coupon-input"), { type: "text", placeholder: t.couponPlaceholder, "aria-label": t.couponPlaceholder, autocomplete: "off" });
  const couponApply = el("button", c("coupon-apply"), { type: "submit" }, t.couponApply);
  couponForm.append(couponInput, couponApply);
  const couponToggle = el("button", `${c("coupon")} ${c("coupon-toggle")}`, { type: "button" }, t.couponToggle);
  const noteBox = el("label", c("note"));
  const noteLabel = el("span", c("note-label"), {}, t.noteLabel);
  const noteInput = el("textarea", c("note-input"), { rows: "2" });
  noteBox.append(noteLabel, noteInput);
  extras.append(couponApplied, couponForm, couponToggle, noteBox);
  body.append(empty, lines, extras);
  const footer = el("div", c("footer"), { hidden: "" });
  const totals = el("div", c("totals"));
  const shippingNote = el("p", c("shipping-note"));
  const error = el("p", c("error"), { role: "alert", hidden: "" });
  const checkout = el("button", c("checkout"), { type: "button" }, t.checkout);
  footer.append(totals, shippingNote, error, checkout);
  drawer.append(header, body, footer);
  backdrop.append(drawer);
  container.append(backdrop);

  let codeOpen = false;
  let noteDraft: string | null = null; // null: not edited, show the cart's note
  let opener: Element | null = null;
  let previousOverflow = "";
  let wasOpen = false;

  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setCartOpen(false); };
  close.addEventListener("click", () => setCartOpen(false));
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) setCartOpen(false); });
  couponRemove.addEventListener("click", () => { void removeCartCoupon().catch(() => {}); });
  couponToggle.addEventListener("click", () => { codeOpen = true; render(); couponInput.focus(); });
  couponForm.addEventListener("submit", (e) => { e.preventDefault(); void applyCartCoupon(couponInput.value).then(() => { couponInput.value = ""; codeOpen = false; render(); }).catch(() => {}); });
  couponInput.addEventListener("input", () => { couponApply.disabled = getCartState().busy || !couponInput.value.trim(); });
  noteInput.addEventListener("input", () => { noteDraft = noteInput.value; });
  noteInput.addEventListener("blur", () => { if (noteDraft !== null) { const draft = noteDraft; void setCartNote(draft).then(() => { noteDraft = null; }).catch(() => {}); } });
  checkout.addEventListener("click", () => { void goToCheckout().catch(() => {}); });

  function row(label: string, value: string, extra = ""): HTMLElement {
    const r = el("div", extra ? `${c("row")} ${c(extra)}` : c("row"));
    r.append(el("span", c("row-label"), {}, label), el("span", c("row-value"), {}, value));
    return r;
  }

  function renderLine(line: CartLine, s: CartState): HTMLElement {
    const item = el("div", c("line"), { "data-line": line.lineItemId });
    if (line.imageUrl) item.append(el("img", c("line-image"), { src: line.imageUrl, alt: "", loading: "lazy" }));
    else item.append(el("div", c("line-placeholder"), { "aria-hidden": "true" }));
    const info = el("div", c("line-info"));
    const href = productUrl ? productUrl(line) : line.productUrl;
    const name = href ? el("a", c("line-name"), { href }, line.productName) : el("p", c("line-name"), {}, line.productName);
    info.append(name);
    for (const d of line.descriptionLines) info.append(el("p", c("line-option"), {}, d));
    if (line.subscription) info.append(el("p", c("line-subscription"), {}, `${t.subscription}${line.subscription}`));
    const status = statusCopy(line, t);
    if (status) info.append(el("p", c("line-status"), {}, status));
    const controls = el("div", c("line-controls"));
    const stepper = el("div", c("stepper"));
    const minus = el("button", c("stepper-button"), { type: "button", "aria-label": t.decrease }, "−");
    minus.disabled = s.busy || line.quantity <= 1;
    minus.addEventListener("click", () => { void updateLineQuantity(line.lineItemId, line.quantity - 1).catch(() => {}); });
    const value = el("span", c("stepper-value"), {}, String(line.quantity));
    const plus = el("button", c("stepper-button"), { type: "button", "aria-label": t.increase }, "+");
    plus.disabled = s.busy || (line.availableQuantity !== null && line.quantity >= line.availableQuantity);
    plus.addEventListener("click", () => { void updateLineQuantity(line.lineItemId, line.quantity + 1).catch(() => {}); });
    stepper.append(minus, value, plus);
    const remove = el("button", c("line-remove"), { type: "button" }, t.remove);
    remove.disabled = s.busy;
    remove.addEventListener("click", () => { void removeCartLine(line.lineItemId).catch(() => {}); });
    controls.append(stepper, remove);
    info.append(controls);
    const prices = el("div", c("line-prices"));
    prices.append(el("p", c("line-price"), {}, line.linePrice));
    if (line.compareAtLinePrice) prices.append(el("p", c("line-compare"), {}, line.compareAtLinePrice));
    item.append(info, prices);
    return item;
  }

  function render(): void {
    const s = getCartState();
    // Open and close: the overlay contract.
    if (s.open && !wasOpen) {
      opener = document.activeElement;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", onKey);
    }
    if (!s.open && wasOpen) {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) opener.focus();
      opener = null;
    }
    hide(backdrop, !s.open);
    backdrop.dataset.state = !s.open ? "closed" : s.busy ? "busy" : "open";
    if (s.open && !wasOpen) drawer.focus();
    wasOpen = s.open;
    if (!s.open) return;

    const cart = s.cart;
    const list = cart?.lines ?? [];
    title.textContent = cart && cart.itemCount > 0 ? `${t.title} (${cart.itemCount})` : t.title;
    hide(empty, list.length > 0);
    lines.replaceChildren(...list.map((line) => renderLine(line, s)));
    hide(extras, list.length === 0);
    hide(footer, list.length === 0);
    if (list.length === 0) return;

    // Coupon.
    const coupon = cart?.coupon ?? null;
    hide(couponApplied, !coupon);
    if (coupon) { couponLabel.textContent = `${t.couponApplied}${coupon.code}`; }
    couponRemove.disabled = s.busy;
    hide(couponForm, !!coupon || !codeOpen);
    hide(couponToggle, !!coupon || codeOpen);
    couponApply.disabled = s.busy || !couponInput.value.trim();

    // Note.
    const noteValue = noteDraft ?? cart?.note ?? "";
    if (noteInput.value !== noteValue && document.activeElement !== noteInput) noteInput.value = noteValue;

    // Totals.
    totals.replaceChildren();
    if (cart?.subtotal) totals.append(row(t.subtotal, cart.subtotal));
    for (const d of cart?.discounts ?? []) totals.append(row(d.name || t.discount, `−${d.amount}`));
    for (const f of cart?.fees ?? []) totals.append(row(f.name || t.fee, f.amount));
    if (!cart?.pricesIncludeTax) for (const x of cart?.taxes ?? []) totals.append(row(x.name || t.tax, x.amount));
    if (cart?.total) totals.append(row(t.total, cart.total, "row--total"));
    shippingNote.textContent = cart?.pricesIncludeTax ? t.shippingWithTax : cart?.taxes.length ? t.shippingAtCheckout : t.shippingTaxesAtCheckout;
    error.textContent = s.error ?? "";
    hide(error, !s.error);
    checkout.disabled = s.busy;
    checkout.textContent = s.busy ? t.checkoutBusy : t.checkout;
  }

  const unsubscribe = subscribeCart(render);
  render();
  return {
    destroy() {
      unsubscribe();
      if (wasOpen) { document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; }
      backdrop.remove();
    },
  };
}

export interface CartButtonOptions {
  /** The first part of every class name (default "cart"). */
  classPrefix?: string;
  text?: Partial<Pick<CartDrawerText, "buttonLabel">>;
}

export interface CartButton {
  button: HTMLButtonElement;
  destroy(): void;
}

/**
 * Renders the header cart button into `root`, replacing its content: an icon slot (`root`'s
 * existing children are kept inside the button) and a count badge that follows the cart. Clicking
 * opens the drawer.
 */
export function renderCartButton(root: HTMLElement, options: CartButtonOptions = {}): CartButton {
  const { classPrefix = "cart", text: words } = options;
  const t = { ...TEXT, ...words };
  const c = (name: string): string => `${classPrefix}-${name}`;
  const button = make("button", c("button"), { type: "button" });
  const icon = make("span", c("button-icon"), { "aria-hidden": "true" });
  icon.append(...Array.from(root.childNodes));
  const count = make("span", c("button-count"), { hidden: "" });
  button.append(icon, count);
  root.replaceChildren(button);
  button.addEventListener("click", () => setCartOpen(true));
  const render = (): void => {
    const n = getCartState().cart?.itemCount ?? 0;
    count.textContent = String(n);
    hide(count, n === 0);
    button.setAttribute("aria-label", t.buttonLabel.replace("{n}", String(n)));
  };
  const unsubscribe = subscribeCart(render);
  render();
  return { button, destroy() { unsubscribe(); root.replaceChildren(); } };
}
