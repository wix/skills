// bookingDriver.ts — the framework-agnostic booking SDK sequence.
//
// createBooking (→ CREATED) → createCart → calculateCart → isCheckoutRequired
//   ? hosted-checkout redirect : placeOrder.
// No confirmBooking — the ecom Cart V2 holds the seat. On astro islands the @wix
// modules are ambient (the @wix/astro visitor client); no createClient/OAuthStrategy.
import { bookings } from "@wix/bookings";
import { redirects } from "@wix/redirects";
import { createCart, calculateCart, placeOrder } from "@wix/auto_sdk_ecom_cart-v-2";

export const BOOKING_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
export const STAFF_MEMBER_RESOURCE_TYPE_ID =
  "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";

export type SelectedSlot = {
  serviceType: "APPOINTMENT" | "CLASS";
  serviceId: string;
  localStartDate: string;
  localEndDate: string;
  timezone: string;
  scheduleId?: string;
  eventId?: string;
  locationId?: string;
  locationType?: string;
  // Set only when a specific staff was chosen; otherwise the ANY_RESOURCE fallback.
  resource?: { _id: string; name?: string };
};

export type BookParams = {
  service: any;
  slot: SelectedSlot;
  formSubmission: Record<string, unknown>;
  timezone: string;
};

export enum BookResultType {
  CheckoutRequired = "CheckoutRequired",
  CheckoutSkipped = "CheckoutSkipped",
}

export type BookResult =
  | { type: BookResultType.CheckoutRequired; cartId: string }
  | { type: BookResultType.CheckoutSkipped; orderId?: string };

function buildBookedSlot(slot: SelectedSlot) {
  if (slot.serviceType === "CLASS") {
    return {
      serviceId: slot.serviceId,
      eventId: slot.eventId,
      timezone: slot.timezone,
    };
  }
  // A specific staff choice books that resource; otherwise the ANY_RESOURCE
  // fallback lets Wix auto-assign a bookable staff resource.
  const resourceSelections = slot.resource
    ? [
        {
          resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID,
          selectionMethod: "SELECTED_RESOURCES",
          resources: [{ resourceId: slot.resource._id }],
        },
      ]
    : [
        {
          resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID,
          selectionMethod: "ANY_RESOURCE",
        },
      ];
  return {
    serviceId: slot.serviceId,
    scheduleId: slot.scheduleId,
    startDate: slot.localStartDate,
    endDate: slot.localEndDate,
    timezone: slot.timezone,
    resourceSelections,
    location: slot.locationId
      ? { _id: slot.locationId, locationType: slot.locationType ?? "OWNER_BUSINESS" }
      : { locationType: "OWNER_BUSINESS" },
  };
}

// Derive the payment option from the service — never hardcode ONLINE. A free /
// pay-in-person service booked ONLINE is rejected by the cart with
// INSUFFICIENT_INVENTORY (it is the only kind that reaches placeOrder).
function derivePaymentOption(service: any): "ONLINE" | "OFFLINE" {
  const o = service?.payment?.options;
  if (o?.online && !o?.inPerson) return "ONLINE";
  if (!o?.online && o?.inPerson) return "OFFLINE";
  return "ONLINE";
}

export async function book(params: BookParams): Promise<BookResult> {
  const { service, slot, formSubmission } = params;
  const selectedPaymentOption = derivePaymentOption(service);

  // 1. createBooking → CREATED. The slot nests under bookedEntity; the
  //    formSubmission goes in the options arg (keyed by each field's target).
  const { booking } = await bookings.createBooking(
    {
      selectedPaymentOption,
      totalParticipants: 1,
      bookedEntity: { slot: buildBookedSlot(slot) },
    } as any,
    { formSubmission, sendSmsReminder: true } as any,
  );

  if (!booking?._id) throw new Error("Booking was not created");

  // 2. createCart — one catalog item per bookingId, appId = BOOKING_APP_ID, WEB.
  const cart = await createCart({
    catalogItems: [
      {
        quantity: 1,
        catalogReference: { catalogItemId: booking._id, appId: BOOKING_APP_ID },
      },
    ],
    cart: { source: { channelType: "WEB" } },
  } as any);

  const cartId = cart?._id as string;
  if (!cartId) throw new Error("Cart was not created");

  // 3. calculateCart → { cart, summary }. Totals at summary.priceSummary.total.amount.
  const { cart: calc, summary } = await calculateCart(cartId);

  const total = Number((summary as any)?.priceSummary?.total?.amount ?? 0);
  const offlinePayment =
    (calc as any)?.lineItems?.[0]?.paymentConfig?.paymentOption ===
    "FULL_PAYMENT_OFFLINE";
  const cancellationFee =
    service?.bookingPolicy?.cancellationFeePolicy?.enabled === true;

  // 4. Checkout decision: cancellation fee → checkout (card on file); zero total
  //    → place; offline → place; else checkout.
  const checkoutRequired = cancellationFee
    ? true
    : total === 0
      ? false
      : !offlinePayment;

  if (checkoutRequired) {
    return { type: BookResultType.CheckoutRequired, cartId };
  }

  const placed = await placeOrder(cartId);
  return { type: BookResultType.CheckoutSkipped, orderId: placed?.orderId };
}

// Hand the cart to the Wix-hosted ecom checkout and redirect.
export async function navigateToCheckout(
  cartId: string,
  postFlowUrl: string,
): Promise<void> {
  const { redirectSession } = await redirects.createRedirectSession({
    ecomCheckout: { checkoutId: cartId },
    callbacks: { postFlowUrl },
  } as any);
  const url = redirectSession?.fullUrl;
  if (url) window.location.href = url;
}
