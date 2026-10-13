// Order rules and DTO mapping for the confirmation page — transport-agnostic, imported by both
// ./orders.ts (SDK) and the REST twin in templates/events/rest/orders.ts (fetch). The fieldsets,
// the "tickets are ready" rule, the polling cadence, status copy, and the invoice mapping live
// HERE, once. Raw orders carry Date objects on the SDK and ISO strings on REST; money is
// `{ value, amount (deprecated), currency }`. Types are imported type-only; the money/date
// formatters come from ./events-core (the same file both transports ship).
import type { OrderSummary } from "./types";
import { formatMoney, isoOf, type Raw } from "./events-core";

/** Get Order fieldsets: TICKETS (the generated tickets), DETAILS (status, created, email, ticketsPdf), INVOICE. */
export const ORDER_FIELDSETS = ["TICKETS", "DETAILS", "INVOICE"] as const;

/** Wix polls the order every 2 s for up to 15 s until the tickets exist (they are generated after payment). */
export const ORDER_POLL_INTERVAL_MS = 2000;
export const ORDER_POLL_TOTAL_MS = 15000;

/** Visitor copy per Wix order status. */
export const ORDER_STATUS_COPY: Record<string, string> = {
  FREE: "Confirmed",
  PAID: "Paid",
  PENDING: "Payment pending",
  OFFLINE_PENDING: "Payment due at the event",
  INITIATED: "Awaiting payment",
  AUTHORIZED: "Payment authorized",
  PARTIALLY_PAID: "Partially paid",
  CANCELED: "Canceled",
  DECLINED: "Payment declined",
  VOIDED: "Voided",
};

/** Wix's isOrderReady: every ordered ticket has been generated. */
export function orderReady(raw: Raw | null | undefined): boolean {
  const quantity = Number(raw?.ticketsQuantity);
  return Number.isFinite(quantity) && quantity === ((raw?.tickets ?? []) as Raw[]).length;
}

/** "Sep 26, 2026" — the order date in the visitor's locale (Wix formats it without a zone). */
export function formatOrderDate(value: unknown): string {
  const iso = isoOf(value);
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

const percent = (rate: unknown): number => {
  const n = Number(rate);
  return Number.isFinite(n) ? n : 0;
};

/** A raw Order (TICKETS + DETAILS + INVOICE) → the confirmation DTO. */
export function toOrder(raw: Raw): OrderSummary {
  const invoice: Raw = raw.invoice ?? {};
  const discounts: Raw[] = invoice.discount?.discounts ?? [];
  const coupon = discounts.find((d) => d.coupon);
  const paidPlan = discounts.find((d) => d.paidPlan);
  const tax: Raw | undefined = invoice.tax;
  const fee: Raw | undefined = ((invoice.fees ?? []) as Raw[]).find((f) => f.type === "FEE_ADDED_AT_CHECKOUT");
  const status: string = raw.status ?? "";
  const ticketCount = Number(raw.ticketsQuantity);
  return {
    number: raw.orderNumber ?? "",
    status,
    statusLabel: ORDER_STATUS_COPY[status] ?? "",
    settled: status === "FREE" || status === "PAID",
    email: raw.email ?? "",
    createdLabel: formatOrderDate(raw.created),
    items: ((invoice.items ?? []) as Raw[]).map((i) => ({
      name: i.name ?? "",
      price: formatMoney(i.price),
      quantity: Number(i.quantity) || 0,
      total: formatMoney(i.total),
    })),
    subtotal: formatMoney(invoice.subTotal),
    couponDiscount: coupon ? formatMoney(coupon.amount) : "",
    paidPlanDiscount: paidPlan ? { amount: formatMoney(paidPlan.amount), ratePercent: percent(paidPlan.paidPlan?.percentDiscount?.rate) } : null,
    tax: tax?.amount ? { name: tax.name ?? "Tax", ratePercent: percent(tax.rate), amount: formatMoney(tax.amount) } : null,
    fee: fee?.amount ? { amount: formatMoney(fee.amount), ratePercent: percent(fee.rate) } : null,
    total: formatMoney(invoice.grandTotal ?? raw.totalPrice),
    ticketsPdfUrl: typeof raw.ticketsPdf === "string" ? raw.ticketsPdf : "",
    ticketCount: Number.isFinite(ticketCount) ? ticketCount : ((raw.tickets ?? []) as Raw[]).length,
    ticketsReady: orderReady(raw),
  };
}
