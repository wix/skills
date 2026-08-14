# Design — default visual quality bar for the built frontend (managed create)

**Applies when this skill builds the frontend from scratch** (managed `create`, `CREATE.md` §4). It does **not** apply to `connect`/`iterate` — there the design already exists (brought in by the user), and the job is wiring, not designing (`CONNECT.md` §4).

**This is a fallback, not an override.** It fills the gap **only when the user gave no design direction of their own** — no palette, no "make it dark/minimal/playful," no reference site or screenshot, no brand guidelines. The moment the user specifies *any* of that, their explicit intent wins outright — don't apply a rule below just because it's here if it contradicts what they asked for. Two exceptions that hold regardless of what's requested: **§3 (accessibility)** is a hard floor — if a user-requested palette fails contrast, fix the specific pair to comply, don't ship a violation — and the **anti-genericism intent** of §1 (derive tokens from *this* brand, don't reuse the last project's look) still applies even when the user supplied their own palette/theme, since it's about not being lazy with *their* inputs, not about overriding them.

This is the **agent's own design-tokens contract** — it's the thing `IMAGE_GENERATION.md` and `DISCOVERY.md` §4 already assume exists when they say a themed-block fallback "follows the site's own design tokens (palette, radius, spacing)". Decide the tokens below *before* writing the first component; every page and fallback then draws from that one decision instead of improvising per-component.

## 1 · Decide the design tokens once, before any component

A short, explicit decision — a few lines, not a document — derived from `brand.description`/`brand.vibe` (`DISCOVERY.md` §2):

- **Theme polarity** — light, dark, or vivid/tinted. Argue it from the business, never default to dark for "premium" (a light, high-key theme can be just as strong — e.g. healthcare/wellness usually reads better light).
- **Palette** — 2–4 hex colors, one dominant + accents drawn from **analogous hues** (adjacent on the color wheel, ~30° arc) — not complementary jumps. Functional colors (error/success/warning) sit outside this count.
- **Type scale** — one heading scale + one body size. Body text floor: **16px, 1.5 line-height** (§3 is non-negotiable, this is where you set it).
- **Radius + spacing** — pick once (e.g. "12px radius, 24px section padding") and reuse everywhere; don't let each component invent its own.

Hold these as the run's design tokens. Reuse them literally in the themed-block fallback (`IMAGE_GENERATION.md`) and every page — don't re-derive per page.

**Vary this across projects.** Don't reach for the same palette/theme/layout on every build — derive it from *this* brand's vibe each time. Repeating the same look across unrelated projects is a failure mode, not a shortcut.

## 2 · Layout (hard rules)

- **Full-bleed, not boxed.** Don't wrap the page in a narrow centered container (no `max-w-4xl mx-auto` outer shell). Design for the full viewport; use the peripheral space intentionally.
- **One primary CTA per page**, worded to the page's actual action — `Book a Table`, `Add to Cart`, `Reserve Your Spot`, not generic verbs ("Submit", "Click here", "Go").
- **Icons never sit on a filled/tinted background shell** — no circle/square/pill behind a nav or card icon. The glyph renders directly on the surface.
- **Identify the site's 3–4 core pages/sections from its resolved vertical** (`verticals[]`, `DISCOVERY.md` §1) before laying out anything, and design each to its own intent:

  | Vertical | Core pages/sections to get right |
  |---|---|
  | stores | Home hero, product grid, product detail, cart |
  | blog | Post list, post detail |
  | cms | Collection list, item detail |
  | forms | The form itself — clear single-column, one obvious submit |
  | events | Event list, event detail + RSVP |
  | bookings | Service list, booking widget/flow |
  | pricing-plans | Plan comparison, checkout/signup |
  | restaurants | Menu, reservation/ordering flow |
  | portfolio | Project grid, case-study/project detail |

## 3 · Accessibility (hard rules, no exceptions)

- **WCAG 2.2 AA contrast** — every chosen background/foreground pair must hit **4.5:1** for body text, **3:1** for large text (≥24px or ≥19px bold). Check the actual hex pair against the ratio — don't assume a palette is accessible because it "looks fine."
- **16px minimum body font**, **1.5 minimum line-height** for body copy.

## 4 · Content & imagery hygiene

- **No emojis** in UI copy, headings, or empty states.
- **No stock-photo clichés** — generic handshake/lightbulb/laptop-on-desk imagery reads as filler, not a real page.
- Generated imagery already carries its own purity rule (no text/logos/watermarks/UI-mockups — `IMAGE_GENERATION.md` § Prompts, "no text, no watermarks"); nothing additional to do here beyond following that section as written.

## What this doesn't cover

This is a floor, not a template library — it constrains the *how* (contrast, layout shape, token discipline), not the *what* (that's `verticals[]` + `brand` from Discovery, and the user's intent). Two builds with the same vertical and different brand vibes should still look nothing alike.
