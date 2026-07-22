# Data Model and Operations

Treat source selection, schema, relationship values, and manager workflows as separate deliverables.

## Canonical Implementation References

Read [DATA_COLLECTION.md](DATA_COLLECTION.md) before creating or changing app-owned collection schema. Use its [Relationships](DATA_COLLECTION.md#relationships), [Initial Data Rules](DATA_COLLECTION.md#initial-data-rules), and [Permissions](DATA_COLLECTION.md#permissions) sections when applicable. Read [data-collection/WIX_DATA.md](data-collection/WIX_DATA.md) before implementing data reads, writes, reference assignment, or permissions-sensitive operations; use its [SDK Methods & Interfaces](data-collection/WIX_DATA.md#sdk-methods--interfaces) and [Permissions](data-collection/WIX_DATA.md#permissions) sections. This file is a routing and product-workflow checklist, not an SDK reference.

## 0. Choose the Data Source

| Source | Action |
| --- | --- |
| Existing site CMS collection | Resolve the existing collection by supplied ID, clear name, or verified site context. Do not create an app-owned collection. |
| New app-owned data | Create a Data Collection extension, obtain the app namespace, and use its scoped collection ID. |
| Wix business data or external API | Read the matching API reference. Create a CMS collection only when app-owned persistence is explicitly required. |
| Unknown | Inspect available context or ask one targeted question before choosing storage. |

## 1. Schema

For new app-owned collections, define fields, indexes, permissions, and reference fields. Obtain the required namespace and use the scoped collection identifier. For existing collections, inspect the actual schema before relying on a field name or type.

## 2. Relationship Data

Creating a reference field does not populate it. Decide how existing and future records receive relationship values:

- migration or initial-data strategy;
- user assignment workflow;
- validation for missing or invalid references;
- behavior for records with no relationship.

## 3. Manager Workflow

If a manager must assign a relationship from the dashboard, implement a discoverable write flow. The flow must:

1. show available target records;
2. persist the chosen reference on the source record;
3. refresh the table/detail surface;
4. communicate failure without losing context.

## 4. Mutation Readiness

Treat the availability of every write action as part of the workflow, not as decoration. A create, save, assign, resolve, or status-change action must be enabled only when a meaningful, valid mutation can be persisted.

- Capture the loaded value as the initial state and derive a semantic `isDirty`/`canSave` value from the current form state.
- Disable the action when there is no meaningful change, required input is invalid or absent, or a request is already in flight.
- Allow an intentional clear of an existing optional value when that is a valid persisted change; reverting a new value back to its original value is not a change.
- Guard the write handler as well as the control. A no-op click must not issue a data write.
- After success, refresh the initial state or close the workflow; after recoverable failure, preserve the entered value and restore the action only when the mutation remains valid.

## Data Contract

Before building a table that combines records, write down the source collection, target collection, reference field, required display fields, missing-value treatment, and mutation path. Do not rely on implied naming such as `classRef` without verifying the actual schema.
