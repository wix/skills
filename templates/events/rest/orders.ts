// The ticket order behind the confirmation page over REST — the twin of app/wix/events/orders.ts.
// Same export, same DTO; the mapper from orders-core (the SAME file the SDK transport uses,
// deployed flat next to this one). Runs on the visitor token — the hosted checkout created the
// order on this visitor's session. Not guaranteed for every site's visitor scope: a 403 throws
// and the confirmation surface degrades to a confirmation without order details.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/get-order.md
import { WixApiError, wixRequest } from "./client.js";
import { ORDER_FIELDSETS, toOrder } from "./orders-core.js";
import type { Raw } from "./events-core.js";
import type { OrderSummary } from "./types.js";

/**
 * One order by the pair the thank-you URL carries. Null on 404; throws on anything else.
 * GET /events/v1/events/{eventId}/orders/{orderNumber}?fieldset=TICKETS&fieldset=DETAILS&fieldset=INVOICE  → { order }
 */
export async function fetchOrder(eventId: string, orderNumber: string): Promise<OrderSummary | null> {
  try {
    const res = await wixRequest<Raw>(`/events/v1/events/${encodeURIComponent(eventId)}/orders/${encodeURIComponent(orderNumber)}`, {
      method: "GET",
      query: { fieldset: ORDER_FIELDSETS },
    });
    const raw: Raw | undefined = res?.order;
    return raw?.orderNumber ? toOrder(raw) : null;
  } catch (e) {
    if (e instanceof WixApiError && e.status === 404) return null;
    throw e;
  }
}
