---
name: "Change Store Currency"
description: "Changes the store's payment currency through Site Properties and explains delayed currency updates in catalog responses."
---

# Change Store Currency

Use the [Update Site Business Region (Payment Currency, Time Zone)](../site-properties/update-site-regional-properties.md) recipe to set the requested payment currency and read it back. Confirm the change with the user before updating it.

Catalog product responses may temporarily show the previous currency after carts and checkout use the new one. Allow time for propagation, then recheck.
