// bookingDriver.ts — the booking sequence in plain @wix SDK calls.
// Framework-agnostic: no React, no signals, no UI. Any framework's booking step
// imports book()/navigateToCheckout() and drives them; APPOINTMENT and CLASS
// share the same sequence.
//
// Mechanism = ecom Cart V2 on every path: createBooking leaves the booking
// CREATED, then the cart holds the seat — a paid service hands off to the
// Wix-hosted checkout, a free / pay-in-person service places the order directly.
//
// On @wix/astro the SDK calls run ambiently (the visitor client is provided by
// @wix/essentials, like the ecom CartView island) — no createClient/OAuthStrategy
// needed. On an own/own-build SPA, acquire a visitor client with
// createClient({ modules, auth: OAuthStrategy({ clientId }) }) and call the same
// functions through it. Keep the SDK calls, payload shapes, and the sequence;
// adapt only brand copy/styling in the UI that drives this module.

import { bookings } from "@wix/bookings";
import { createCart, calculateCart, placeOrder } from "@wix/auto_sdk_ecom_cart-v-2";
import { redirects } from "@wix/redirects";

// ── Constants (C:src/services/constants.ts) ────────────────────────────────
export const BOOKING_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
export const STAFF_MEMBER_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";

// ── Types ───────────────────────────────────────────────────────────────────
// FormValues = the submitted booking-form values, keyed by each field's `target`
// (NOT hardcoded field names). The default booking form's targets are snake_case
// `first_name`/`last_name`/`email`/`phone`; read them from the form schema and key
// the values by `target` — never hardcode the keys here.
export type FormValues = Record<string, unknown>;

export interface SelectedSlot {
  serviceType: "APPOINTMENT" | "CLASS";
  serviceId: string;
  localStartDate: string; // local "YYYY-MM-DDTHH:mm:ss" (NOT UTC) — maps to slot.startDate
  localEndDate: string; //   "                            " → slot.endDate
  timezone: string;
  // APPOINTMENT:
  scheduleId?: string;
  locationId?: string; // from slot.location._id  (the id field is `_id`, not `.id`)
  locationType?: string; // "BUSINESS" | "CUSTOMER" | "CUSTOM"
  // CLASS:
  eventId?: string;
  // Resource chosen on the slot (flow 5). When absent the driver emits the
  // ANY_RESOURCE fallback so Wix auto-assigns a bookable staff member.
  resource?: { _id: string; name?: string };
}

export interface BookParams {
  service: any; // the @wix/bookings Service (read payment.options + bookingPolicy)
  slot: SelectedSlot;
  formSubmission: FormValues; // values from the @wix/forms Form, keyed by target
  timezone: string;
  totalParticipants?: number;
  /** consumer override; when omitted, derived from service.payment.options */
  selectedPaymentOption?: "ONLINE" | "OFFLINE";
}

export const BookResultType = {
  CheckoutRequired: "checkout_required",
  CheckoutSkipped: "checkout_skipped",
} as const;
export type BookResult =
  | { type: typeof BookResultType.CheckoutRequired; cartId: string }
  | { type: typeof BookResultType.CheckoutSkipped; orderId: string };

// ── Payment derivation ───────────────────────────────────────────────────────
function deriveSelectedPaymentOption(service: any): "ONLINE" | "OFFLINE" {
  const options = service?.payment?.options;
  if (options?.online && !options?.inPerson) return "ONLINE";
  if (!options?.online && options?.inPerson) return "OFFLINE";
  return "ONLINE"; // both / neither → ONLINE (consumer override wins, see below)
}

// LocationType maps from the availability slot's type → the booking endpoint enum.
function mapLocationType(slotType?: string): string {
  switch (slotType) {
    case "BUSINESS":
      return "OWNER_BUSINESS";
    case "CUSTOMER":
      return "CUSTOM";
    case "CUSTOM":
      return "OWNER_CUSTOM";
    default:
      return "OWNER_BUSINESS";
  }
}

// ── buildBookingRequest ───────────────────────────────────────────────────────
function buildBookingRequest(params: BookParams) {
  const { service, slot, formSubmission, timezone } = params;
  const resource = slot.resource; // prefer the slot's chosen resource when present

  return {
    booking: {
      // Consumer override wins over the service-config heuristic.
      selectedPaymentOption:
        params.selectedPaymentOption ?? deriveSelectedPaymentOption(service),
      totalParticipants: params.totalParticipants || 1,
      bookedEntity: {
        slot: {
          serviceId: slot.serviceId,
          // APPOINTMENT carries scheduleId; CLASS carries eventId (Wix derives the rest).
          scheduleId: slot.scheduleId ?? undefined,
          startDate: slot.localStartDate,
          endDate: slot.localEndDate,
          timezone,
          eventId: slot.eventId ?? undefined,
          // Resource: use the chosen one, else the ANY_RESOURCE fallback so Wix
          // auto-assigns a bookable staff member. Appointment availability slots
          // return availableResources:[] yet book fine via ANY_RESOURCE.
          ...(resource
            ? { resource: { _id: resource._id, name: resource.name } }
            : {
                resourceSelections: [
                  {
                    resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID,
                    selectionMethod: "ANY_RESOURCE",
                  },
                ],
              }),
          location:
            slot.locationId || slot.locationType
              ? {
                  ...(slot.locationId ? { _id: slot.locationId } : {}),
                  locationType: mapLocationType(slot.locationType),
                }
              : { locationType: "OWNER_BUSINESS" },
        },
      },
    },
    participantNotification: {
      metadata: { channels: "EMAIL,SMS" },
      notifyParticipants: true,
    },
    sendSmsReminder: true,
    formSubmission,
  };
}

// ── buildCartRequest ──────────────────────────────────────────────────────────
function buildCartRequest(args: {
  bookingIds: string[];
  contactDetails?: any;
  businessLocationId?: string | null;
}) {
  const cart: any = { source: { channelType: "WEB" } };
  if (args.businessLocationId)
    cart.businessInfo = { locationId: args.businessLocationId };
  if (args.contactDetails) {
    cart.customerInfo = args.contactDetails.email
      ? { email: args.contactDetails.email }
      : {};
    if (args.contactDetails.fullAddress?.country) {
      cart.deliveryInfo = { address: { ...args.contactDetails.fullAddress } };
      cart.paymentInfo = {
        billingAddress: { ...args.contactDetails.fullAddress },
      };
    }
  }
  return {
    catalogItems: args.bookingIds.map((id) => ({
      quantity: 1,
      catalogReference: { catalogItemId: id, appId: BOOKING_APP_ID },
    })),
    cart,
  };
}

// ── isCheckoutRequired ────────────────────────────────────────────────────────
function isCheckoutRequired(cart: any, summary: any, service: any): boolean {
  if (service?.bookingPolicy?.cancellationFeePolicy?.enabled) return true;
  const total = Number(summary?.priceSummary?.total?.amount ?? 0);
  if (total === 0) return false;
  if (cart?.lineItems?.[0]?.paymentConfig?.paymentOption === "FULL_PAYMENT_OFFLINE")
    return false;
  return true;
}

// ── canBook ───────────────────────────────────────────────────────────────────
function canBook(params: BookParams): boolean {
  const slotOk =
    !!params.slot &&
    !!params.slot.localStartDate &&
    (params.slot.serviceType === "CLASS"
      ? !!params.slot.eventId
      : !!params.slot.scheduleId);
  return slotOk && params.formSubmission != null;
}

// ── book — the full sequence ──────────────────────────────────────────────────
export async function book(params: BookParams): Promise<BookResult> {
  if (!canBook(params))
    throw new Error("Cannot book: missing slot or form submission");

  // 1. createBooking → CREATED (the cart holds the seat)
  const req = buildBookingRequest(params);
  const created = await bookings.createBooking(req.booking as any, {
    participantNotification: req.participantNotification,
    sendSmsReminder: req.sendSmsReminder,
    formSubmission: req.formSubmission as any,
  });
  const bookingId = created?.booking?._id;
  if (!bookingId) throw new Error("Failed to create booking");
  const contactDetails = created?.booking?.contactDetails;

  // 2. createCart — one catalog item per booking id (channel WEB, bookings appId)
  const businessLocationId = params.slot.locationId ?? undefined;
  const cart = await createCart(
    buildCartRequest({ bookingIds: [bookingId], contactDetails, businessLocationId }),
  );
  const cartId = cart?._id;
  if (!cartId) throw new Error("Failed to create cart");

  // 3. calculateCart → totals (not stored on the Cart V2 entity)
  const { cart: calculatedCart, summary } = await calculateCart(cartId);
  if (!calculatedCart || !summary) throw new Error("Failed to calculate cart");

  // 4. checkout required? → redirect (paid) ; else placeOrder (free/offline)
  if (isCheckoutRequired(calculatedCart, summary, params.service)) {
    return { type: BookResultType.CheckoutRequired, cartId };
  }
  const order = await placeOrder(cartId);
  const orderId = order?.orderId;
  if (!orderId) throw new Error("Failed to place order");
  return { type: BookResultType.CheckoutSkipped, orderId };
}

// ── navigateToCheckout ────────────────────────────────────────────────────────
// Paid services: hand the cart to the Wix-hosted ecom checkout. Same shape on
// every path — ecomCheckout.checkoutId = the cartId.
export async function navigateToCheckout(
  cartId: string,
  postFlowUrl: string,
): Promise<void> {
  const { redirectSession } = await redirects.createRedirectSession({
    ecomCheckout: { checkoutId: cartId },
    callbacks: { postFlowUrl },
  });
  if (redirectSession?.fullUrl) {
    window.location.href = redirectSession.fullUrl;
  } else {
    throw new Error("Failed to create redirect session");
  }
}
