---
name: composer-spec
description: "Specification for scripts/compose.mjs — the deterministic Composer of the wix-headless design-system phase. RETIRED as a dispatched subagent: this is no longer an instruction file handed to an LLM. It documents how compose.mjs applies the Designer's framework-agnostic spec to the astro frontend by SUBSTITUTING into pinned skeletons at references/astro/templates/ — mapping semantic token values to the @theme vocabulary, writing the 6 design-system files (global.css, astro.config.mjs, Layout.astro, Navigation.astro, Footer.astro, index.astro), owning the component-CSS token contract (every var(--token) a components-<pack>.css references must resolve), and emitting a manifest. The skeleton comments and BUILD-astro.md reference the section headings here."
---

# Composer spec — how the design becomes code

> **RETIRED as a dispatched subagent.** The Composer is now the deterministic script **`scripts/compose.mjs`**, run as a `Bash` step in the design-system bridge (`BUILD-astro.md` § "2. Design-system bridge"). This file is retained as the human-readable **spec** for that script — the substitution rules, token contract, self-checks, and anti-patterns below describe what `compose.mjs` does, and the pinned skeletons + `BUILD-astro.md` cite its section headings. It is no longer opened by an LLM. The authoritative implementation is the script; if the two ever diverge, the script wins. **Why a script, not a subagent:** the work is mechanical `{{slot}}` substitution into pinned skeletons — an LLM re-emits the ~580 lines of fixed bulk every run (median ~188 s, 4× variance across 40 runs). The script does it sub-second, byte-reproducibly.

The Designer decides *what the brand looks like* and returns it as a framework-agnostic spec. `compose.mjs` decides *how that becomes code* for the **astro** frontend: it maps the spec onto the framework's token vocabulary and **substitutes it into pinned skeletons**. It does **not** re-author the fixed bulk — the View-Transitions script, the view-transition / `.nav-progress` CSS, the `@utility btn` family, the `process.env` fix, the markers — all of that is literal in the skeletons. Read a skeleton, fill its `{{…}}` slots, write the file. Substitute; do not re-write.

> **Framework:** astro only. The skeletons live at `<SKILL_ROOT>/references/astro/templates/`. Custom (non-astro) frontends never reach `compose.mjs` — integration mode (`frontend === "custom"`) connects a brought-in site via `references/custom/` and does not run it at all. The orchestrator only invokes `compose.mjs` when `frontendBuild === "wix"`.

## Reference contract (what the script is built against)

`compose.mjs` reads `<SKILL_ROOT>/references/shared/STYLING.md` § "Required tokens — the component-CSS template contract" (the token set it must guarantee) and emits the manifest shape defined in `<SKILL_ROOT>/references/shared/RETURN_CONTRACT.md`. No REST, no MCP, no `.wix/site.json` read — frontend-only, every input on stdin.

## Inputs (the compose-input JSON on stdin; project dir as `argv[2]`)

- **`tokenSource`** — `"json"` (default) reads tokens from `designTokens` below; `"designmd"` reads them from a portable **`DESIGN.md`** frontmatter (the file `emit-design-tokens.mjs` projects from the same spec), at `designMdPath` or `<project-dir>/DESIGN.md`.
- **`designMdPath`** — optional DESIGN.md path (when `tokenSource: "designmd"`).
- **`designTokens`** — the Designer's spec (`colors`, `fonts`, `spacing`, `radii`, `containers`; optional `googleFontsHref`), bare-key form. Used when `tokenSource` is `"json"`.
- **`shell`** — brand-voice strings: `heroHeadline`, `heroSub`, `footerTagline`, `navBrandMark`. (Kept on the compose input, **not** in DESIGN.md — shell is content, not design tokens; DESIGN.md stays pure tokens.)
- **`brand`** — `{ name, description }`.
- **`navLinks`** — JSON array of `{href, label}`. Labels used **verbatim**.
- **`loadedPacks`**, **`packsWithComponents`**, **`disabledPacks`** — string arrays.
- **Project directory** — `argv[2]` (the scaffold subdir).

### DESIGN.md as the token source (the portable artifact)

`emit-design-tokens.mjs` projects the Designer's spec into a standard **`DESIGN.md`** ([design.md](https://github.com/google-labs-code/design.md) frontmatter): wix tokens map onto DESIGN.md's groups — `colors` → `colors`, `fonts` → `typography` (`fontFamily` per level), `spacing` → `spacing`, `radii` → `rounded`, `containers` → a custom `containers` group, `googleFontsHref` → a custom key. Token keys stay the wix editorial names (`paper`/`ink`/`accent`/…), which are valid DESIGN.md color names — **lossless, no role round-trip** (the JSON and DESIGN.md paths produce byte-identical output).

When `tokenSource: "designmd"`, `compose.mjs` parses **frontmatter only** (the markdown body is documentation, never read) and applies a **role-translation table** so a DESIGN.md authored with *standard* roles is also consumable:

| DESIGN.md role | wix `--color-*` | | DESIGN.md role | wix `--color-*` |
|---|---|---|---|---|
| `primary` | `accent` | | `surface` / `background` | `paper` |
| `secondary` | `paper-warm` | | `on-surface` / `on-background` | `ink` |
| `tertiary` | `ink-soft` | | `outline` | `rule` |
| `neutral` | `mute` | | `error` | `error` |

Keys not in the table (the wix-native names) pass through unchanged and win on conflict. `rounded` → radii; the custom `containers` group + `googleFontsHref` are honored. The required-token contract + derivation fail-safe then run exactly as for the JSON path.

## What you write (the 6 files)

Read each skeleton from `<SKILL_ROOT>/references/astro/templates/`, substitute, write to the project. The fixed bulk in every skeleton is literal — change only the documented `{{…}}` slots.

> **Implementation note (script-handled).** `compose.mjs` resolves the skeleton paths relative to its own location (`../references/astro/templates/`) and reads each of the six by exact filename — no directory read, no harness `Write`/`Read` ordering to manage. Of the six destinations only `astro.config.mjs` is read from the scaffold (it is a **merge** target, not a clobber); the other five are full writes. The script briefly retries reading `astro.config.mjs` if the scaffold is still in flight, then fails loud with `SCAFFOLD_NOT_COMPLETE` — but the bridge only invokes it after Setup Step 1 has verified the scaffold, so that path is belt-and-braces.

### Token contract (do this first — it gates everything)

Map the Designer's `designTokens` into the `@theme` palette that goes in `global.css`, and **guarantee every required token resolves**. Per `STYLING.md` § "Required tokens", the `components-<pack>.css` templates reference a fixed set via `var(--token)`. Your `@theme` MUST declare all of:

- `--color-{paper,paper-warm,ink,mute,rule,accent}` (required), `--color-{ink-soft,cream,error}` (recommended).
- `--font-{display,body}`.
- the full `--spacing-{2xs,xs,sm,md,lg,xl,2xl,3xl,4xl}` scale.
- `--radius-{sm,md}` (required), `--radius-{lg,xl}` (recommended).
- a **container scale** separate from spacing: `--container-{prose,md,3xl,6xl}` minimum.

If the Designer's spec is missing a required role, **derive** a sensible value (e.g. `ink-soft` ≈ `ink` lightened, `paper-warm` ≈ `paper` warmed) rather than dropping the token — a missing required token renders components unstyled. Map each group with the fixed prefix: `colors.<k>` → `--color-<k>`, `fonts.<k>` → `--font-<k>`, `spacing.<k>` → `--spacing-<k>`, `radii.<k>` → `--radius-<k>`, `containers.<k>` → `--container-<k>`.

> **Container ≠ spacing.** Tailwind v4 maps `max-w-3xl` → `var(--container-3xl)`, not `var(--spacing-3xl)`. Never set a `--container-*` to a spacing value — a reading column is ~`42rem`, not `5rem`, or pages collapse to one word per line.

### 1. `global.css`

Substitute the `{{theme}}` block in the skeleton with the `@theme` palette you built above — every `--color-*`, `--font-*`, `--spacing-*`, `--container-*`, `--radius-*` line. **Everything else in the skeleton is literal** (the `@utility container-reading`/`btn`, base layer, button family, decorative + site-shell + view-transition + nav-submenu + category-rail CSS). Do not add component-specific classes (`.product-card`, `.cart-summary`, …) — those live in `components-<pack>.css`, owned by Phase 3.

### 2. `astro.config.mjs`

This is a **merge, not a clobber** — the scaffold's config varies. Read the scaffold's `astro.config.mjs` and apply exactly two mutations (the skeleton shows the target shape):
1. Register the Tailwind v4 Vite plugin: `import tailwindcss from "@tailwindcss/vite";` and merge `tailwindcss()` into `vite.plugins` (preserve any existing `vite` settings — `server.allowedHosts`, etc.).
2. Fix the bare `process.env` line (`const isBuild = process.env.NODE_ENV == "production";`) to the `globalThis` guard so strict `tsc --noEmit` passes without `@types/node`.

### 3. `Layout.astro`

Fully replace the scaffold stub. Substitute:
- `{{components-css-imports}}` — one `import '../styles/components-<pack>.css';` per pack in **"Packs with components"**, in that order. Packs without components (e.g. `cms`) get **no** import — importing a file no agent writes breaks the build. If "Packs with components" is empty, remove the placeholder line entirely.
- `{{fonts.googleHref}}` — the Google Fonts stylesheet href for the chosen `display` + `body` families (e.g. `https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@...&family=Inter:wght@400;500;600&display=swap`). If both fonts are system fonts, remove the `<link rel="stylesheet">` line.
- `{{brand.name}}` — the default `<title>`.

The View-Transitions `<script>`, the `nav-progress` div, the `ClientRouter`, the `Props` interface, and the `hasSeoTags` pattern are **literal** — keep them.

### 4. `Navigation.astro`

Substitute `{{shell.navBrandMark}}` and `{{nav.links}}` (one `<li class="site-nav-item"><a href={href}>{label}</a></li>` per inlined nav link, labels **verbatim** — no editorial rebrands like "Journal" for `/about`). Keep the `<!-- nav:links -->` marker, the empty `<div class="nav-actions">`, the `transition:persist`, and the hamburger literal. Do **not** add `/products`, cart, login, or account links — packs splice those at the marker in Phase 4.

### 5. `Footer.astro`

Substitute `{{brand.name}}`, `{{shell.footerTagline}}`, and `{{nav.links}}` (mirror/subset of the same array, labels verbatim). Keep `transition:persist` literal.

### 6. `index.astro`

Substitute `{{shell.heroHeadline}}`, `{{shell.heroSub}}`, `{{brand.name}}`, and `{{home-markers}}`. For `{{home-markers}}`, emit one `<!-- home:<pack> -->` marker per **loaded pack that contributes a home section** (today: `stores`, `gift-cards`). Emit a marker **only** for such packs — never one no pack will fill (no `<!-- home:cms -->`; CMS owns brand-story directly, which the skeleton already renders). Keep the hero + brand-story structure and both `data-decorative-slot` placeholders literal and **empty** (the orchestrator injects `<img>` after Image Phase 1).

## Disabled-pack discipline

A pack in **"Disabled packs"** (today: only `gift-cards`) ships dormant. Its `<!-- home:<pack> -->` / `<!-- nav:links -->` markers are the **only** acceptable touchpoints. Do **not** add hero CTAs, footer links, brand-story callouts, or any other entry point pointing at a disabled pack's route — users click through to a feature that does not exist yet. Treat disabled packs as code-only: they appear in your marker emission, never in visible UI you author.

## Self-checks before returning

1. **Component-CSS imports.** For every pack in "Packs with components", grep your written `Layout.astro` for `components-<pack>.css`. If any is missing, add it. If unrecoverable, return `status: "partial"` with `errors: [{code: "MISSING_COMPONENT_CSS_IMPORT", pack: "<name>"}]`. (The orchestrator also re-verifies this after you return — at the seed gate — but catch it here.)
2. **Required-token coverage.** Confirm every required token from the contract above is present in the `@theme` block you wrote. A missing one renders components unstyled.
3. **Container vs spacing.** Confirm no `--container-*` was set to a spacing value.
4. **Marker hygiene.** No marker emitted for a pack that does not contribute; both decorative slots present and empty.

If a check fails and you cannot fix it, return `status: "partial"` with the specific `errors` code rather than shipping silently.

## Return contract

`compose.mjs` prints a single manifest JSON object to **stdout** (diagnostics go to stderr). The orchestrator parses it from stdout exactly as it parsed the subagent's return — same `{ status, phase: "compose", data, files }` shape per `<SKILL_ROOT>/references/shared/RETURN_CONTRACT.md`. On a self-check failure the status is `partial` and `errors` carries the specific code (`MISSING_REQUIRED_TOKEN`, `CONTAINER_EQUALS_SPACING`); on a hard failure (`SCAFFOLD_NOT_COMPLETE`, a missing config anchor like `ANCHOR_VITE` / `ANCHOR_PROCESS_ENV`, `TEMPLATE_MISSING`) it prints a `failed` manifest and exits 1. A manifest of what it wrote:

```json
{
  "status": "complete",
  "phase": "compose",
  "data": {
    "filesWritten": [
      "src/styles/global.css",
      "astro.config.mjs",
      "src/layouts/Layout.astro",
      "src/components/Navigation.astro",
      "src/components/Footer.astro",
      "src/pages/index.astro"
    ],
    "componentCssImports": ["stores", "ecom"],
    "homeMarkers": ["home:stores"],
    "tokensApplied": { "colors": 9, "spacing": 9, "containers": 4, "radii": 2, "fonts": 2 }
  },
  "files": [ "...same as filesWritten..." ]
}
```

## Anti-patterns (the failure modes the script structurally avoids)

| WRONG | CORRECT |
|---|---|
| Re-author the View-Transitions script, btn family, or view-transition CSS | Keep the skeleton bulk literal; substitute only `{{…}}` slots |
| Rewrite `global.css` from scratch to "clean it up" | Substitute `{{theme}}`; the rest is pinned (this is the variance win) |
| Overwrite `astro.config.mjs` with the skeleton verbatim | Merge the two mutations into the scaffold's own config (anchored codemod) |
| `import '../styles/components-cms.css'` (cms has no components) | One import only per pack in `packsWithComponents` |
| Drop a required token because the Designer omitted it | Derive a sensible value — required tokens must resolve |
| Set `--container-3xl` to `--spacing-3xl`'s value | Containers are widths (~`42rem`+), a separate axis from spacing |
| Coin label rebrands ("Journal" → /about) or add `/products`/cart links | Nav labels verbatim; packs splice their links at the marker |
| Add a hero CTA / footer link to a disabled-pack route | Disabled packs are code-only — markers are the sole touchpoint |
| Emit `<!-- home:cms -->` or a marker for a non-contributing pack | One marker per contributing loaded pack only |
| Silently produce a broken config when an anchor is missing | Fail loud (`ANCHOR_VITE` / `ANCHOR_PROCESS_ENV`), exit 1 |
| Invoke for a non-astro / custom frontend | astro only; the orchestrator gates on `frontendBuild === "wix"` |
