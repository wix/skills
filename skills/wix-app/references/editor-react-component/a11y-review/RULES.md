# Automated Scanner Rules

This file describes the automated scanner scope for both Tier 0 (ESLint) and Tier 1 (custom). It is not the full accessibility-review scope of the skill — Tier 2 semantic review covers additional checks.

---

## Tier 0: ESLint jsx-a11y Rules

Tier 0 runs `eslint-plugin-jsx-a11y` via the ESLint Node API. It operates on individual files without cross-file resolution. Findings on native elements are high-signal; findings on custom components may need manual verification.

### Interaction and keyboard rules (not covered by Tier 1)

| Rule | What it catches |
|------|----------------|
| `jsx-a11y/click-events-have-key-events` | Click handlers without keyboard listeners |
| `jsx-a11y/mouse-events-have-key-events` | Mouse hover/out without focus/blur equivalents |
| `jsx-a11y/no-static-element-interactions` | Static elements (`div`, `span`) with event handlers but no role |
| `jsx-a11y/no-noninteractive-element-interactions` | Non-interactive elements (`li`, `section`) with event handlers |
| `jsx-a11y/interactive-supports-focus` | Interactive-role elements missing focusability |
| `jsx-a11y/no-noninteractive-tabindex` | `tabIndex` on non-interactive elements without interactive role |
| `jsx-a11y/tabindex-no-positive` | Positive `tabIndex` values that break natural tab order |
| `jsx-a11y/no-access-key` | `accessKey` prop usage (inconsistent across browsers) |
| `jsx-a11y/no-autofocus` | `autoFocus` prop usage |

### Label and content rules (not covered by Tier 1)

| Rule | What it catches |
|------|----------------|
| `jsx-a11y/anchor-has-content` | Anchors without accessible text content |
| `jsx-a11y/heading-has-content` | Heading elements without accessible text content |
| `jsx-a11y/iframe-has-title` | Iframes missing `title` attribute |
| `jsx-a11y/img-redundant-alt` | Image alt text containing "image", "photo", "picture" |
| `jsx-a11y/label-has-associated-control` | Labels not programmatically associated with a form control |
| `jsx-a11y/media-has-caption` | Audio/video elements missing captions |
| `jsx-a11y/control-has-associated-label` | Interactive controls without accessible labels |

### Role and ARIA rules (overlap with Tier 1, but with additional checks)

| Rule | What it catches |
|------|----------------|
| `jsx-a11y/aria-activedescendant-has-tabindex` | `aria-activedescendant` without `tabIndex` |
| `jsx-a11y/aria-proptypes` | ARIA attribute values with wrong types |
| `jsx-a11y/role-has-required-aria-props` | Roles missing required ARIA attributes |
| `jsx-a11y/role-supports-aria-props` | ARIA attributes not supported by the element's role |
| `jsx-a11y/no-aria-hidden-on-focusable` | `aria-hidden` on focusable elements |
| `jsx-a11y/prefer-tag-over-role` | Using `role` when a native semantic element exists |
| `jsx-a11y/scope` | `scope` attribute on non-`th` elements |

### Structural rules (not covered by Tier 1)

| Rule | What it catches |
|------|----------------|
| `jsx-a11y/no-interactive-element-to-noninteractive-role` | Interactive elements assigned non-interactive roles |
| `jsx-a11y/no-noninteractive-element-to-interactive-role` | Non-interactive elements assigned interactive roles |
| `jsx-a11y/no-redundant-roles` | Redundant roles matching the element's implicit role |
| `jsx-a11y/no-distracting-elements` | `<marquee>` and `<blink>` usage |

### Rules that overlap with Tier 1

These rules are also checked by the custom scanner. When both flag the same location, prefer the finding with richer context (typically Tier 1 for cross-file resolution, Tier 0 for additional detail).

| Tier 0 rule | Tier 1 equivalent |
|-------------|-------------------|
| `jsx-a11y/alt-text` | `alt-text` |
| `jsx-a11y/anchor-is-valid` | `anchor-is-valid` |
| `jsx-a11y/aria-props` | `aria-props` |
| `jsx-a11y/aria-role` | `aria-role` |
| `jsx-a11y/aria-unsupported-elements` | `aria-unsupported-elements` |

---

## Tier 1: Custom Scanner Rules

The custom scanner checks five code-level rule families with cross-file semantic resolution.

## `alt-text`

Flag image-like elements that are missing `alt`.

- Native tags: `img`
- Inferred component cases: components resolved or inferred as image-like
- Valid cases:
  - `alt="Meaningful text"`
  - `alt=""` for decorative images

## `anchor-is-valid`

Flag link-like elements that are missing valid navigation targets.

- Native tags: `a`
- Inferred component cases: wrappers or library components resolved as anchor-like
- Invalid cases:
  - missing `href`
  - `href="#"`, empty string, or `javascript:void(0)`

## `aria-props`

Flag invalid `aria-*` attribute names on JSX elements.

- Focus on invalid attribute names, not value validation
- Example: `aria-labeledby` is invalid; `aria-labelledby` is valid

## `aria-role`

Flag invalid `role` attribute values.

- Only static string role values can be validated with confidence
- Dynamic expressions are not definite violations by themselves

## `aria-unsupported-elements`

Flag ARIA attributes on unsupported native elements such as:

- `meta`
- `script`
- `style`
- `head`
- `html`
- `base`
- `link`
- `param`
- `source`
- `track`
- `col`
- `colgroup`

This rule is high-confidence when the element is native. Custom components are only in scope if their implementation clearly resolves to one of these unsupported elements.
