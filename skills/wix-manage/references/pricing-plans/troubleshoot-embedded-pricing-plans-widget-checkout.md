---
name: "Troubleshoot Embedded Pricing Plans Widget Checkout"
description: "Explains where a Plan List or Single Plan widget sends visitors when it's added to a page other than the Plans & Pricing page, and diagnoses the two most common support complaints that follow: (1) selecting a plan always leaves the current page instead of checking out in place, and (2) the Plans & Pricing page shows the full plan list stacked above checkout, or the checkout section disappeared after removing a plan-list element. Use when a site owner asks why their embedded plan widget doesn't check out on the same page, or reports a confusing double plan-list/checkout layout."
---
# Troubleshoot Embedded Pricing Plans Widget Checkout

Wix Pricing Plans lets a site owner add a **Plan List** or **Single Plan** widget to *any* page — not just the automatically-created **Plans & Pricing** page — via **Add Elements > Payments** in the Editor, or via the pricing plan element's **Settings > Add-Ons > "Add to page"** panel. This is by design and documented in [Displaying Plans on Multiple Site Pages](https://support.wix.com/en/article/pricing-plans-displaying-plans-on-multiple-site-pages) — a common use case is putting a plan or plan list directly on a service page so it's visible next to the relevant content.

This recipe covers the two support questions that come up once a widget has been added to a non-system page.

## When to use

- Owner added a Plan List or Single Plan widget to a custom page (e.g. a service page) and asks why clicking **Select**/**Buy** navigates away instead of completing checkout right there → [Checkout always happens on the Plans & Pricing page](#checkout-always-happens-on-the-plans--pricing-page).
- Owner reports the **Plans & Pricing** page (or its checkout/payment step) shows the **full list of plans stacked above the checkout form**, creating a confusing double-selection experience → [Diagnosing a duplicated plan list above checkout](#diagnosing-a-duplicated-plan-list-above-checkout).
- Owner tried to remove "the plan list" from the Plans & Pricing page in the Editor and the **checkout/payment section disappeared too** → [Why deleting the wrong element removes checkout](#why-deleting-the-wrong-element-removes-checkout).

> **No API covers any of this.** There is no REST endpoint to read a page's element/widget composition or to change checkout navigation behavior — this is Editor/Viewer layout, not a settable API property. Don't call or invent an endpoint for it; the fixes below are Editor actions you talk the owner through.

---

## Checkout always happens on the Plans & Pricing page

This is expected, current platform behavior, not a bug or a missing setting: **selecting a plan on a Plan List or Single Plan widget always navigates the visitor to the site's built-in Plans & Pricing page to complete checkout**, even when the widget the visitor clicked on lives on a completely different page (e.g. a service page). There is currently no supported way to make an embedded widget complete checkout in place on the page it's on.

- This applies uniformly, regardless of which page the widget was added to.
- The widget on the custom page is only ever a *preview/entry point* — the actual purchase flow (login/guest details, plan summary, payment) always renders on the Plans & Pricing page.

**What to tell the owner:** this isn't something to configure differently — it's how the checkout flow works today. If the goal was a single-page, in-context purchase experience, that isn't currently possible with the built-in Plan List/Single Plan widgets; the realistic options are to accept the redirect (most visitors expect a distinct checkout step) or simplify the custom page to a lightweight "starting at $X — see plans" teaser that links to Plans & Pricing, rather than a full interactive picker.

---

## Diagnosing a duplicated plan list above checkout

The Plans & Pricing page's own built-in pricing element is a **single widget** that shows either the plan list *or* the checkout/payment step, depending on where the visitor is in the flow — never both at once. So if a visitor reports seeing the full list of plans (or a row of plan/billing-cycle tabs) rendered **above** the checkout form on that same page, that extra list is almost always a **second, separately-added** Plan List or Single Plan widget sitting on the Plans & Pricing page itself — not the built-in element misbehaving.

This typically happens when the "Add to page" panel (see [Displaying Plans on Multiple Site Pages](https://support.wix.com/en/article/pricing-plans-displaying-plans-on-multiple-site-pages)) was used to add a plan list to "more pages" and the Plans & Pricing page was accidentally included, or a plan list was manually dragged onto that page from **Add Elements > Payments**.

**How to guide the owner to confirm and fix it:**
1. Open the Editor and go to the Plans & Pricing page.
2. Look for **more than one** pricing-plan element stacked on the page — typically the extra one sits above or below the main pricing element and looks like a plain plan list or plan cards, without a "system page" indicator.
3. Select and delete only the **extra**, manually-added element. Leave the original pricing element (the one the page came with) alone.
4. Republish and re-test the checkout flow to confirm the list no longer appears above checkout.

If, after checking, there really is only one pricing element on the page and the list and checkout are still shown together, that's outside this recipe's known cause — treat it as a genuine product bug and escalate through standard Wix support channels rather than trying to fix it via the widget's design/layout settings.

---

## Why deleting the wrong element removes checkout

The Plans & Pricing page's built-in pricing element is **one single widget instance** that renders the plan list in its default state and switches to rendering checkout once a visitor picks a plan — it is not two separate widgets glued together. That means **deleting the built-in pricing element to "just keep checkout"** removes the same widget that would have rendered checkout too — there's no way to keep only the checkout half of that single element.

**What this means in practice:** if an owner deleted the plan list element from the Plans & Pricing page and checkout disappeared from the Editor view, that's expected — they deleted the whole element, not just its list view. The fix is to undo the deletion (or re-add the pricing element from **Add Elements > Payments**) rather than looking for a way to restore "just checkout."

This is also why [the duplicated-list scenario above](#diagnosing-a-duplicated-plan-list-above-checkout) explicitly says to delete only the *extra* element and leave the original one in place — deleting the wrong one reproduces this exact problem.

## Gotchas

- **Don't try to "fix" checkout navigation via settings.** There's no toggle for in-place checkout on embedded Plan List/Single Plan widgets — it's a platform limitation, not a misconfiguration.
- **A plan list next to checkout on the Plans & Pricing page is a duplicate-widget symptom, not a rendering bug**, unless you've confirmed only one pricing element exists on that page.
- **The built-in pricing element is one widget with two views (list, checkout), not two widgets.** Deleting it to "simplify" the page removes checkout too.
- **There's no API for any of this** — page/element composition isn't queryable or settable through the Pricing Plans REST API. Guide the owner through the Editor directly.

## See also

- [About Pricing Plans Pages](https://support.wix.com/en/article/pricing-plans-about-pricing-plans-pages)
- [Displaying Plans on Multiple Site Pages](https://support.wix.com/en/article/pricing-plans-displaying-plans-on-multiple-site-pages)
- [Create and Update Pricing Plans](create-and-update-pricing-plans.md)
