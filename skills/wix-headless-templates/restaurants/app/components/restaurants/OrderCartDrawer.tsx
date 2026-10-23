// REFERENCE slide-over order cart with quantity stepper, remove, live subtotal, pickup/delivery
// with a time (and the address for delivery), and the Wix-hosted checkout. Mount ONCE per page;
// opens via useOrderCart().openCart(). Correct and complete; per the skill's model you design your
// own chrome on useOrderCart.
import { useState } from "react";
import { useOrderCart } from "../../hooks/restaurants/useOrderCart";
import { imgAttrs } from "../../wix/media";
import { zonedDateTimeLabel, zonedDayKey, zonedTimeLabel } from "../../wix/restaurants/time-core";
import type { FulfillmentChoice } from "../../wix/restaurants/types";

export default function OrderCartDrawer() {
  const { cart, open, closeCart, busy, error, updateQuantity, removeLine, checkout, fulfillment, fulfillmentTimes, orderingStatus, chooseFulfillment, loadFulfillmentTimes } = useOrderCart();
  const types = [...new Set((fulfillment ?? []).map((m) => m.type))];
  const [type, setType] = useState<"PICKUP" | "DELIVERY" | null>(null);
  const [timeCode, setTimeCode] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  if (!open) return null;
  const lines = cart?.lines ?? [];
  const chosenType = type ?? (types.includes("PICKUP") || !types.length ? "PICKUP" : "DELIVERY");
  const times = (fulfillmentTimes ?? []).filter((t) => t.type === chosenType);
  const tz = orderingStatus?.timeZone ?? "";
  const today = zonedDayKey(new Date(), tz);
  // A slot on a later day than today (at the restaurant) carries its date: "Fri, Oct 24, 9:00 AM".
  const timeLabel = (iso: string, asap: boolean) => {
    const d = new Date(iso);
    if (asap) return `As soon as possible (about ${zonedTimeLabel(d, tz)})`;
    return zonedDayKey(d, tz) === today ? zonedTimeLabel(d, tz) : zonedDateTimeLabel(d, tz);
  };
  const deliveryMethod = (fulfillment ?? []).find((m) => m.type === "DELIVERY");

  // Once street and city are in, delivery times come only from the methods that deliver there.
  function refreshDeliveryTimes() {
    if (street.trim() && city.trim()) void loadFulfillmentTimes(undefined, { addressLine: street, city, postalCode });
  }

  async function placeOrder() {
    const choice: FulfillmentChoice = {
      type: chosenType,
      time: times.find((t) => t.code === timeCode),
      ...(chosenType === "DELIVERY"
        ? { address: { addressLine: street, city, postalCode } } // country and subdivision: the restaurant's
        : {}),
    };
    await chooseFulfillment(choice); // the hosted checkout refuses an order with no fulfillment
    await checkout();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-foreground/40 backdrop-blur-[2px]"
      onClick={closeCart}
    >
      <aside
        role="dialog"
        aria-label="Your order"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-background text-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <span className="text-base font-semibold">
            Your order{cart && cart.itemCount > 0 ? ` (${cart.itemCount})` : ""}
          </span>
          <button
            type="button"
            aria-label="Close order"
            onClick={closeCart}
            className="text-xl leading-none text-muted-foreground transition-colors hover:text-foreground"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {lines.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">Your order is empty.</p>
          )}
          {lines.map((line) => (
            <div className="mb-6 flex gap-4" key={line.lineItemId}>
              {line.imageUrl ? (
                <img
                  {...imgAttrs(line.imageUrl, "4rem")}
                  alt=""
                  className="h-16 w-16 flex-shrink-0 rounded-md bg-secondary object-cover"
                />
              ) : (
                <div aria-hidden="true" className="h-16 w-16 flex-shrink-0 rounded-md bg-secondary" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{line.itemName}</p>
                {line.descriptionLines.map((d) => (
                  <p className="mt-0.5 text-xs text-muted-foreground" key={d}>
                    {d}
                  </p>
                ))}
                {line.status !== "IN_STOCK" && (
                  <p className="mt-1 text-xs text-destructive">No longer available</p>
                )}
                <div className="mt-2 flex items-center">
                  <div className="inline-flex items-center gap-3 rounded-control border border-border px-2 py-0.5">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      disabled={busy || line.quantity <= 1}
                      onClick={() => updateQuantity(line.lineItemId, line.quantity - 1).catch(() => {})}
                      className="px-1 text-base disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="text-sm tabular-nums">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      disabled={busy}
                      onClick={() => updateQuantity(line.lineItemId, line.quantity + 1).catch(() => {})}
                      className="px-1 text-base disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeLine(line.lineItemId).catch(() => {})}
                    className="ml-3 text-xs text-muted-foreground underline transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="text-sm font-medium">{line.linePrice}</p>
            </div>
          ))}
        </div>

        {lines.length > 0 && (
          <div className="border-t border-border px-6 py-5">
            {cart?.subtotal && (
              <div className="mb-4 flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <strong className="font-semibold">{cart.subtotal}</strong>
              </div>
            )}
            {types.length > 1 && (
              <div role="radiogroup" aria-label="Pickup or delivery" className="mb-3 grid grid-cols-2 gap-2">
                {(["PICKUP", "DELIVERY"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={chosenType === t}
                    onClick={() => { setType(t); setTimeCode(""); }}
                    className={`rounded-control border py-2 text-sm ${chosenType === t ? "border-primary font-semibold" : "border-border text-muted-foreground"}`}
                  >
                    {t === "PICKUP" ? "Pickup" : "Delivery"}
                  </button>
                ))}
              </div>
            )}
            {chosenType === "DELIVERY" && (
              <div className="mb-3 grid gap-2">
                <input aria-label="Street address" placeholder="Street address" value={street} onChange={(e) => setStreet(e.target.value)} onBlur={refreshDeliveryTimes} className="rounded-control border border-border bg-background px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <input aria-label="City" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} onBlur={refreshDeliveryTimes} className="rounded-control border border-border bg-background px-3 py-2 text-sm" />
                  <input aria-label="Postal code" placeholder="Postal code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="rounded-control border border-border bg-background px-3 py-2 text-sm" />
                </div>
                {deliveryMethod && (deliveryMethod.fee || deliveryMethod.minOrderPrice) && (
                  <p className="text-xs text-muted-foreground">
                    {[deliveryMethod.fee && `Delivery ${deliveryMethod.fee}`, deliveryMethod.minOrderPrice && `minimum order ${deliveryMethod.minOrderPrice}`].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            )}
            {times.length > 0 && (
              <select
                aria-label={chosenType === "PICKUP" ? "Pickup time" : "Delivery time"}
                value={timeCode}
                onChange={(e) => setTimeCode(e.target.value)}
                className="mb-4 w-full rounded-control border border-border bg-background px-3 py-2 text-sm"
              >
                {times.map((t) => (
                  <option key={t.code} value={t.asap ? "" : t.code}>
                    {timeLabel(t.startIso, t.asap)}
                  </option>
                ))}
              </select>
            )}
            {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => placeOrder().catch(() => {})}
              className="w-full rounded-control bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "One moment…" : "Checkout"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
