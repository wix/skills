---
name: "Change Store Currency"
description: "Changes the store's payment currency through Site Properties and explains delayed currency updates in catalog responses."
---

# Change Store Currency

> These calls need the Wix Stores app on the site (`appDefId` `215238eb-22a5-4c36-9e7b-e7c08025e04e`); a `428`, a `400` naming the app, or an empty result on a site that should have content means it is not there. [List Installed Apps](../app-installation/list-installed-apps.md) shows what the site has; [Install Wix Apps](../app-installation/install-wix-apps.md) adds it by that id.


Use the [Change a Site's Regional Properties (Currency, Time Zone, Language) via Site Properties API](../site-properties/change-payment-currency-site-properties.md) recipe to set the requested payment currency and read it back. Confirm the change with the user before updating it.

Catalog product responses may temporarily show the previous currency after carts and checkout use the new one. Allow time for propagation, then recheck.
