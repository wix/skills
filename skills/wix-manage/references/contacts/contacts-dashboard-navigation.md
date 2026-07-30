---
name: "Contacts Dashboard Navigation"
description: "Builds direct links to Wix Contacts (CRM) dashboard pages on manage.wix.com — the contacts list, a specific contact's view page, contact import, and the segments page. Pairs each main contacts entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Contacts Dashboard Navigation

Build direct links into the contacts (CRM) pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

Contacts pages are split across **two apps** with two URL namespaces:

- **Contacts** (`74bff718-5977-47f2-9e5f-a9fd0047fd1f`) — the contact list, contact view, and import. Routes under `contacts/`.
- **Segments** (`ee070097-0850-4f23-ad8c-3cdd4efd5244`) — contact segments. Routes under `segments/`.

## Contacts Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Contacts list | `contacts` | All contacts (filter, label, search) |
| Contact view | `contacts/view/{contactId}` | A specific contact's details and activity |
| Import contacts | `contacts/contacts/import` | Import contacts (CSV, Gmail) |

Older `contacts/import` links redirect to the current import route.

## Segments Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Segments | `segments` | Contact segments (saved smart filters over contacts) |

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header.

| Entity | Read API | Dashboard link |
|---|---|---|
| Contact | `POST /contacts/v4/contacts/query` · `GET /contacts/v4/contacts/{id}` | `contacts/view/{contactId}` (view) or `contacts` (list) |
| Label | `GET /contacts/v4/labels` · `POST /contacts/v4/labels/query` | `contacts` (labels filter the contacts list) |
| Segment | Segments API (no public REST read endpoint) | `segments` |

Example — after creating a contact, hand back its view link:

```
Created contact "Dana Cohen".
View them here: https://manage.wix.com/dashboard/{metaSiteId}/contacts/view/{contactId}
```
