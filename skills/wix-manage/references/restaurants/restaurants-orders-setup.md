---
name: "Restaurants Orders Setup"
description: "End-to-end setup of online ordering for a restaurant site, in the order the steps have to happen: install Wix Restaurants Orders, connect a payment method, build the menu, configure the operation and fulfillment methods, verify what customers will actually see, and publish. Use when a merchant asks to set up their restaurant site, start taking orders online, or launch ordering — as opposed to changing one setting on a restaurant that already sells. Sequences the other restaurant recipes and names the dependencies between them, including the payment connection that silently blocks checkout when missing."
---

# Restaurants Orders Setup

Launching ordering touches four apps and has a required order. Skipping a step usually does not fail loudly — it produces a site that looks configured and cannot take an order.

## When to Use

- "Help me set up my restaurant site", "I want to start taking orders online", "get us live"
- A restaurant site where no menu exists yet, or ordering has never been switched on
- Not for changing one setting on a working site — use [Configure Restaurants from Prompt](configure-restaurants-from-prompt.md) for that

## The Dependency Chain

Each step depends on the one before, which is why the order is fixed:

```
Orders app installed
  └─ payment method connected        (else checkout cannot complete)
       └─ menu with items exists     (else there is nothing to order)
            └─ menu linked to an operation
                 └─ fulfillment method enabled, with hours
                      └─ verified, then published
```

Confirm the merchant's details once, up front, rather than asking between steps: business name, address, phone, opening hours, whether they want pickup, delivery, or both, and how long the kitchen needs. Ordering hours and the kitchen's prep time are the two answers everything downstream depends on.

## Step 1: Install Wix Restaurants Orders

Check what is installed before installing anything. Wix Restaurants Orders depends on Wix Restaurants Menus and Wix eCommerce, so installing it normally pulls both in — but confirm that by listing the installed apps afterwards rather than assuming, and install whatever is still missing. See [Install Wix Apps](../app-installation/install-wix-apps.md) and [List Installed Apps](../app-installation/list-installed-apps.md).

The three restaurant apps and their IDs: Wix Restaurants Menus `b278a256-2757-4f19-9313-c05c783bec92`, Wix Restaurants Orders `9a5d83fd-8570-482e-81ab-cfa88942ee60`, Wix Table Reservations `f9c07de2-5341-40c6-b096-8eb39de391fb` (reservations are optional here — see [Restaurants Reservations Setup](restaurants-reservations-setup.md)).

Installation also creates the first operation and a default fulfillment method. Do not create operations yourself later — read the ones that appear here.

## Step 2: Connect a Payment Method

Do this before building the menu, because it is the step most likely to stall on the merchant: it needs their business and bank details, and they may have to leave and come back. See [How to Set Up Wix Payments](../get-paid/how-to-setup-wix-payments.md).

Nothing in the Restaurants APIs reports that payments are missing. Ordering will look fully configured, customers will build a cart, and checkout will fail at the end. If the merchant cannot finish this now, carry on with the remaining steps but tell them plainly that the site cannot take an order until it is done, and repeat that in the summary at the end.

## Step 3: Build the Menu

Create the menu, its sections, and its items, with modifiers and prices. See [Restaurants Menus Setup](restaurants-menus-setup.md).

A menu that exists is not yet orderable — that link is made in the next step.

## Step 4: Configure Ordering

Follow [Restaurants Orders Settings](restaurants-orders-settings.md) — its steps cover the operation, the fulfillment methods, and linking each menu to the operation. Add [Restaurants Orders Delivery Setup](restaurants-orders-delivery-setup.md) if they deliver.

Two things from those recipes decide whether the result matches what the merchant asked for, so do not shortcut them: the last-order time is the availability window's end minus preparation time, and hours running past midnight are two ranges per day rather than one.

The answers you gathered up front map to: preparation time and scheduling on the operation, opening hours to the fulfillment method's availability window, and pickup or delivery choice to which methods you enable.

## Step 5: Verify Before Declaring It Done

Do not report success from the fact that the writes returned 2xx. Check what a customer would see:

1. Call `GET /restaurants-operations/v1/operations/{operationId}/first-available-time-slot-per-fulfillment-type`. If it returns no slot, ordering is not live no matter what the settings say.
2. Confirm the fulfillment method is enabled and its menu is linked to the operation.
3. State the effective first and last order times back to the merchant in their own terms — "orders open at 11am and stop at 1:30am" — since the cutoff is derived and they cannot read it off the settings screen.

## Step 6: Publish and Hand Off

Publish the site, then summarise: what is live, the ordering hours and cutoff, anything left undone, and any assumption you made on their behalf. If payments were skipped in Step 2, lead with that.

## Error Handling

| Symptom | Cause | Action |
|---|---|---|
| Menu and hours are set, customers still cannot order | No payment method connected | Return to Step 2; nothing in Restaurants reports this |
| Operations API returns nothing to update | Orders app not installed, or install still settling | Confirm the install, then re-list before creating anything |
| Time-slot check returns nothing, or the wrong menu appears | A configuration mismatch between menu, operation, method, and location | See Error Handling in [Restaurants Orders Settings](restaurants-orders-settings.md) — it lists the three causes in the order to check them |

## What This Skill Does NOT Cover

- **Changing one setting on a site that already sells** — see [Restaurants Orders Settings](restaurants-orders-settings.md), or route from [Configure Restaurants from Prompt](configure-restaurants-from-prompt.md)
- **Importing a menu the merchant already has** — see [Restaurants Menus Import](restaurants-menus-import.md)
- **Reading the orders that arrive afterwards** — see [Restaurants Orders Management](restaurants-orders-management.md)
- **Table reservations** — a separate app, not needed to take orders; see [Restaurants Reservations Setup](restaurants-reservations-setup.md)
- **Domain, branding, and site content** — outside the restaurant apps

If a step cannot be completed, say plainly which one and hand back its dashboard page — see [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md). Never report ordering as live without the time-slot check in Step 5 behind it.
