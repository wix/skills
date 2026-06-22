# DESIGN.md — the design-token format (vendored spec)

`DESIGN.md` is the **single design artifact** of the wix-headless design-system phase. The Designer authors it; `emit-design-tokens.mjs` writes it + projects `.wix/design-tokens.css` and `.wix/site.d.ts` from it; `compose.mjs` reads its **frontmatter** to write the astro design-system files. It is the standalone, framework-agnostic spec a non-astro frontend, a human, or another tool can read.

This file is the **canonical spec inside the skill** — the public DESIGN.md frontmatter format (the `design.md` spec, captured here) plus the small, documented extensions this skill uses. Do not depend on the external `design.md` project at runtime.

## Frontmatter structure

A `DESIGN.md` file is YAML frontmatter delimited by `---`, optionally followed by a free-form markdown body:

```yaml
---
version: alpha          # optional
name: <string>          # the brand / design-system name
colors:
  <token-name>: <Color>
typography:
  <token-name>:
    fontFamily: <string>
    fontSize: <Dimension>        # optional (unused by this skill)
    fontWeight: <number>         # optional
    lineHeight: <Dimension|number>  # optional
    letterSpacing: <Dimension>   # optional
rounded:                # corner radii (DESIGN.md's name for radius tokens)
  <scale-level>: <Dimension>
containers:             # EXTENSION (this skill): content/reading widths
  <scale-level>: <Dimension>
googleFontsHref: <string>   # EXTENSION (this skill): the ready Google Fonts <link> href
---

# free-form body — documentation only, NEVER parsed
```

### Value types

- **Color** — any valid CSS color string (hex `#RRGGBB`, `rgb()`, `hsl()`, named). **Quote hex values** — an unquoted `#hex` after `: ` is a YAML comment.
- **Dimension** — a string with a unit suffix: `px`, `em`, `rem` (e.g. `"1rem"`, `16px`).
- **Token reference** — `{path.to.value}` (curly-brace object path into the YAML tree).

## How this skill uses it

### Frontmatter only is canonical

`compose.mjs` and `emit-design-tokens.mjs` read the **frontmatter only**. The markdown body is documentation and is **never parsed** — so a generated `DESIGN.md` can carry a minimal or empty body without affecting the build, and run-to-run body variance never reaches the output.

### Token vocabulary (the groups this skill consumes)

| DESIGN.md group | wix CSS projection | Notes |
|---|---|---|
| `colors` | `--color-<key>` | semantic role keys (see color roles below) |
| `typography.<level>.fontFamily` | `--font-<level>` | `display` + `body` required; `mono` optional |
| `rounded` | `--radius-<key>` | `sm` + `md` required |
| `containers` | `--container-<key>` | **extension** — content widths, a separate axis from spacing (`prose, md, 3xl, 6xl`) |
| `googleFontsHref` | the Layout `<link>` href | **extension** — the ready stylesheet URL for the chosen families |

> **Spacing is not a DESIGN.md token.** The build uses Tailwind v4's built-in numeric spacing scale directly (`gap-4`, `py-24`, `px-6`, …). A named `--spacing-<size>` scale was removed because its t-shirt names (`md`, `3xl`, …) collided with the width utilities (`max-w-3xl` resolved to `--spacing-3xl` instead of `--container-3xl`). Do not author a `spacing` group.

### Color roles — wix-native keys are the contract

The skill's component-CSS templates reference a fixed set of `--color-*` names (`STYLING.md` § "Required tokens"). So the **canonical color token keys in our DESIGN.md are the wix editorial roles** — and these are valid DESIGN.md color token names (the format leaves token names free-form):

`paper` (primary background), `paper-warm` (secondary surface), `ink` (primary text / dark fills), `ink-soft`, `mute` (muted text), `rule` (borders / dividers), `accent` (brand emphasis), `cream`, `error`.

`paper`, `paper-warm`, `ink`, `mute`, `rule`, `accent` are **required**; `ink-soft`, `cream`, `error` recommended (derived as a fail-safe if absent).

### Standard-role compatibility (reading an externally-authored DESIGN.md)

A DESIGN.md authored elsewhere may use the DESIGN.md spec's *common* semantic roles instead of the wix-native keys. `compose.mjs` carries a **role-translation table** so such a file is still consumable; wix-native keys are not in the table and pass through unchanged (winning on conflict):

| standard role | → wix `--color-*` | | standard role | → wix `--color-*` |
|---|---|---|---|---|
| `primary` | `accent` | | `surface` / `background` | `paper` |
| `secondary` | `paper-warm` | | `on-surface` / `on-background` | `ink` |
| `tertiary` | `ink-soft` | | `outline` | `rule` |
| `neutral` | `mute` | | `error` | `error` |

This translation is a **compatibility layer**, not the authoring path: the Designer in this skill emits the wix-native keys directly (lossless — no role round-trip), so `STYLING.md` and every `components-<pack>.css` template stay untouched.

## Producers & consumers in the run

- **Designer** (`DESIGN_SYSTEM.md`) — **authors `DESIGN.md` directly** (its frontmatter is the spec); returns only the brand-voice strings + the `DESIGN.md` path.
- **`emit-design-tokens.mjs`** — reads the Designer's `DESIGN.md` and projects `.wix/design-tokens.css` + `.wix/site.d.ts` from its frontmatter. It does **not** write `DESIGN.md` (the Designer does).
- **`compose.mjs`** — reads `DESIGN.md` frontmatter → writes the 6 astro design-system files (astro only).
- **Non-astro (`own`) frontends** — import `.wix/design-tokens.css` for the same values; component composition stays framework-native (no `compose.mjs`).
