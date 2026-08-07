---
name: "Configure Restaurants from Prompt"
description: "Routes any Wix Restaurants request to the recipe that handles it — e.g. 'stop taking pickup orders at 1:30am', 'set our delivery radius to 5 miles', 'pause online orders, we're slammed', 'the breakfast menu should stop at 11', 'add three dishes to the dinner menu', 'here's our menu, put it on the site', 'hold tables for 90 minutes', 'max party size is 10', 'where are my orders'. Covers all three restaurant apps — Menus, Orders and Table Reservations — matching the merchant's own wording to the app and entity that actually holds the setting, then delegating. Use this first when a restaurant request is not yet clearly about one of them."
---

# Configure Restaurants from Prompt

## When to Use

- A merchant describes something about their restaurant in their own words, and which app or entity owns it is not yet obvious
- The request mentions hours, cutoffs, prep time, pickup, delivery, closures, menus, bookings, party size, or placed orders
- You are unsure whether a request belongs to the catalog, to ordering, or to reservations

Restaurant settings are spread across three apps and several entities, and picking the wrong one is the most common failure. Match the sentence first, then open only the recipe you need.

## Step 1: Pick the Destination

The distinction that decides most requests is **catalog versus ordering versus bookings**: what is on the menu and what it costs is the catalog; when and how customers can order it is ordering settings; tables and guests are reservations. "Add a lunch menu" is catalog. "Only sell the lunch menu until 3pm" is ordering. "Hold a table 90 minutes" is reservations.

### → [Restaurants Orders Settings](restaurants-orders-settings.md)

Anything about when, whether, or how customers can order. That recipe covers every entity below; knowing which one holds the setting tells you what you are about to change before you open it.

| Merchant says | Entity | Which is |
|---|---|---|
| "prep time is 30 minutes", "let people order for later", "turn ordering off", "pause orders for an hour, we're slammed" | Operation | One ordering service (takeaway, catering) with its own scheduling, prep time, and ordering status |
| "pickup hours", "stop taking orders at 1:30am", "minimum order", "pick up at the bar", "deliver within 5 miles", "free delivery over $30", "stop delivery but keep pickup" | Fulfillment method | One way to receive an order, with its own availability window, fee, and minimum |
| "add catering as a second ordering option" | Operation group | A whole new ordering service; its operations are then created for you |
| "the breakfast menu should only show until 11", "don't sell the alcohol menu online" | Menu ordering settings | Whether and when each menu is orderable |
| "closed on Christmas", "closing early Wednesday", "shut for the summer" | Availability exception | A one-off closure or opening, instead of editing weekly hours |
| "add a 5% service charge" | Service fee | A charge applied to an operation's orders |

One distinction here is easy to get wrong: stopping *everything* is the operation's ordering status, while stopping *just delivery* and leaving pickup running is that fulfillment method.

Delivery areas, delivery fees, and delivery times have their own recipe once you are in this group — [Restaurants Orders Delivery Setup](restaurants-orders-delivery-setup.md).

### → [Restaurants Menus Setup](restaurants-menus-setup.md)

The catalog, item by item: "add three dishes", "change a price", "add a toppings choice", "mark it vegan", "create a dinner menu".

### → [Restaurants Menus Import](restaurants-menus-import.md)

A menu that already exists elsewhere: "here's our menu" followed by pasted text, a file or a photo; migrating from another platform; bulk price changes; reordering or hiding sections.

### → [Restaurants Reservations Setup](restaurants-reservations-setup.md)

Tables and guests, a separate app from ordering: "max party size is 10", "hold tables for 90 minutes", "don't confirm bookings automatically", "how many covers tonight", "mark them a no-show".

### → [Restaurants Orders Management](restaurants-orders-management.md)

Orders customers already placed: "where are my orders", "did that come through", "how many yesterday", refunds and cancellations. Restaurant orders are eCommerce orders.

### → [Restaurants Orders Setup](restaurants-orders-setup.md)

The whole launch rather than one setting: "set up my restaurant site", "we want to start taking orders online". It sequences the recipes above and names the payment connection that silently blocks checkout.

### → [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md)

"Where do I change this myself?", and anything the APIs cannot reach: dine-in ordering, order pacing, item- or section-level availability, floor plans, and the prep board are dashboard-only.

## Step 2: Follow That Recipe

Open the recipe and follow it rather than working from this table alone. Each one carries the constraints that decide whether the result is correct — for ordering settings, that the last-order time is derived from the availability window minus preparation time, and that an availability range never crosses midnight.

If a single request spans two entities, expect two updates. "Open 11am–2am with a 1:30am cutoff and 30 minutes prep" sets preparation time on the operation and the availability window on the fulfillment method.

## What This Skill Does NOT Cover

- **Field shapes and endpoints** — these live in the recipes this one routes to, and in the Wix docs
- **Anything the APIs cannot reach** — dine-in ordering, order pacing, item- or section-level availability, floor plans, the prep board: dashboard only, see [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md)
- **Deciding for the merchant** — when two entities are equally plausible, ask rather than routing on a guess

Whichever recipe you land on: if you cannot complete a change, say plainly that it was not applied and hand back the dashboard page. Never report a setting as saved, noted, or configured without a successful call behind it.
