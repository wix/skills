# Dashboard Plugin Slots Reference

Slots are UI placeholders on dashboard pages of Wix first-party business apps. Each slot has a unique ID used in the `extends` field of a dashboard plugin.

**Key behavior:** Some slots with the same ID appear on different pages within the dashboard. If you create a plugin for such a slot, the plugin is displayed on all pages containing that slot.

---

## Wix Blog

| Page | Slot ID | Location | Parameters |
|------|---------|----------|------------|
| Overview | `65fae040-bbeb-4c62-ba14-e0ecb5e08661` | Top of page | None |
| Categories | `0a208a9f-3b45-449c-ba8e-13a842ea5b84` | Top of page | None |
| Posts | `46035d51-2ea9-4128-a216-1dba68664ffe` | Top of page | None |
| Tags | `0e336381-34a3-4f12-86f7-f98ab928f950` | Top of page | None |

---

## Wix Bookings

| Page | Slot ID | Location | Parameters |
|------|---------|----------|------------|
| Staff | `261e84a2-31d0-4258-a035-10544d251108` | Top of page | `staffResourceId`, `scheduleId`, `timezone` |
| Edit Staff Profile | `049fb0fe-cc4a-4e33-b0a9-d8cda8e7a79f` | Top of page | `staffId`, `staffResourceId` |
| Services | `78cc4a47-8f47-489b-acc2-fd9e4208c8bd` | Between recommendations and service list | None |
| Calendar (Pre-collect payment modal) | `b92f0e25-535f-4bef-b130-8e5abc85b2fe` | Modal before payment collection | `orderId`, `onSuccess()`, `onCancel()`, `menuOption` |
| Booking List | `0f756363-1659-4929-b4ef-5ff2c458eb7d` | Top of page | None |

> **Note:** The Calendar pre-collect payment modal slot (`b92f0e25-...`) also appears on the Wix eCommerce Order Page.

---

## Wix eCommerce

| Page | Slot ID | Location | Parameters |
|------|---------|----------|------------|
| Order Page | `cb16162e-42aa-41bd-a644-dc570328c6cc` | Right side, under Order info card | `orderId`, `onOrderUpdate()` |
| Order Page (Pre-collect payment modal) | `b92f0e25-535f-4bef-b130-8e5abc85b2fe` | Modal before payment collection | `orderId`, `onSuccess()`, `onCancel()`, `menuOption` |
| Edit Order Page (Additional Fees) | `057f1726-f0b3-40ef-8903-1bd104e18369` | Right side, Order summary card | `draftOrderId`, `onDraftOrderUpdate()` |
| Orders List | `3172f3e2-236f-41db-84ca-a744e5edfcd9` | Orders list page | None |

> **Note:** A dedicated documentation page for the Orders List slot was not found. The slot ID is sourced from the About Dashboard Page Slots overview. Parameters may be available — verify with Wix documentation.

---

## Wix Events

| Page | Slot ID | Location | Parameters |
|------|---------|----------|------------|
| Event Page — Overview Tab | `d2c6965a-7d50-47a0-881a-beb184135df3` | Bottom of tab | `eventId` (String) |
| Event Page — Features Tab | `5566727b-e5a2-4a43-a26d-961aa4fe0898` | Features grid | `eventId` (String) |
| Event Page — Promotion Tab | `bc3b9b99-7a3a-4fb5-946f-078022277b6b` | Bottom of tab | `eventId` (String) |
| Event Page — Settings Tab | `c478b36b-7ce2-4564-afba-c2b0ca14bdea` | Bottom of tab | `eventId` (String) |
| Event Page — Tickets and Seating Tab | `80b95e22-26db-4063-a31f-76d4bb8797ba` | Right side, below Settings and discounts | `eventId` (String) |

---

## Wix Stores

| Page | Slot ID | Location | Parameters |
|------|---------|----------|------------|
| Products Page | `3ca518a6-8ae7-45aa-8cb9-afb3da945081` | Top of page | None |
| Inventory Page | `c9b19070-3e25-4f3d-9d27-4e0f74164835` | Above inventory list | None |

---

## Wix Restaurants

| Page | Slot ID | Location | Parameters |
|------|---------|----------|------------|
| Table Reservations | `7f71aacd-0cbf-4b73-9ea5-482e073ea237` | Table reservations page | None |

> **Note:** A dedicated documentation page for this slot was not found. The slot ID is sourced from the About Dashboard Page Slots overview. Parameters may be available — verify with Wix documentation.

---

## Wix CRM

No dashboard plugin slots are available for Wix CRM. CRM only exposes dashboard menu plugin slots (Contact Page more actions menu).
