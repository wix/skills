---
name: "Restaurants Menus Import"
description: "Turns a restaurant's existing menu — pasted text, a document, a photo of a printed menu, or a list the merchant dictates — into a Wix Restaurants menu with sections, items, prices, modifiers and dietary labels. Also covers reworking a menu that already exists: bulk price changes, reordering or renaming sections, hiding seasonal items, and splitting one menu into several. Use when a merchant already has their menu somewhere and wants it in Wix, rather than building it item by item from scratch."
---

# Restaurants Menus Import

Most restaurants already have a menu. They paste it, upload it, or read it out — they rarely want to create items one at a time. This recipe covers getting an existing menu in, and reworking one that is already there. For the entity model and modifier mechanics see [Restaurants Menus Setup](restaurants-menus-setup.md).

## When to Use

- "Here's our menu" followed by a wall of text, a file, or a photo
- Migrating a menu from another platform or an old site
- Bulk price changes, reordering sections, hiding seasonal items
- Splitting one long menu into several (lunch, dinner, drinks)

## Prerequisites

1. Wix Restaurants Menus installed
2. API access with restaurant management permissions

## The Shape Trap: Sections Do Not Contain Items

A printed menu nests — heading, then its dishes — and it is natural to send that nesting straight to the API. **It is not accepted, and it fails quietly.** A section has no `items` field. Items are created as their own entities, and a section is given their **IDs** afterwards.

This is the single most common way an import goes wrong. Sending:

```json
{ "section": { "name": "Burgers", "description": "Served with fries or tots",
    "items": [ { "name": "The Rally Burger", "price": "17.00" }, … ] } }
```

leaves you with a section and **no items at all** — the nested array is not what the API reads. The call returns 2xx, so an agent that trusts the response then tells the merchant it created 37 items that do not exist.

Create items first, keep their IDs, then attach. Never send `items` inside a section, and never fold a dish list into a section's `description`.

## Parse Before You Write

A pasted menu is not structured data. Read the whole thing first and decide the structure, then write it in one pass — creating items as you scroll produces a menu whose sections are in the wrong order and whose modifiers are missing.

What to extract, and what merchants routinely leave implicit:

- **Sections** are usually the shouted headings: STARTERS, BURGERS, DESSERTS. Keep the merchant's own names and their original order.
- **Prices** appear as `— 14`, `$14`, `14.00`, or trailing the description. Currency comes from the site, so record the number only.
- **Modifiers** hide in phrases like "Choice of chicken or steak", "Add Chicken +5", "Served with fries or tots". These are modifier groups, not description text — see the two-call flow in [Restaurants Menus Setup](restaurants-menus-setup.md).
- **Dietary labels** hide in "(GF)", "(V)", "vegan", or a legend at the bottom. Labels are entities the site already has — list them and reference the matching ID rather than leaving the marker inside the item name (see Step 8 of [Restaurants Menus Setup](restaurants-menus-setup.md)).
- **Sub-headings that are not sections** — "Served with Victory Fries or Rocky Mountain Tots" under BURGERS applies to every item in that section, and is a modifier group repeated per item, not a section of its own.
- **Time-bound sections** — a "HAPPY HOUR" or "LUNCH SPECIAL" block carries hours. Those hours are *not* a menu property. Create the section normally, then ask whether those items should be orderable only during that window, which is a menu ordering setting — see [Restaurants Orders Settings](restaurants-orders-settings.md).

Ask before inventing. If a price is missing or a section heading is ambiguous, ask rather than guessing — a wrong price reaches customers.

## Flow

### Step 1: Confirm the Structure Before Writing Anything

Show the merchant the sections you found and the item count per section, and name anything you could not parse. This is one message, and it prevents rebuilding a 40-item menu because "Sides" was actually part of "Burgers".

### Step 2: Create in Dependency Order, in Bulk

Follow the ordering in [Restaurants Menus Setup](restaurants-menus-setup.md), using the bulk endpoints rather than a loop: modifiers, then modifier groups, then items, then sections, then attach items to sections and sections to the menu.

Ask for the created entities back so you have their IDs — the attach steps need them, and a second query to find what you just made is wasted work.

### Step 3: Attach and Verify

Attach item IDs to their sections and section IDs to the menu, then **query the items back** and report what exists: section count, item count, and anything skipped.

Verify by reading, never from create responses. A nested payload returns 2xx while creating nothing, so "the calls succeeded" is not evidence that items exist. Count what a query returns before telling the merchant a number.

### Step 4: Ask About Images

Imported menus arrive without photos. Say so, rather than leaving the merchant to discover it — and if they supply images, expect media upload to be rate-limited on a large menu, so batch it and retry rather than failing the import.

## Reworking an Existing Menu

- **Bulk price changes** — query the items, then bulk update. Each item needs its current `revision`.
- **Reordering sections** — `sortOrder` on the section, not the order you happened to create them in.
- **Hiding seasonal items** — set the item invisible. Deleting loses its modifiers and price history; a hidden item can come back next season.
- **Splitting a menu** — create the new menu, move section IDs onto it, then update the original's section list. A section referenced by two menus appears in both.

## Error Handling

| Error | Cause | Action |
|---|---|---|
| Sections created, no items anywhere, calls all returned 2xx | The dishes were nested inside the section body, or written into its `description` | Create items as their own entities, then attach their IDs. Re-read the menu before reporting anything |
| Group created but its choices are missing | Modifiers were sent inline instead of created first | Item modifiers first, then the group referencing their IDs |
| Items exist but the menu looks empty | Items were never attached to sections, or sections never to the menu | Attach both, in that order |
| 429 during image upload | Media import rate-limited on large menus | Batch and retry; the items are already created |
| Update rejected on `revision` | Bulk edits used revisions from an earlier read | Re-query immediately before the bulk update |
| Wrong prices across a section | A price column was misread as part of the description | Re-read that section with the merchant before rewriting |

## What This Skill Does NOT Cover

- **When items can be ordered** — that is menu ordering settings; see [Restaurants Orders Settings](restaurants-orders-settings.md)
- **The entity model, endpoints and modifier mechanics** — see [Restaurants Menus Setup](restaurants-menus-setup.md)
- **Getting ordering live around the new menu** — see [Restaurants Orders Setup](restaurants-orders-setup.md)
- **Table reservations** — a separate app; see [Restaurants Reservations Setup](restaurants-reservations-setup.md)
- **Printed menu design and PDF export** — dashboard only, see [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md)

If you cannot complete the import, say plainly what landed and what did not, and hand back the menus dashboard page — see [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md). Never report a menu as imported without reading it back.
