---
name: "Restaurants Orders Delivery Setup"
description: "Sets up and changes delivery for Wix Restaurants online ordering: the delivery area (a radius around the restaurant, a list of postal codes, or a custom polygon), delivery fee and free-delivery threshold, minimum order, estimated delivery time, courier instructions, and delivery hours. Use when a merchant wants to start offering delivery, change how far they deliver, add or remove postal codes, charge or waive a delivery fee, set a minimum order for delivery, change how long delivery takes, or check whether a given customer address is deliverable. Delivery is one fulfillment method among others, so its hours and ordering cutoff follow the same rules as pickup."
---

# Restaurants Orders Delivery Setup

Delivery is a fulfillment method on a restaurant [operation](restaurants-orders-settings.md). Everything about *when* delivery is available — availability windows, the ordering cutoff, enabling or disabling it — works exactly as it does for pickup and is covered in [Restaurants Orders Settings](restaurants-orders-settings.md). This recipe covers what is specific to delivery: where you deliver, what it costs, and how long it takes.

## When to Use

- Starting delivery on a restaurant that currently offers pickup only
- Changing the delivery radius, or adding and removing postal codes
- Setting a delivery fee, a free-delivery threshold, or a minimum order for delivery
- Changing the estimated delivery time, or the instructions couriers see at pickup
- Answering "do we deliver to this address?"

## Prerequisites

1. Wix Restaurants Orders installed, with an operation to attach the method to
2. The restaurant's address set on the site — a radius area is measured from it and cannot be re-centred through this API

## Choosing an Area Type

A delivery method has exactly one area, of one of three types you can set:

| Type | Defined by | Use when |
|---|---|---|
| `RADIUS` | A minimum and maximum distance from the restaurant, in miles or kilometres | "We deliver within 5 miles" — the common case |
| `POSTAL_CODE` | A list of postal codes, up to 100 | The merchant thinks in neighbourhoods or ZIP codes, or the area is not circular |
| `CUSTOM` | A polygon of geocoded points | The boundary follows a river, a highway, or a hand-drawn line |

Notes that matter in practice:

- **Radius takes a minimum as well as a maximum.** A minimum above zero creates a doughnut, excluding addresses close to the restaurant. That is almost never what a merchant means — leave it at zero unless they explicitly describe a ring.
- **Postal codes accept wildcards.** `1000*` covers `10001` through `10009`, which is far shorter than listing them. The country is taken from the site and cannot be set per area.
- **Tiered pricing means several methods, not several areas.** One method holds one area and one fee, so "free within 2 miles, $5 up to 5 miles" is two delivery methods: a 0–2 radius at no fee, and a 2–5 radius at $5. Give each a name the merchant would recognise, since both appear at checkout.

A fourth type, `PROVIDER_DEFINED`, exists for third-party delivery providers that decide their own coverage. It is not configured through this API.

## Fees, Thresholds, and Timing

Four numbers, easy to confuse — confirm which the merchant means before writing:

- **Delivery fee** — charged on the order.
- **Free-delivery threshold** — order value above which the fee is waived. Setting it without a fee has no visible effect.
- **Minimum order** — order value below which delivery cannot be chosen at all. Not the same as the threshold; a merchant saying "$20 minimum for free delivery" means the threshold, while "we don't deliver under $20" means the minimum.
- **Estimated delivery time**, in minutes. This is not cosmetic: it is subtracted from the availability window end alongside preparation time, so raising it moves the delivery ordering cutoff earlier. A window ending 22:00 with 30 minutes prep and 30 minutes delivery stops accepting delivery orders at 21:00, while pickup on the same window stops at 21:30.

Courier pickup instructions are separate from customer-facing pickup instructions — they are what the driver sees on arrival.

## Flow

1. **Confirm the shape of the area** before writing. "Within 5 miles" is a radius; "these neighbourhoods" is usually postal codes. If the merchant describes different prices at different distances, that is more than one method — say so and confirm.
2. **List the fulfillment methods** on the operation and check whether a delivery method already exists. Update it rather than adding a second one; two overlapping delivery methods both show at checkout.
3. **Create or update the delivery method** with its area, fee, threshold, minimum order, estimated delivery time, and courier instructions. **Any body that writes `deliveryOptions` must also carry `type`**, on updates as well as creates — see Error Handling for what happens when it doesn't.

`PATCH /fulfillment-methods/v1/fulfillment-methods/{fulfillmentMethodId}` — a 5-mile radius, $3 fee, free over $30, $15 minimum, 30 minutes:

```json
{
  "fulfillmentMethod": {
    "id": "<FULFILLMENT_METHOD_ID>",
    "revision": "2",
    "type": "DELIVERY",
    "fee": "3.00",
    "minOrderPrice": "15.00",
    "freeFulfillmentPriceThreshold": "30.00",
    "deliveryOptions": {
      "deliveryTimeInMinutes": 30,
      "deliveryArea": {
        "type": "RADIUS",
        "radiusOptions": { "maxDistance": "5", "unit": "MILES" }
      }
    }
  }
}
```

`maxDistance` is a **string**, `unit` is `"MILES"` or `"KM"`, and the response fills in `radiusOptions.centerPointAddress` from the site's own address — read it back to confirm the circle is centred where the merchant expects. For the other area types swap in `postalCodeOptions` or `customOptions` and change `deliveryArea.type` to match; sending options that disagree with `type` is a 400.
4. **Set its availability** if delivery hours differ from pickup hours — same rules as any fulfillment method, including the midnight split.
5. **Verify with a real address.** Post an address the merchant named to the available-for-address endpoint and confirm the method comes back. This is the only check that proves the area is right; a saved radius tells you nothing about whether it covers the streets they meant.

```json
{ "address": { "formattedAddress": "500 Terry Francine Street, San Francisco, CA 94158" } }
```

The response lists only non-delivery methods plus delivery methods whose area covers that address, so your method missing from it *is* the failure. Add `fulfillmentMethodIds` to narrow the check to the one you just wrote.

## Endpoints

Under `https://www.wixapis.com` with an `Authorization` header:

| Purpose | Call |
|---|---|
| List or query fulfillment methods | `GET /fulfillment-methods/v1/fulfillment-methods`, `POST /fulfillment-methods/v1/fulfillment-methods/query` |
| Create or update a delivery method | `POST /fulfillment-methods/v1/fulfillment-methods`, `PATCH .../{fulfillmentMethodId}` |
| Check an address | `POST /fulfillment-methods/v1/fulfillment-methods/available-for-address` |

Read field shapes from the [Fulfillment Methods docs](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/fulfillment-methods/introduction) rather than from this table.

## Error Handling

| Error | Cause | Action |
|---|---|---|
| `400 ONE_OF_ALIGNMENT`, "type cannot be provided with any these fields: pickup_options, delivery_options…" | The message states the inverse of the rule. `type` is **missing** from a body that writes `deliveryOptions` | Add `type: "DELIVERY"` alongside `deliveryOptions`. Do not remove `type` — that is what the text tells you to do and it keeps failing. A `fieldMask` does not help |
| 400 on the area | Area type and options disagree — a radius body sent with a postal-code type, or vice versa | Send the options matching the type you set |
| Address check returns no delivery method | Address outside every area, or the method is disabled | Confirm the radius or postal list actually covers it, and that the method is enabled |
| Radius saved but customers nearby cannot order | A non-zero minimum distance excluding them | Set the minimum to zero unless a ring was intended |
| Delivery stops earlier than the merchant expects | Delivery time and prep time both subtract from the window end | Explain the arithmetic, then extend the window rather than shortening the times |
| Two delivery options at checkout | A second method was created instead of updating the first | Delete or disable the duplicate |

## What This Skill Does NOT Cover

- **Delivery hours, cutoff, enabling or disabling** — same as any fulfillment method; see [Restaurants Orders Settings](restaurants-orders-settings.md)
- **What is on the menu** — see [Restaurants Menus Setup](restaurants-menus-setup.md)
- **Reading delivery orders that were placed** — see [Restaurants Orders Management](restaurants-orders-management.md)
- **Third-party delivery providers** — provider-defined areas are not configured here
- **Shipping rates for non-restaurant products** — a different eCommerce surface

If you cannot complete a change, say plainly that it was not applied and hand back the dashboard page — `wix-restaurants-orders-new/settings/delivery`, via [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md). Never report a setting as saved, noted, or configured without a successful call behind it.
