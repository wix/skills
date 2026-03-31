---
name: wix-headless-designer
description: "Use when designing the visual identity, brand, and UI of a Wix Managed Headless site. Triggers: design my site, brand, style, redesign, restyle, change the look, colors, fonts, typography, visual, theme, dark mode, landing page design, make it look, aesthetic."
---

# Wix Headless Designer — Brand Discovery & Visual Design

Owns the complete visual layer of a Wix Managed Headless site: brand discovery, design system, page layouts, and component styling. Creates all pages and components as fully designed `.astro` files with typed props — ready for the features skill to wire up with SDK data.

## When This Skill Triggers

| Trigger | Example |
|---------|---------|
| After scaffolding in the solution-architect flow | Automatic handoff from solution-architect → CLI → designer |
| Design request | "Design my site", "I want a modern dark look" |
| Brand/style questions | "What fonts should I use?", "Change the color scheme" |
| Redesign/restyle | "Redesign the homepage", "Make it more premium" |
| New page design | "Add a landing page for our product launch" |
| Visual updates | "Update the product cards to be more visual" |

## When NOT to Use This Skill

| Scenario | Use Instead |
|----------|------------|
| Wire components to SDK data | `wix-headless-features-orchestrator` |
| Add interactivity (cart, forms, auth) | `wix-headless-features-orchestrator` |
| Scaffold or deploy | `wix-headless-cli` |

## Scope Boundaries — CRITICAL

**This skill writes `.astro` files with placeholder content. That is ALL it does.**

Design DOES create feature-aware visual structure:
- Props interfaces matching the data shapes features will pass
- Designated mount areas for React islands (purchase area, availability picker, etc.)
- `<style is:global>` blocks with styling contracts for all React island components
- Feature-specific visual elements (variant pills, stock badges, time slots) with placeholder state

DO NOT:
- **Load or invoke other skills** (features, manage, SDK, etc.) during the design flow
- **Call MCP tools to query, create, update, or delete site data** (products, collections, orders, blog posts, etc.). Exception: Wix Media import for decorative images (Step 2b) IS allowed.
- **Generate images for products or site data** (product photos, blog covers) — that happens during the features phase. Decorative site images (hero backgrounds, about page photos) ARE allowed — see Step 2b.
- **Import or use Wix SDK** packages — components are pure presentation with typed `Props`
- **Touch the live Wix site** data — no querying, creating, or mutating products, blog posts, orders, etc.

The design skill produces **static visual mockups** using hardcoded sample data in `.astro` files. Real data comes later when the features skill wires up SDK queries. Site data management (creating products, uploading images) is done via the Wix dashboard.

If the user asks you to also set up real products or manage site data during design, tell them that's a separate step handled after design is approved — they can use the Wix dashboard to manage site data.

---

## Design Thinking

Before writing any code, understand the context and commit to a **BOLD** aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick a clear direction — brutally minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian. Use these for inspiration but design one that is true to the brand.
- **Constraints**: Astro components, Tailwind CSS, Wix project structure, CSS-first animations.
- **Differentiation**: What makes this site UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

---

## Frontend Aesthetics Guidelines

### Typography
Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial, Inter, and Roboto — opt for distinctive, characterful choices. Pair a distinctive display font with a refined body font. Import via Google Fonts or similar CDN.

### Color & Theme
Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Choose a **dominant page color mode** — predominantly dark or predominantly light — and apply it consistently across all pages unless a hybrid strategy is explicitly declared.

### Cross-Page Visual Continuity

Before designing any pages, declare one of these **page color strategies** and document it as a CSS comment at the top of `global.css`:

| Strategy | Rule |
|----------|------|
| **Uniform Light** | Every page uses light backgrounds (`--color-bg`, `--color-bg-alt`). Dark sections are accents within pages, not full-page switches. |
| **Uniform Dark** | Every page uses dark backgrounds (`--color-bg-dark`, `--color-secondary`). Light elements are inline accents only. |
| **Defined Hybrid** | Explicitly assign each page a mode (e.g., "Home = dark, Shop = light, About = dark"). Document the mapping in the CSS comment. Transition pages must share nav/footer styling. |

```css
/* Page Color Strategy: Uniform Dark
   All pages use dark backgrounds. Nav and footer use the dark variant.
   Accent sections may use --color-bg-alt for contrast within dark context. */
```

**Step 3 checklist — verify before finalizing:**
- [ ] Every page uses the declared strategy (no accidental light page in a dark site)
- [ ] Navigation and Footer use the same variant on all pages
- [ ] Transitions between pages feel cohesive — no jarring color shifts
- [ ] If hybrid: each page's mode matches the documented mapping

### Motion
Use animations for effects and micro-interactions. Prioritize CSS-only solutions for Astro. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (`animation-delay`) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.

### Spatial Composition
Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density — match the aesthetic direction.

### Backgrounds & Visual Details
Create atmosphere and depth. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, and grain overlays.

### Anti-Patterns (NEVER do these)
- Generic AI-generated aesthetics (the "safe, clean, modern" default)
- Overused font families (Inter, Roboto, Arial, system fonts)
- Cliched color schemes (purple gradients on white backgrounds)
- Predictable layouts and cookie-cutter component patterns
- Converging on the same choices across different projects (e.g., always Space Grotesk)
- Earthy green defaults with neutral grays — every site must have its OWN palette

### Match Complexity to Vision
Maximalist designs need elaborate code with extensive animations. Minimalist designs need restraint, precision, and careful attention to spacing and typography.

---

## Design Flow

### Interaction Rules

- **One step at a time** — complete each step before moving to the next
- **Use `AskUserQuestion`** for structured choices (brand assets)
- **Use natural conversation** for open-ended topics (brand personality, inspiration)
- **Never ask more than 3 questions at once** in a single interaction
- **Interpret, don't delegate** — don't ask the user to pick from a list of styles. Propose a distinctive direction based on what you learn (like a real designer would).
- **Skip what's already known** — if solution-architect already captured brand info, don't re-ask

### Step 1: Brand Discovery

Learn the brand — name, personality, values, audience, and any existing assets.

**If coming from the solution-architect flow**, you already know:
- Business type and name
- Functional plan (apps, pages, capabilities)

Ask via natural conversation + `AskUserQuestion`:

1. *"Describe your brand's personality — who are your customers and what feeling should the site give them?"*
2. `AskUserQuestion`: *"Do you have existing brand assets?"*
   - Yes, I have brand guidelines (hex codes, fonts, logo)
   - Just a logo
   - Starting fresh — design everything for me
3. Follow up naturally if they have assets: *"Share your hex codes, font names, or logo file."*

**Then commit to a BOLD aesthetic direction** based on brand + business type + audience. Present your creative direction to the user in 2–3 sentences — don't ask them to choose from options. Example:

> *"For Bloom & Root, I'm going with an organic editorial aesthetic — think Kinfolk magazine meets a botanical garden. Warm cream backgrounds, deep forest green accents, Playfair Display for headings paired with Source Sans 3 for body text. Subtle leaf-pattern overlays and generous whitespace to let the products breathe."*

**STOP — user approval required.** Use `AskUserQuestion` to ask the user if they're happy with this creative direction before proceeding to Step 2. Do not continue until the user confirms. Offer these options:
- Love it, let's go
- I'd like some tweaks (describe what to change)
- Try a completely different direction

**Standalone use** (no solution-architect flow): If the user invokes designer directly on an existing project, read the current `global.css`, `Layout.astro`, and a few pages to understand the existing state before proposing changes.

### Step 2: Design System

Create the design tokens and foundational components:

**`src/styles/global.css`** — CSS variables with distinctive font imports:
```css
@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=DISPLAY+FONT&family=BODY+FONT&display=swap');

:root {
  /* Brand colors */
  --color-primary: #...;
  --color-secondary: #...;
  --color-accent: #...;
  --color-bg: #...;
  --color-bg-alt: #...;
  --color-text: #...;
  --color-text-muted: #...;

  /* Typography */
  --font-display: "Display Font", serif;
  --font-body: "Body Font", sans-serif;

  /* Spacing */
  --space-section: 5rem;
  --space-content: 2rem;

  /* Radii */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 1rem;

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.1);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
}

/* Global reset and base styles */
body {
  font-family: var(--font-body);
  color: var(--color-text);
  background: var(--color-bg);
}

h1, h2, h3, h4 {
  font-family: var(--font-display);
}
```

Customize ALL values based on the brand direction. Never use the template values above verbatim.

> **Tailwind v4 setup:** The `@import "tailwindcss"` directive above uses Tailwind v4 syntax. After writing `global.css`, add the Tailwind Vite plugin to `astro.config.mjs`:
> ```js
> import tailwindcss from "@tailwindcss/vite";
> // inside defineConfig:
> vite: { plugins: [tailwindcss()] }
> ```
> The packages `tailwindcss` and `@tailwindcss/vite` are installed later in the features orchestrator's single batch npm install.

**`src/layouts/Layout.astro`** — Document structure with font imports, global transitions, and meta:
```astro
---
interface Props {
  title: string;
  description?: string;
}

const { title, description = "Site description" } = Astro.props;
---

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="description" content={description} />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>

<style is:global>
  @import "../styles/global.css";
</style>
```

**`src/components/Navigation.astro`** — Branded header/nav with personality. Include links to planned pages.

**`src/components/Footer.astro`** — Branded footer matching the design system.

### Step 2b: Generate Decorative Images

After creating the design system and before designing pages, generate on-brand decorative images for the site (hero backgrounds, about page photos, section imagery). These images bring the design to life — placeholder divs are a fallback, not the default.

Follow `../shared/IMAGE_GENERATION.md` (Steps 1–3) to get the API key, generate each image, and import to Wix Media. Use the `file.url` (wixstatic URL) returned from the import.

If the user declines to provide a key, use placeholder `<div>` elements
styled with brand colors instead.

**Prompt templates — decorative images:**

- **Hero sections**: "Atmospheric [BRAND AESTHETIC] photograph
  capturing [BRAND MOOD/PERSONALITY]. Color palette:
  [PRIMARY] and [ACCENT COLORS]. [Composition style matching
  the design direction]. Wide cinematic format, no text"

- **About pages**: "[BUSINESS TYPE] workspace/environment
  reflecting [BRAND PERSONALITY]. Authentic editorial feel
  using [BRAND COLOR TONES]. No text, no watermarks"

- **Section backgrounds**: "Abstract [BRAND AESTHETIC]
  texture using [BRAND PALETTE: primary #XXX, accent #XXX].
  Seamless, subtle, suitable as background overlay"

**Using images in `.astro` files** — reference the wixstatic URL directly:

```html
<!-- In <img> tags -->
<img src="https://static.wixstatic.com/media/..." alt="Hero" />

<!-- In CSS background-image -->
<style>
  .hero { background-image: url('https://static.wixstatic.com/media/...'); }
</style>
```

### Step 2c: Read Component Patterns

**Before designing any components**, read `references/COMPONENT_PATTERNS.md`. This file defines the required class names for all components that will become React islands (forms, purchase areas, cart, FAQ accordion, etc.). You MUST use the documented class names — the feature skills hardcode these class names in their React islands, so if you invent different names, all interactive component styling breaks silently.

### Step 3: Design All Pages and Components

Using the functional plan (from solution-architect, or from the user's request), design **EVERY** page and component. Each is a complete `.astro` file with:

- Full HTML structure with brand-consistent styling
- `Props` interface for the data it will receive (typed for SDK data shapes)
- Placeholder/sample content for visual review
- Motion and micro-interactions where appropriate (CSS animations, transitions)
- Responsive design (mobile-first)

**Components use typed props but don't import SDK** — they're pure presentation. Example:

```astro
---
// src/components/ProductCard.astro
interface Props {
  name: string;
  price: string;
  imageUrl?: string;
  slug: string;
}

const { name, price, imageUrl, slug } = Astro.props;
---

<a href={`/products/${slug}`} class="product-card group">
  <div class="product-card__image">
    {imageUrl ? (
      <img src={imageUrl} alt={name} loading="lazy" />
    ) : (
      <div class="product-card__placeholder" />
    )}
  </div>
  <div class="product-card__info">
    <h3>{name}</h3>
    <span class="product-card__price">{price}</span>
  </div>
</a>

<style>
  .product-card { /* Brand-specific styling with transitions */ }
  .product-card:hover { /* Hover effect matching the aesthetic */ }
  /* ... */
</style>
```

**What to create for each capability:**

| Capability | Components | Pages | React Islands (`is:global` required) |
|-----------|------------|-------|--------------------------------------|
| All sites | Navigation, Footer, Hero, Section | `index.astro` (home) | CartBadge (in nav slot) |
| Stores | ProductCard, ProductGrid, ProductDetail, CartDrawer, CartItem | `products/index.astro`, `products/[slug].astro`, `cart.astro`, `thank-you.astro` | ProductPurchase, CartView, CartBadge |
| Forms | ContactForm (layout + styled fields) | `contact.astro` | ContactForm |
| Blog | BlogCard, BlogGrid | `blog/index.astro`, `blog/[...slug].astro` | RicosViewer (via BlogPost layout) |
| CMS | Per use case components | Per use case pages | FaqAccordion, ImageGallery (if applicable) |
| Static pages | (uses Section, Hero) | `about.astro`, etc. — see `references/STATIC_PAGE.md` | — |

**Form styling contracts:** When designing form placeholders (ContactForm, WaitlistForm, etc.), document the CSS class names used in the component as a "styling contract". The features skill must preserve these class names when converting the placeholder to a React island, so the page's `<style>` block continues to apply. Add a comment at the top of the form component listing the contract classes:

```astro
<!-- Styling contract: .form-container, .form-field, .form-label, .form-input, .form-button, .form-success, .form-error, .form-field-error, .form-input-error -->
```

**Form styling requirements — CRITICAL for dark-site visibility:**

1. **`<style is:global>` is mandatory for form components.** Astro scoped styles use `data-astro-cid-*` attributes that won't transfer to React island DOM. When the forms skill replaces the placeholder with `<ContactForm client:load>`, scoped styles silently stop applying. Always use `<style is:global>` for form styling blocks.
2. **Input background: `var(--color-bg-alt)` — NEVER `var(--color-bg)`.** On dark sites, `--color-bg` matches the page background, making inputs completely invisible (dark input on dark page). `--color-bg-alt` provides guaranteed contrast.
3. **Input border: use `color-mix(in srgb, var(--color-text) 30%, transparent)`.** This is visible on both dark and light backgrounds without hardcoding a color value.
4. **Buttons must always have explicit `background`, `padding`, and `border-radius`.** Never leave form buttons as unstyled text — they become invisible on dark backgrounds.
5. **Reference implementation:** See `references/COMPONENT_PATTERNS.md` → Contact Form for the complete pattern with correct styles.

**Blog content styling requirements — CRITICAL for dark-site visibility:**

1. **`<style is:global>` is mandatory for blog post layouts.** RicosViewer is a React island (`client:only="react"`). Astro scoped styles use `data-astro-cid-*` attributes that won't transfer to React-rendered DOM. Without `is:global`, all blog content styles silently vanish.
2. **Ricos elements must be forced to `var(--color-text)` with `!important`.** The `@wix/ricos` library CSS hardcodes `color: rgb(0, 0, 0)` on paragraphs, list items, and spans via minified class names. On dark themes, this makes blog text invisible. Target `.ricos-content` and its children with `!important` overrides.
3. **Blog pages must use design system variables** — `var(--color-text)`, `var(--color-text-muted)`, `var(--color-bg-alt)`, `var(--color-accent)`. Never use `rgb(var(--gray-dark))`, `rgb(var(--gray))`, `rgb(var(--black))`, or similar non-existent variables.
4. **Reference implementation:** See the blog skill's `references/BLOG_PAGES.md` → BlogPost layout for the complete pattern with correct `is:global` styles and Ricos overrides.

**Styling contract pattern — ALL React islands:** The ContactForm styling contract pattern applies to every component that will become a React island. For each such component, design must:
1. Add a `<!-- Styling contract: .class-a, .class-b, ... -->` comment
2. Use `<style is:global>` with CSS variables exclusively
3. Include states: default, hover, focus, disabled, loading, selected (as applicable)
4. See `references/COMPONENT_PATTERNS.md` for the complete pattern per component type

**Pages include placeholder content** that looks realistic — sample product names, prices, descriptions, blog titles, service names. This lets the user preview the visual design before real data is connected.

### Step 4: Visual Review → Features Handoff

After designing all pages and components:

1. Present a summary of what was created — list all files with a brief description
2. Note the design direction and key visual choices
3. **Lifecycle logging:** Append a `### designer` phase entry to `.wix/lifecycle.log.md` per `../shared/LIFECYCLE_LOG.md` (direction, pages designed, components, decorative images, timestamps)
4. **Invoke the features orchestrator skill:**
   ```
   Skill: wix-headless:wix-headless-features-orchestrator
   ```
   Pass these details in the args:
   - Business type and brand name
   - Functional plan (apps, pages, CMS collections with fields)
   - Project directory path
   - Site/business ID
   - List of designed components and their styling contracts

**Do NOT invoke `wix-headless-cli` or individual feature skills directly.**
The features orchestrator is the ONLY valid entry point for feature work.

Do not ask for approval or wait for the user to invoke the next skill. The transition from design to features requires no user input.

---

## Component Design Principles

### Props as API Contract

Every component defines a clear `Props` interface that describes the data it needs. This creates a contract between design and features:

```typescript
// Design creates:
interface Props {
  name: string;
  price: string;          // Formatted price string
  imageUrl?: string;      // Wix CDN URL
  slug: string;           // URL-safe identifier
  inStock?: boolean;      // Availability indicator
}

// Features later passes:
<ProductCard
  name={product.name}
  price={`$${product.price.formatted.price}`}
  imageUrl={product.media?.mainMedia?.image?.url}
  slug={product.slug}
  inStock={product.stock?.inStock}
/>
```

### Placeholder Content Pattern

Use realistic sample data in pages so the design is reviewable:

```astro
---
// src/pages/products/index.astro (design phase — placeholder content)
import Layout from "../../layouts/Layout.astro";
import Navigation from "../../components/Navigation.astro";
import Footer from "../../components/Footer.astro";
import ProductGrid from "../../components/ProductGrid.astro";

// Placeholder products for visual review
const sampleProducts = [
  { name: "Ceramic Vase", price: "$48.00", slug: "ceramic-vase", imageUrl: undefined },
  { name: "Linen Throw", price: "$65.00", slug: "linen-throw", imageUrl: undefined },
  { name: "Oak Shelf", price: "$120.00", slug: "oak-shelf", imageUrl: undefined },
];
---

<Layout title="Products">
  <Navigation />
  <main>
    <ProductGrid products={sampleProducts} />
  </main>
  <Footer />
</Layout>
```

Features later replaces the `sampleProducts` array with real SDK queries.

### Animation Patterns

Prefer CSS-only solutions for Astro compatibility:

```css
/* Staggered reveal on page load */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.reveal {
  animation: fadeInUp 0.6s ease-out forwards;
  opacity: 0;
}

.reveal:nth-child(1) { animation-delay: 0.1s; }
.reveal:nth-child(2) { animation-delay: 0.2s; }
.reveal:nth-child(3) { animation-delay: 0.3s; }
```

For scroll-triggered animations, use Astro `<script>` tags with `IntersectionObserver`.

---

## Standalone Design (No Discover Flow)

When invoked directly on an existing project:

1. **Read current state** — check `global.css`, `Layout.astro`, existing pages/components
2. **Understand the scope** — is this a full redesign or targeted update?
3. **Follow Steps 1–4** as needed — skip what's already established

For targeted updates (e.g., "redesign the product cards"):
- Read the existing component
- Understand its props interface (don't break the API)
- Redesign the visual treatment while preserving the data contract

---

## Non-Matching Intents

## References

| Reference | What It Covers |
|-----------|---------------|
| `../shared/IMAGE_GENERATION.md` | AI image generation for decorative/layout images |

## Non-Matching Intents

| User Wants | Redirect To |
|-----------|------------|
| Wire components to real data / SDK integration | `wix-headless-features-orchestrator` |
| Build a new site from scratch (no project exists) | `wix-headless-solution-architect` |
| Scaffold or deploy | `wix-headless-cli` |
| Build, validate, and deploy a preview | `wix-headless-cli` |
