---
name: "Donations Experience"
description: The donor-facing design and copy bar for a Wix Donations site, covering cause discovery, campaign pages, accessible giving forms, recurring intent, draft recovery, truthful progress and checkout returns. Read when building or wiring a donation experience; the API contract lives in how-to-code-donations.md.
---
**EXPERIENCE OVERLAY**: What makes a donation experience good — read after the general `DESIGN.md` and `CONTENT.md` when using those guides.

Read alongside [How to Code Donations](how-to-code-donations.md). These are defaults, not
a prescribed design: the user's brief wins. Configure campaigns only when asked; presentation must
follow their live settings. These principles are framework- and hosting-independent; this is a
Headless experience, not instructions to install an Editor widget.

## Design from the cause

Inspect campaign count, names, imagery, amounts/impact text, frequencies, goals and giving rules
before choosing layout and tokens. Use the organization's supplied story and brand to choose a
distinctive visual direction; “nonprofit” does not imply one palette, stock photograph or page formula.
Treat approved imagery with dignity; do not present generated beneficiaries or events as documentary
evidence. The campaign entity has no story field; keep authored narrative separate from its data.

- **Homepage:** explain who is helped, what the organization does and one clear route to give in the
  first screen. Follow with the content that earns the decision: a real featured cause, supplied impact
  explanations, a story, or verified trust information. A single-cause site need not invent a campaign
  gallery. Distinguish receiving help, volunteering, sponsorship and merchandise from donating.
- **Several campaigns:** offer meaningful discovery with image, name, optional real progress, status
  and a direct campaign link. Keep cards aligned with long names and missing images. One campaign
  can open directly at `/donate`; do not add an unnecessary selection step. On phones, keep the
  introduction and covers compact enough that the first cause's name and entry point appear in the
  first screen, not just a large image. This is discovery, not a second homepage hero.
- **Campaign page:** show the cause, concise context and giving form together. On phones, bound the
  image and long story: at about 390px wide, the first screen should expose the cause, the start of
  amount/frequency selection and a clear Donate action. Let longer choices/details scroll rather
  than shrinking every control to fit. On desktop a side-by-side layout is useful, not mandatory.
  Keep readable type and price labels without clipping.
  Use real missing/archived states; never silently substitute another cause.

## Make the giving decision clear

- Show configured presets and their impact text. Offer custom giving only when enabled, and expose
  its actual bounds near the field. Validate empty, invalid, non-positive and out-of-range input; show
  errors after interaction/attempt, retain the donor's work and prevent handoff until corrected.
- Offer only configured frequencies. Use clearly selected, keyboard-operable controls; even when
  only one frequency exists, make a recurring commitment explicit. Amount shortcuts must preserve
  their advertised amount and cadence; no silent conversion from one-time to monthly. Carry explicit
  monthly-giving intent through discovery into the selected campaign's form when offered; later
  donor edits take precedence. Explain an unavailable frequency instead of silently substituting it.
- Prefer native radios with a shared name and a fieldset/legend for amount and frequency choices.
  Custom radios must implement labelled groups, arrow-key navigation, selection and visible focus.
  Associate errors/hints with their inputs and focus the first invalid control after an attempted
  submission, not on every keystroke. See [form feedback](https://www.w3.org/WAI/tutorials/forms/notifications/).
- Show currency and the selected amount/frequency in the primary action or its adjacent summary.
  Fee coverage, when enabled, is visible, reversible and explained beside its checkbox, including its
  recurring effect. Use the catalog fee flag, not a second local surcharge. Totals must agree at checkout.
- Show a note only when enabled. A contextual dedication label is useful only when the control and
  its persistence work; free text is not tribute notification or a restricted fund. Do not collect the
  donor's billing/payment data again when hosted checkout already owns that step.
- One Donate action owns the pending/redirect flow. Disable repeated activation, show progress and a
  recoverable error. No merchandise-cart drawer or cart-page detour is required for direct giving.

## Preserve the donor's work

Restore a per-campaign draft after navigation, refresh and checkout cancellation: preset/custom mode,
amount, frequency, fee choice and note. Scope short-lived, per-tab state to the content site, visitor
and campaign; keep notes out of URLs, logs and long-lived storage. Revalidate restored choices against
current campaign settings and show a correction when necessary; do not silently replace an amount or
cadence. Expire drafts and clear them on explicit reset, visitor change or verified completion. A
checkout return alone is neither completion nor a reason to reset the form.

## Progress and confidence without invented claims

Use goals and metrics only when configured and readable. No goal means no progress module. A failed
metrics read is not zero donations; omit unavailable figures while keeping the form usable. Counts
are donations, not unique donors. A bar stays within its track above 100%, while the real number may
exceed the goal. Let the API's status/acceptance rules decide closure, not an inferred percentage.

Use organization-supplied identity, contact, policies and substantiated claims. Do not invent tax
deductibility, matching grants, certifications, urgency, donors, receipts or outcomes. For recurring
giving, include the actual cancellation/help route or policy when supplied; no nonfunctional “manage
subscription” control. Keep offline giving and other support paths secondary and accurately labeled.
Avoid unsolicited signup/promotional popups that interrupt giving. Metadata, social links and policy
destinations must belong to the organization, with no template placeholders. Give each campaign its
own title, description and sharing image from its name and approved content, not a repeated generic
homepage description. Do not invent a campaign SEO API field.

## Finish the whole donor journey

Verify loading, empty, closed, missing, invalid, submitting, failed and return states, not only the
happy-path screenshot. Test desktop, a common phone width (around 390px) and a narrow phone (320px),
including long campaign names, header/logo/CTA fit, discovery density, form controls and focus/error
states. No horizontal overflow or clipped actions; do not just hide overflow. A sticky region must
not cover controls; any modal/sheet needs scroll and focus management. Follow a monthly entry link
through cause selection, then test custom amount + fee + note → checkout → cancel/back; choices must
survive. Check refresh recovery too, without submitting a payment.

Check the anonymous API → hosted-checkout handoff as required by the integration recipe. Verify that
the checkout names the right cause and commitment. On return, show paid/order facts only when
verified with appropriate access; an abandoned flow or direct thank-you visit is not proof of payment.
Keep a generic acknowledgement when order details cannot be read. Do not claim a tax receipt or
successful payment from the URL alone. Even an unverified return needs a meaningful heading, a clear
verification-status message and a useful next step, not an empty page or a disclaimer alone. Verify
hosted checkout separately from the custom form; qualify a desktop-viewport-only mobile check and
confirm suspected hosted rendering problems on a real mobile browser. No live payment without
explicit authorization.
