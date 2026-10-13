---
name: "Change Store Currency"
description: "Changes the store's payment currency through Site Properties and explains delayed currency updates in catalog responses."
---

# Change Store Currency

> These calls need the Wix Stores app on the site; a `428`, a `400` naming the app, or an empty result on a site that should have content means it is not there. [Read Account or Site Context](../sites/read-site-context.md) shows the installed apps in one call; [Install Wix Apps](../app-installation/install-wix-apps.md) adds it.


Use the [Change a Site's Regional Properties (Currency, Time Zone, Language) via Site Properties API](../site-properties/change-payment-currency-site-properties.md) recipe to set the requested payment currency and read it back. Confirm the change with the user before updating it.

Catalog product responses may temporarily show the previous currency after carts and checkout use the new one. Allow time for propagation, then recheck.
