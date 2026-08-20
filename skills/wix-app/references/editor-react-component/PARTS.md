# What Qualifies as a Part

## Step 0 — Elect the root element

The root always becomes the component's editor element: it carries the `'<component-name>'` global class and gets a name and design capabilities either way. So elect a root that deserves them, before enumerating inner parts.

- ✅ **The component reduces to one meaningful element** (a single control, link, media surface, or list) — that element **is** the root. It takes `id`, `dir`, the `fallbackDirection` class, the merged `className`, the `a11y` spread, `'<component-name>'`, and the root CSS rule. All of these are attributes and classes, so they sit on a `<button>` or `<a>` exactly as on a `<div>` — needing them is never a reason to add a wrapper.
- ✅ **The elected root is the root, not an inner part** — it carries the **unprefixed** `'<component-name>'` class and gets no `elementProps` entry. A single-control component therefore has exactly one named part: its root.
- ❌ **Wrapper `<div>` holding only root plumbing** — the editor element is then a transparent box and the real element is demoted to a nested part. A root wrapper is justified only when it lays out two or more sibling parts, is the sizing/scroll/clipping container, or hosts a root-level prop-triggered state ([`DESIGN-STATES.md`](DESIGN-STATES.md) §5). Anchoring absolutely positioned decoration is not a justification — `position: relative` works on any element.
- **Stutter test** — a part class repeating the component's own noun (`confetti-button-button`) means the wrapper took the root's name. Collapse it and promote the real element.

## Inner parts

A **named part** is an element that a site owner would plausibly want to control independently in the editor. Zero config scans global class names and creates an editor element for each one. Each editor element can surface:

- **CSS properties** — styling controls (fill, typography, border, etc.)
- **Data** — content bindings (text, image, link, etc.)

An element deserves its own named part if a site owner would plausibly need to independently control either its styling **or** its data/content through the editor. Every named part gets exactly one global plain string class in JSX and one corresponding CSS rule. Elements that do not qualify should not get a global class.

## Mandatory filter — apply to every candidate element

- ❌ **State or variant** (`active`, `selected`, `current`, `disabled`, `open`, `checked`) — not a part, it's a **design state** of a part. Implement it per [`DESIGN-STATES.md`](DESIGN-STATES.md): native states from interactive markup; custom states as a flat global modifier on the element's own (component-name-prefixed) class (e.g. `carousel-slide--active`, toggled in JSX) plus a `:global(.carousel-slide--active)` CSS rule. The modifier is a state, not a named part.
- ❌ **Hidden/shown state of an existing part** — the hidden and shown states of a part are not separate parts. The element itself should be a named part (so the editor can control its visibility per breakpoint); creating an additional part to represent its hidden or shown variant is wrong.
- ❌ **Pure grouping wrapper** — not a part. A `<div>` whose only role is to hold already-named siblings has no independent editor surface; let layout live in the parent's CSS.
- ❌ **Child with no independent editor surface** — not a part if its styling and data are already fully owned by the parent. This applies regardless of how many siblings it has. Two ways a child's editor surface can already be covered by the parent: (1) its CSS properties are inherited or set via the parent's rule; (2) its data is defined on the parent. **Canonical example:** an `<img>` inside a carousel slide whose `src` and `alt` come from the parent slide's data, and whose visual properties (object-fit, border-radius) could equally be set on the slide's own CSS rule — the slide already owns both data and styling, so the `<img>` is not a named part. Use a CSS module class for any structural CSS it needs. **Exception — interactive HTML elements (`<button>`, `<a>`, `<input>`) are never excluded by this criterion.** They always carry an independent styling surface: background, border, border-radius, interaction states, color, and typography are all meaningfully tunable per element in the editor. Apply this exclusion only to purely static structural elements (layout wrappers, grouping containers, decorative dividers). This makes an interactive element a named part **when it is an inner element** — if it is the elected root (Step 0), it is already named by `'<component-name>'` and must not be given a prefixed inner-part class as well.
- ❌ **Positional duplicate** — not separate parts. Elements that are semantically identical and differ only in position (e.g. prev/next buttons) are one part; differentiate position with CSS (`:first-of-type` / `:last-of-type`, `data-` attribute, or `:nth-child`).
- ✅ **Passes all checks** — a named part. Classify as **Semantic** (needs `elementProps`: data, behavior, direction, event handlers) or **Styling-only** (CSS class is sufficient).

## Sanity check — apply after producing the parts list

Before finalising, verify each proposed part against its parent:

> Would the editor controls generated for this part be a strict subset of its parent's controls?

If yes — the part adds no independent editor surface and should be removed. This catches rationalisation after-the-fact ("the parent *could* expose this CSS property too, but so could the child separately"). When in doubt, fewer parts is usually better.

Then run the same question in reverse, on the root: if the root has exactly one child part and no editor surface of its own, it is a plumbing wrapper — delete it and promote the child per Step 0.
