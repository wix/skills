---
name: "Contacts Recipes"
description: "CRM contacts — create and update contacts with their emails, phones and addresses, label or delete them in bulk, and link to the contacts dashboard. Use for anything users call contacts, CRM, customers, leads, subscribers, labels, tags, or segments."
---

# Contacts Recipes

Single-contact work and bulk work are different APIs, so pick by scale first. **Create a Contact** and **Update a Contact** cover the single case, including two shapes that trip up most attempts: `email` and `phone` are single objects rather than arrays, and state, region and province codes must be ISO 3166-2. Updating also needs the contact's current revision, and finding a contact the user named rather than identified. **Bulk Label and Unlabel Contacts** and **Bulk Delete Contacts** are filter-driven — read the delete recipe's safety notes before running one.

## Recipes

### [Bulk Delete Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/bulk-delete-contacts)
Use to delete many contacts by filter — read its safety, GDPR and soft-delete notes first.

### [Bulk Label and Unlabel Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/bulk-label-and-unlabel-contacts)
Use to add or remove labels across many contacts by filter, including creating the label and handling rate limits.

### [Create a Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/create-a-contact)
Use for a new contact: the minimum identifying fields, the single-object email and phone shapes, and address formatting.

### [Update a Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/update-a-contact)
Use to change an existing contact — including locating it by name and passing its current revision.

### [Contacts Dashboard Navigation](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/contacts-dashboard-navigation)
Use when the user wants the contacts list, a single contact's page, import, or segments.
