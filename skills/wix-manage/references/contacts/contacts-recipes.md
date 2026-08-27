---
name: "Contacts Recipes"
description: "CRM contacts — create and update contacts with their emails, phones and addresses, label or delete them in bulk, and link to the contacts dashboard. Use for anything users call contacts, CRM, customers, leads, subscribers, labels, tags, or segments."
---

# Contacts Recipes

Single-contact work and bulk work are different APIs, so pick by scale first. **Create a Contact** and **Update a Contact** cover the single case, including two shapes that trip up most attempts: `email` and `phone` are single objects rather than arrays, and state, region and province codes must be ISO 3166-2. Updating also needs the contact's current revision, and finding a contact the user named rather than identified. **Bulk Label and Unlabel Contacts** and **Bulk Delete Contacts** are filter-driven — read the delete recipe's safety notes before running one.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Bulk Delete Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/bulk-delete-contacts)
**Technical:** Deletes multiple contacts using filter-based bulk delete. Covers safe
deletion patterns, GDPR compliance, soft delete alternatives, and batch processing
strategies.

### [Bulk Label and Unlabel Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/bulk-label-and-unlabel-contacts)
**Technical:** Adds/removes labels from multiple contacts using Contacts API bulk
operations. Covers label creation, contact filtering, batch processing, and rate limit
handling.

### [Create a Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/create-a-contact)
**Technical:** Creates a contact with the Contacts API. Covers the minimum identifying
fields, the single-object shape of `email` and `phone`, and adding a physical address
with the ISO 3166-2 subdivision format required for state, region, and province codes.

### [Update a Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/update-a-contact)
**Technical:** Updates an existing contact's email, phone, name, or address with the
Contacts API. Covers locating the contact when the user identifies it by name, passing
its current revision, and the ISO 3166-2 subdivision format required for state, region
and province codes.

### [Contacts Dashboard Navigation](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/contacts-dashboard-navigation)
**Technical:** Builds direct links to Wix Contacts (CRM) dashboard pages on
manage.wix.com — the contacts list, a specific contact's view page, contact import, and
the segments page. Pairs each main contacts entity with its read API so you can fetch an
entity and hand back a 'view it in your dashboard' link. Use when the user asks where
something is in the Wix dashboard, wants a direct link to a dashboard page, or you need
a dashboard URL to include with the result of an API operation.
