# Fix Strategies

This document describes how to fix each Tier 1 rule family. Apply these strategies only to findings with `high` or `medium` confidence. `low` confidence findings require reading the code first -- fix only when the semantic guess is confirmed.

## General Principles

- Read the surrounding code before editing. The scanner finding provides location and evidence, but the fix depends on context.
- Preserve existing behavior. A fix must not change what sighted users see or how the component functions.
- Prefer the simplest correct fix. Do not refactor unrelated code while fixing an a11y issue.
- **Call site vs definition**: When a wrapper hides the underlying element, decide where to fix:
  - If the wrapper already accepts and forwards the missing prop (e.g., via spread), add the prop at the call site.
  - If the wrapper does NOT accept or forward the missing prop, fix the wrapper definition to accept and forward it, then add the prop at the call site.
  - If you are writing the component definition itself, the fix is to add the prop to the interface and forward it. Do not hardcode accessibility values (like alt text) inside reusable components -- they should come from the consumer.

## `alt-text`

### Native `<img>`

Add an `alt` prop with descriptive text. If the image is decorative, use `alt=""`.

```tsx
// Before
<img src={photoUrl} />

// After (meaningful)
<img src={photoUrl} alt="Product photo" />

// After (decorative)
<img src={photoUrl} alt="" />
```

### How to decide meaningful vs decorative

- If the image conveys information not available from surrounding text, it is meaningful.
- If the image is purely visual (decorative border, background pattern, icon next to visible label text), it is decorative.
- When uncertain, default to meaningful with a descriptive alt. A redundant alt is better than a missing one.

### Wrapper components

When the finding is on a wrapper component (not a native `<img>`), the fix depends on whether the wrapper already accepts and forwards `alt`.

**Step 1: Check the wrapper definition.** Read the component source to see if it accepts `alt` in its props and passes it to the underlying `<img>`.

**If the wrapper already forwards `alt`**, add the prop at the call site:

```tsx
// Wrapper already forwards alt via spread or explicit prop
export const ProductPhoto = (props) => <img {...props} />;

// Before (call site)
<ProductPhoto src={photoUrl} />

// After (call site)
<ProductPhoto src={photoUrl} alt="Blue running shoes" />
```

**If the wrapper does NOT forward `alt`**, fix the wrapper definition to accept and forward it, then add the prop at the call site:

```tsx
// Before (wrapper)
export const ProductPhoto = ({ src }) => <img src={src} />;

// After (wrapper -- add alt to destructured props and forward it)
export const ProductPhoto = ({ src, alt }) => <img src={src} alt={alt} />;

// Then at the call site
<ProductPhoto src={photoUrl} alt="Blue running shoes" />
```

**If you are writing the component itself** (the finding is inside the component definition, not at a call site), the fix is to ensure the component accepts `alt` in its props interface and passes it through to the underlying `<img>`:

```tsx
// Before
const Avatar = ({ src }: { src: string }) => <img src={src} />;

// After
const Avatar = ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />;
```

Do not hardcode alt text inside a reusable component. The alt value should come from the consumer.

## `anchor-is-valid`

### Missing `href`

If the element is meant to navigate, add a real `href`. If it is meant to trigger an action, change it to a `<button>`.

```tsx
// Before (should navigate)
<a onClick={goToPage}>About</a>

// After
<a href="/about">About</a>

// Before (should trigger action)
<a onClick={handleClick}>Save</a>

// After
<button onClick={handleClick}>Save</button>
```

### `href="#"` or `href="javascript:void(0)"`

Replace with a real href or convert to a button. Never leave `href="#"` as a fix.

```tsx
// Before
<a href="#">Learn more</a>

// After (if it navigates)
<a href="/learn-more">Learn more</a>

// After (if it triggers an action)
<button onClick={handleLearnMore}>Learn more</button>
```

### Wrapper components

Check the wrapper definition first:

- **If the wrapper forwards `href`**: fix the `href` value at the call site.
- **If the wrapper does not accept or forward `href`**: fix the wrapper to accept it, then provide a valid value at the call site.
- **If you are writing the wrapper itself**: ensure it accepts `href` in its props and passes it to the underlying `<a>`.

## `aria-props`

### Invalid attribute name

Replace the misspelled ARIA attribute with the correct spelling. Common typos:

| Wrong | Correct |
|-------|---------|
| `aria-labeledby` | `aria-labelledby` |
| `aria-role` | `role` |
| `aria-roledescribedby` | `aria-roledescription` |

```tsx
// Before
<div aria-labeledby="title">Content</div>

// After
<div aria-labelledby="title">Content</div>
```

## `aria-role`

### Invalid role value

Replace the invalid role with a valid ARIA role or remove it if no role is needed.

```tsx
// Before
<div role="container">Content</div>

// After (if it's a generic grouping)
<div role="group">Content</div>

// After (if no role is needed)
<div>Content</div>
```

When choosing a replacement role, read the component's purpose. Do not guess -- pick the role that matches the actual behavior.

## `aria-unsupported-elements`

### ARIA on unsupported elements

Remove the ARIA attributes from the unsupported element. If the intent was to label or describe something, move the ARIA attributes to a supported element that wraps or replaces the unsupported one.

```tsx
// Before
<meta aria-label="description" />

// After
<meta />
```

If the ARIA attribute was meaningful (e.g., on a `<link>` that should have been an `<a>`), change the element to the correct semantic one.

## Tier 2 Fixes

Tier 2 findings are discovered during the semantic review, not by the scanner. Apply fixes based on the specific checklist item:

- **Missing accessible name on icon-only controls**: Add `aria-label` or visually hidden text.
- **ARIA on wrong element**: Move the attribute to the semantically correct inner element.
- **`display: none` hiding accessible content**: Switch to a visually-hidden CSS class or `aria-hidden` as appropriate.
- **Interactive element missing keyboard support**: Add `role`, `tabIndex`, and keyboard event handlers as needed. **Before applying this fix, run the pre-fix checks below.**

For Tier 2, always read the code and confirm the issue before fixing. These are not scanner-automated and require judgment.

### Pre-fix checks for adding button semantics to a non-interactive element

When the fix involves adding `role="button"`, `tabIndex`, and keyboard handlers to a `<div>` or similar element, verify each of these before writing code. Skipping any check can introduce a new violation while fixing the original one.

1. **Check for interactive children.** If the element conditionally or unconditionally contains `<a>`, `<button>`, `<input>`, or components that resolve to them (such as a `<Link>` component), adding `role="button"` to the parent creates nested interactive content. This is a WCAG violation and confuses keyboard navigation and screen readers. In this case:
   - Exclude the interactive-child branch from button semantics (e.g., `const isClickable = animated && !link`).
   - Or use a separate `<button>` element for the toggle action instead of overloading the wrapper.

2. **Check for existing `tabIndex` management.** If the same element already receives `tabIndex` from another source — such as a utility function (`getTabIndexAttribute`), a framework-level a11y spread, or an interactions hook — adding `tabIndex: 0` in the fix creates a conflict. Determine the spread/prop merge order and ensure only one source wins. Prefer letting the existing a11y-driven tabIndex remain authoritative; only set `tabIndex: 0` as a fallback when no other source provides it.

3. **Audit the gating condition.** Read the boolean expression that controls whether the element is interactive (e.g., `const isClickable = animated && !forceReducedMotion`). Verify:
   - Does the condition use explicit comparison (`=== undefined`, `=== true`) rather than truthiness when the variable's type includes semantically distinct values like `true | undefined` or `true | false | undefined`?
   - Does the condition correctly exclude states where the element should not be interactive (editor preview, link-present case, externally controlled state)?
   - If the condition is wrong, fix it as part of the a11y fix — a correct `role="button"` on a wrongly-activated element is still a bug.

4. **Scope `aria-label` correctly.** If the element has an accessible label (e.g., from `a11y.label`), decide whether the label names the interactive behavior specifically or the component as a whole. If it names the component, apply it outside the clickable conditional so it persists in non-interactive states. If it names the button action specifically, apply it inside the conditional.
