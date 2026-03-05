# Dashboard Menu Plugin Slots Reference

Menu slots are placeholders in "more actions" menus and "bulk actions" menus on dashboard pages of Wix first-party business apps. Each slot has a unique ID used in the `extends` field of a dashboard menu plugin.

**Key behaviors:**
- Some slots with the same ID appear on different pages. A menu plugin targeting such a slot is displayed on all pages containing it.
- Menu plugins appear as clickable items with an icon and title in the menu.

---

## Wix Blog

### Overview Page

**More Actions Menu — Slot ID:** `eee8a260-88cb-432b-b32e-e154b0a1030a`

- **Dashboard path:** Blog > Overview
- **Use case:** Add custom actions to the blog overview page's more actions menu.

### Categories Page

**Categories More Actions Menu — Slot ID:** `b2af2156-d82c-4d6c-9961-cf1cec053566`

- **Dashboard path:** Blog > Categories
- **Use case:** Add actions for individual categories (e.g., export, analyze).

**Categories Bulk Actions More Actions Menu — Slot ID:** `1d54236e-41fd-49f0-a2e8-83da66026b72`

- **Dashboard path:** Blog > Categories (when items are selected)
- **Use case:** Add bulk actions for multiple selected categories.

### Edit Post Page

**More Actions Menu — Slot ID:** `1e756df4-6c2e-403c-b81c-c3de62aebac7`

- **Dashboard path:** Blog > Posts > Edit Post
- **Use case:** Add actions in the post editor (e.g., translate, duplicate to another blog).

### Posts Page

**Published Posts More Actions Menu — Slot ID:** `62eee170-31e0-4e71-b3ac-e357a9326a8c`

- **Dashboard path:** Blog > Posts (Published tab)
- **Use case:** Add actions for individual published posts.

**Published Posts Bulk Actions More Actions Menu — Slot ID:** `8111d033-915a-48c5-89b3-1a55a8a35d01`

- **Dashboard path:** Blog > Posts (Published tab, when items are selected)
- **Use case:** Add bulk actions for multiple selected published posts.

**Draft Posts More Actions Menu — Slot ID:** `a1f0f711-0e09-42e3-977a-ad7270c56344`

- **Dashboard path:** Blog > Posts (Drafts tab)
- **Use case:** Add actions for individual draft posts.

**Draft Posts Bulk Actions More Actions Menu — Slot ID:** `cd44424e-ad9e-4b66-965c-7e2e29ef8352`

- **Dashboard path:** Blog > Posts (Drafts tab, when items are selected)
- **Use case:** Add bulk actions for multiple selected draft posts.

**Scheduled Posts More Actions Menu — Slot ID:** `1cefe952-7874-46ff-97ec-ebafef92ec38`

- **Dashboard path:** Blog > Posts (Scheduled tab)
- **Use case:** Add actions for individual scheduled posts.

**Scheduled Posts Bulk Actions More Actions Menu — Slot ID:** `83edea8a-a945-429d-b24b-3f109ae2b3e3`

- **Dashboard path:** Blog > Posts (Scheduled tab, when items are selected)
- **Use case:** Add bulk actions for multiple selected scheduled posts.

### Tags Page

**Tags More Actions Menu — Slot ID:** `9f88f31c-9f0c-461c-86c4-6e8ee6b9c23d`

- **Dashboard path:** Blog > Tags
- **Use case:** Add actions for individual tags.

**Tags Bulk Actions More Actions Menu — Slot ID:** `87d49224-cf15-46d1-b39e-e8987549471f`

- **Dashboard path:** Blog > Tags (when items are selected)
- **Use case:** Add bulk actions for multiple selected tags.

---

## Wix Bookings

### Staff Page

**Main More Actions Menu — Slot ID:** `3ad7e6d2-35ce-45c1-ab59-64c51b60a104`

- **Dashboard path:** Settings > Booking Settings > Staff
- **Use case:** Add global actions to the staff page's more actions menu.

**Staff More Actions Menu — Slot ID:** `884a208a-7c23-4641-856a-d6561ed4c64b`

- **Dashboard path:** Settings > Booking Settings > Staff
- **Use case:** Add actions for individual staff members.

### Edit Staff Profile Page

**More Actions Menu — Slot ID:** `ce533e85-9419-4c18-baf8-b3bb2423bcd1`

- **Dashboard path:** Settings > Booking Settings > Staff > Edit or Add staff member
- **Use case:** Add actions in the staff profile editor.

### Services Page

**Main More Actions Menu — Slot ID:** `5f8f3737-461a-43de-b790-e9079ba07d62`

- **Dashboard path:** Booking Calendar > Services
- **Use case:** Add global actions to the services page's more actions menu.

**Service More Actions Menu — Slot ID:** `70f397fb-0007-43df-99f3-b3b0a9fa0712`

- **Dashboard path:** Booking Calendar > Services
- **Use case:** Add actions for individual services.

### Calendar Page

**Calendar More Actions Menu — Slot ID:** `f3ad314d-0704-48e5-86b5-81acaf43e036`

- **Dashboard path:** Booking Calendar > Calendar
- **Use case:** Add actions to the calendar page's more actions menu.

**Collect Payment Button Menu — Slot ID:** `bb4aa225-86d8-47fe-87d1-f519b1b93473`

- **Dashboard path:** Booking Calendar > Calendar
- **Use case:** Add custom payment options to the collect payment button menu.

> **Note:** This slot also appears on the Wix eCommerce Order Page.

### Booking List Page

**Booking More Actions Menu — Slot ID:** `38fbe11f-6bc6-4df7-a742-e3e169a16cef`

- **Dashboard path:** Booking Calendar > Booking List
- **Use case:** Add actions for individual bookings.

**Booking List Bulk Actions More Actions Menu — Slot ID:** `f1ab2ce9-a790-4e3e-a0f7-fae4da37a668`

- **Dashboard path:** Booking Calendar > Booking List (when items are selected)
- **Use case:** Add bulk actions for multiple selected bookings.

---

## Wix CRM

### Contact Page

**Contact More Actions Menu — Slot ID:** `79963a99-8680-4164-8961-8867fcb1751a`

- **Dashboard path:** Contacts > Contact
- **Use case:** Add actions for individual contacts (e.g., export, tag, integrate with external CRM).

---

## Wix eCommerce

### Order Page

**Collect Payment Button Menu — Slot ID:** `bb4aa225-86d8-47fe-87d1-f519b1b93473`

- **Dashboard path:** Sales > Orders > Order
- **Use case:** Add custom payment options to the collect payment button menu.

> **Note:** This slot also appears on the Wix Bookings Calendar Page.

### Orders List Page

**Orders List More Actions Menu — Slot ID:** `3172f3e2-236f-41db-84ca-a744e5edfcd9`

- **Dashboard path:** Sales > Orders
- **Use case:** Add actions for individual orders in the orders list.

---

## Wix Events

### RSVP Event Page — Guests Tab

**More Actions Menu — Slot ID:** `f35dc417-bb7b-41c6-af99-c5a86c60f54a`

- **Dashboard path:** Events > RSVP Event > Guests tab
- **Use case:** Add actions for individual RSVP guests.

### Ticketed Event Page — Guests Tab

**More Actions Menu — Slot ID:** `b9f7d36e-4035-4079-8781-4f78b4bec183`

- **Dashboard path:** Events > Ticketed Event > Guests tab
- **Use case:** Add actions for individual ticketed event guests.

### Event Page — Orders Tab

**More Actions Menu — Slot ID:** `241f5aea-8e66-45b6-b7ed-6050100b6b29`

- **Dashboard path:** Events > Event > Orders tab
- **Use case:** Add actions for individual event orders.

### Published or Drafts Page

**More Actions Menu — Slot ID:** `190f00be-4e0f-4463-a3a6-f1cfee681bca`

- **Dashboard path:** Events > Published or Drafts
- **Use case:** Add actions for individual events in the events list.

---

## Wix Stores

### Products Page

**Main More Actions Menu — Slot ID:** `c87531bd-12df-42f6-bd78-c929ece48be4`

- **Dashboard path:** Catalog > Store Products > Products
- **Use case:** Add global actions to the products page's more actions menu.

**Product More Actions Menu — Slot ID:** `5c6c70b7-5041-404d-81b6-1f7ce19acf0f`

- **Dashboard path:** Catalog > Store Products > Products
- **Use case:** Add actions for individual products.

**Bulk Actions Toolbar More Actions Menu — Slot ID:** `23986555-0ea3-49b4-bcaa-56cfe1ad35bf`

- **Dashboard path:** Catalog > Store Products > Products (when items are selected)
- **Use case:** Add bulk actions for multiple selected products.

### Inventory Page

**Inventory Item Menu Action — Slot ID:** `1b9742f8-2b93-4e66-85f2-47289bf548bb`

- **Dashboard path:** Catalog > Store Products > Inventory
- **Use case:** Add actions for individual inventory items.

**Global More Actions Menu — Slot ID:** `b9e4104f-9beb-4258-8bdb-6a34d6bf7fd0`

- **Dashboard path:** Catalog > Store Products > Inventory
- **Use case:** Add global actions to the inventory page's more actions menu.

**Bulk Actions More Actions Menu — Slot ID:** `b9f2ad03-7407-48d9-9e89-fe2f2df63e8a`

- **Dashboard path:** Catalog > Store Products > Inventory (when items are selected)
- **Use case:** Add bulk actions for multiple selected inventory items.

---

## Wix Restaurants

### Table Reservations Page

**Table Reservations More Actions Menu — Slot ID:** `61646cc4-8deb-4e4b-bd30-938d3a29eeee`

- **Dashboard path:** Table Reservations
- **Use case:** Add global actions to the table reservations page's more actions menu.

**Reservation Item More Actions Menu — Slot ID:** `f51f609d-950f-448a-a5e7-f01d31a7978d`

- **Dashboard path:** Table Reservations
- **Use case:** Add actions for individual reservations.

### Online Orders Page

**Order Card More Actions Menu — Slot ID:** `d6b9230e-7388-4b5a-bb50-86afe3e344b2`

- **Dashboard path:** Online Orders
- **Use case:** Add actions for individual online orders.

### Restaurant Menus Page

**Menus Main More Actions Menu — Slot ID:** `e2a7ffb0-5e9c-4eda-bc0c-14724ff3e407`

- **Dashboard path:** Restaurant Menus
- **Use case:** Add global actions to the restaurant menus page's more actions menu.
