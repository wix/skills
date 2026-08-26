# Browser Support

Which CSS features and DOM APIs an Editor React Component may use. This is about
support in the visitor's browser, a separate question from whether an API exists
during server rendering.

## The rule

**Use only features at Baseline "Widely Available", or ones that fall back to it** —
supported for 30+ months in every browser [Wix
supports](https://support.wix.com/en/article/supported-devices-browsers-and-operating-systems):
Chrome (desktop + Android), Edge, Firefox (desktop + Android), Safari (macOS +
iOS/iPadOS).

A fallback must genuinely degrade rather than break: the unsupported path still
has to render a usable component.

## Deciding, without looking it up

These rules resolve nearly everything. Stop at the first step that answers:

1. **Named literally in the skill or repository instructions?** → pre-authorized:
   use it, no warning. A string test, not a judgment call — `@property` in your
   instructions authorizes it, a general endorsement of modern CSS authorizes
   nothing. A feature named only in the *user's* request is **not** pre-authorized;
   run the steps below, then the [insist protocol](#insist-protocol).
2. **Date arithmetic.** Subtract 30 months from today's real date. Was it already
   shipping in every browser above by then? Mobile lags — iOS Safari and Firefox
   Android are the usual holdouts.
3. **Smell test**, when that's inconclusive. Widely Available means *boring* for 2.5
   years. Learned it as "the modern way", or would enjoy showing it off → no. Plain
   CSS or DOM you'd have written five years ago → yes. Called "now Baseline"
   anywhere → that phrasing marks *newly* available → no.
4. **Still unsure → not permitted.** Permitting wrongly ships a component that is
   broken for real visitors; denying wrongly costs only a slightly plainer
   implementation the user can ask you to change.

Search only when it earns the cost — the user asks about support directly, or the
feature is central enough that deny-and-offer would waste a real round trip. Prefer
fetching an MDN or caniuse page over driving a browser.

**Standing exception:** `@property` is always fine for design tokens, generated or
hand-written — rewriting a token registration, or warning about one, breaks the
component.

**Feels new, is not** — run the arithmetic, not the reputation: `:has()`,
`@container` size queries, `subgrid`, `color-mix()`, `inert`,
`Array.prototype.toSorted`.

## Insist protocol

1. **Build the widely-supported alternative** by default. Don't ask first, and don't
   leave the component unbuilt.
2. **Use the feature only if the user then asks for it explicitly**, and guard it so
   it degrades rather than breaks — `@supports` for CSS, `CSS.supports()` or a
   capability check for JS.
