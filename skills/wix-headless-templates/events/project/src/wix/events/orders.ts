// The ticket order behind the confirmation page, over the SDK (Events Orders, `orders.getOrder`).
// Rules and mappers live in ./orders-core (shared with the REST twin in templates/events/rest/);
// this file is the transport only. Runs on the visitor token in the browser, as Wix's own
// headless demo does — the order was created on this visitor's session by the hosted checkout.
// That read isn't guaranteed for every site's visitor scope: a permission failure throws here and
// the confirmation surface degrades to "your tickets are on their way" without order details.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/get-order.md
import { orders as ordersModule } from "@wix/events";
import { wixModule } from "../sdk";
import { ORDER_FIELDSETS, toOrder } from "./orders-core";
import type { Raw } from "./events-core";
import type { OrderSummary } from "./types";

const orders = wixModule(ordersModule);

/**
 * One order by the pair the thank-you URL carries (`?orderNumber=&eventId=`), with tickets,
 * details and invoice. Null when Wix has no such order (404); throws on anything else (a 403 on
 * a visitor scope without the order read) so the caller can degrade honestly. getOrder returns the
 * Order DIRECTLY (unwrapped).
 */
export async function fetchOrder(eventId: string, orderNumber: string): Promise<OrderSummary | null> {
  try {
    const raw: Raw = await orders.getOrder({ eventId, orderNumber }, { fieldset: ORDER_FIELDSETS as any });
    return raw?.orderNumber ? toOrder(raw) : null;
  } catch (e) {
    if ((e as Raw)?.status === 404 || (e as Raw)?.details?.applicationError?.code === "ORDER_NOT_FOUND") return null;
    throw e;
  }
}
