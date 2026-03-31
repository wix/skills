# Component Patterns — Design Reference

Design patterns for common components. These show the structure and props contract — the actual styling must match the chosen aesthetic direction.

## Navigation

```astro
---
// src/components/Navigation.astro
interface Props {
  currentPath?: string;
}

const { currentPath = "" } = Astro.props;

const links = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Shop" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];
---

<header class="site-header">
  <nav class="site-nav">
    <a href="/" class="site-logo">Brand Name</a>
    <ul class="nav-links">
      {links.map(link => (
        <li>
          <a
            href={link.href}
            class:list={["nav-link", { active: currentPath === link.href }]}
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
    <!-- Cart icon slot for features to populate -->
    <div class="nav-actions">
      <slot name="actions" />
    </div>
  </nav>
</header>
```

**Design notes:**
- `links` array should match the functional plan's pages
- Include a slot for cart badge or auth buttons (features adds these later)
- Mobile hamburger menu via CSS-only or minimal `<script>`

## Hero Section

```astro
---
// src/components/Hero.astro
interface Props {
  headline: string;
  subheadline?: string;
  ctaText?: string;
  ctaLink?: string;
  secondaryCtaText?: string;
  secondaryCtaLink?: string;
  backgroundImage?: string;
}

const {
  headline,
  subheadline,
  ctaText,
  ctaLink,
  secondaryCtaText,
  secondaryCtaLink,
  backgroundImage
} = Astro.props;
---
```

**Design notes:**
- Hero is the first impression — make it count
- Full-viewport or near-full height
- Strong typography hierarchy
- At least one CTA button

## Product Card

```astro
---
// src/components/ProductCard.astro
interface Props {
  name: string;
  price: string;
  imageUrl?: string;
  slug: string;
  compareAtPrice?: string;  // Original price for sale items
  ribbon?: string;           // "Sale", "New", etc.
}
---
```

**Design notes:**
- Image aspect ratio should be consistent (4:3, 1:1, or 3:4)
- Hover effect on the image or card (zoom, shadow, overlay)
- Price styling: sale price in accent color, original price with strikethrough
- Link wraps the entire card (accessible `<a>` tag)

## Product Grid

```astro
---
// src/components/ProductGrid.astro
interface Props {
  products: Array<{
    name: string;
    price: string;
    imageUrl?: string;
    slug: string;
    compareAtPrice?: string;
    ribbon?: string;
  }>;
  columns?: 2 | 3 | 4;
}
---
```

**Design notes:**
- Responsive: 1 col mobile → 2 col tablet → 3–4 col desktop
- Consistent card sizing (avoid jagged grids)
- Consider staggered reveal animation

## Cart Drawer / Cart Page

```astro
---
// src/components/CartDrawer.astro (or cart page section)
// This component will be a React island in the features phase
// Design creates the visual template; features converts to .tsx
interface Props {
  items: Array<{
    name: string;
    price: string;
    quantity: number;
    imageUrl?: string;
  }>;
  subtotal: string;
}
---
```

**Design notes:**
- Slide-in drawer or dedicated page (match the aesthetic)
- Quantity controls (+/- buttons)
- Remove button per item
- Clear subtotal display
- Checkout CTA button prominently styled

## Contact Form

```astro
---
// src/components/ContactForm.astro
<!-- Styling contract: .form-container, .form-field, .form-label, .form-input, .form-textarea, .form-button, .form-success, .form-error, .form-field-error, .form-input-error -->
interface Props {
  formTitle?: string;
  fields?: Array<{
    name: string;
    label: string;
    type: "text" | "email" | "tel" | "textarea";
    required?: boolean;
  }>;
}

const { formTitle = "Get in Touch", fields } = Astro.props;

const defaultFields = [
  { name: "first_name", label: "Name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "message", label: "Message", type: "textarea" as const, required: true },
];

const formFields = fields || defaultFields;
---

<section class="form-container">
  <h2>{formTitle}</h2>
  <form>
    {formFields.map((field) => (
      <div class="form-field">
        <label class="form-label">
          {field.label}
          {field.required && <span class="required">*</span>}
        </label>
        {field.type === "textarea" ? (
          <textarea class="form-textarea" name={field.name} required={field.required} rows={4} />
        ) : (
          <input class="form-input" type={field.type} name={field.name} required={field.required} />
        )}
      </div>
    ))}
    <button type="submit" class="form-button">Send Message</button>
  </form>
</section>

<style is:global>
  /* is:global is REQUIRED — Astro scoped styles won't apply after the forms
     skill replaces this placeholder with a React island (<ContactForm client:load>).
     Scoped data-astro-cid-* attributes don't transfer to React-rendered DOM. */
  .form-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .form-field {
    display: flex;
    flex-direction: column;
  }
  .form-label {
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
    font-family: var(--font-body);
    color: var(--color-text);
  }
  .form-label .required {
    color: var(--color-accent);
    margin-left: 0.25rem;
  }
  .form-input,
  .form-textarea {
    width: 100%;
    padding: 0.75rem 1rem;
    /* Use --color-bg-alt, NEVER --color-bg — on dark sites --color-bg matches
       the page background, making inputs invisible */
    background: var(--color-bg-alt);
    /* Guaranteed-visible border on both dark and light backgrounds */
    border: 1px solid color-mix(in srgb, var(--color-text) 30%, transparent);
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    color: var(--color-text);
  }
  .form-input:focus,
  .form-textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent);
  }
  .form-button {
    width: 100%;
    padding: 0.75rem 1.5rem;
    background: var(--color-accent);
    color: var(--color-bg);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .form-button:hover {
    opacity: 0.9;
  }
  .form-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .form-field-error {
    font-size: 0.8125rem;
    color: var(--color-accent);
    margin-top: 0.375rem;
    font-family: var(--font-body);
  }
  .form-input-error {
    border-color: var(--color-accent);
  }
  .form-error {
    font-size: 0.875rem;
    color: var(--color-accent);
    font-family: var(--font-body);
    margin-top: 0.25rem;
  }
  .form-success {
    padding: 2rem;
    text-align: center;
    font-family: var(--font-body);
    color: var(--color-text);
  }
</style>
```

**Design notes:**
- **`<style is:global>` is required** — Astro scoped styles use `data-astro-cid-*` attributes that won't match React island DOM. Without `is:global`, all form styles vanish when the forms skill replaces this placeholder.
- **Input background uses `var(--color-bg-alt)`, NEVER `var(--color-bg)`** — on dark sites, `--color-bg` matches the page background, making inputs completely invisible. `--color-bg-alt` provides guaranteed contrast.
- **Border uses `color-mix()`** — `color-mix(in srgb, var(--color-text) 30%, transparent)` is visible on both dark and light backgrounds without hardcoding a color.
- **Button must always have `background`, `padding`, `border-radius`** — never leave buttons as unstyled text.
- **Field-level validation errors** use `.form-field-error` (message below the input) and `.form-input-error` (red border on the input). Both use `var(--color-accent)` since the design system has no dedicated error color. The forms skill adds these classes dynamically when server-side validation fails.
- Labels above or floating — match the aesthetic
- Consider input animations on focus
- Features will convert this to a React island for submission handling

## Section (Generic Content Block)

```astro
---
// src/components/Section.astro
interface Props {
  title?: string;
  subtitle?: string;
  background?: "default" | "alt" | "dark";
  align?: "left" | "center";
}
---
```

**Design notes:**
- Reusable wrapper for content sections
- Alternating backgrounds create visual rhythm
- Consistent padding matching `--space-section`

## Blog Card

```astro
---
// src/components/BlogCard.astro
interface Props {
  title: string;
  excerpt?: string;
  imageUrl?: string;
  slug: string;
  date?: string;
  author?: string;
}
---
```

**Design notes:**
- Use `var(--color-text)` for title, `var(--color-text-muted)` for date/excerpt — never `rgb(var(--gray-dark))` or similar
- Hover effect on card (shadow, translate, or opacity change)
- Image aspect ratio should be consistent (16:9 or 3:2 for blog imagery)
- Link wraps the entire card

## Blog Post Content (Ricos Viewer)

The blog post detail page renders rich content via `@wix/ricos` RicosViewer in a React island. The Ricos library CSS hardcodes `color: rgb(0, 0, 0)` on content elements, making text invisible on dark themes. The BlogPost layout must include global overrides.

```css
/* Inside <style is:global> in the BlogPost layout */
/* is:global is REQUIRED — RicosViewer is a React island (client:only="react").
   Astro scoped styles use data-astro-cid-* attributes that won't match
   React-rendered DOM. Without is:global, Ricos content styles won't apply. */
.ricos-content,
.ricos-content p,
.ricos-content li,
.ricos-content span,
.ricos-content div {
  color: var(--color-text) !important;
}
.ricos-content a {
  color: var(--color-accent) !important;
}
```

**Design notes:**
- **`<style is:global>` is required** on the BlogPost layout — same reason as Contact Form: React islands don't inherit Astro scoped styles.
- **`!important` is required** — the Ricos library uses minified class names with specificity that overrides normal CSS declarations. Without `!important`, the hardcoded `rgb(0, 0, 0)` wins.
- **`.ricos-content` wrapper** — the RicosViewer component wraps its output in a `<div className="ricos-content">` to provide this CSS hook. See `BLOG_SETUP.md` → RicosViewer wrapper.

### BlogPost Layout (Full Page Styles)

The blog post detail page also needs layout styles for the page structure — hero image, prose container, title/date area, and tags. These must be in the same `<style is:global>` block as the Ricos overrides above.

<!-- Styling contract: .hero-image, .prose, .title, .date, .last-updated-on, .tags, .tag -->

```css
/* Inside <style is:global> on the BlogPost layout — alongside the Ricos overrides above */
main {
  width: calc(100% - 2em);
  max-width: 100%;
  margin: 0;
}
.hero-image {
  width: 100%;
}
.hero-image img {
  display: block;
  margin: 0 auto;
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-md);
}
.prose {
  width: 720px;
  max-width: calc(100% - 2em);
  margin: auto;
  padding: 1em;
  color: var(--color-text);
}
.title {
  margin-bottom: 1em;
  padding: 1em 0;
  text-align: center;
  line-height: 1;
}
.title h1 {
  margin: 0 0 0.5em 0;
  font-family: var(--font-display);
}
.date {
  margin-bottom: 0.5em;
  color: var(--color-text-muted);
  font-family: var(--font-body);
}
.last-updated-on {
  font-style: italic;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.tag {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  background: var(--color-bg-alt);
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-family: var(--font-body);
}
```

**Design notes:**
- `.prose` constrains content width to ~720px for optimal readability
- Hero image spans full width with rounded corners matching the site's radius scale
- Tags use `var(--color-bg-alt)` background for subtle differentiation
- All classes share the same `<style is:global>` block as the Ricos overrides — the blog skill references this for the complete BlogPost layout

## Service Card (Bookings)

```astro
---
// src/components/ServiceCard.astro
interface Props {
  name: string;
  description?: string;
  price?: string;
  duration?: string;
  imageUrl?: string;
  slug: string;
}
---
```

**Design notes:**
- Hover effect on the card (shadow lift, border color change, or translate)
- Price formatting: display currency + value, or "Starting from" for variable pricing
- Duration badge: small pill showing service duration (e.g., "60 min") using `var(--color-bg-alt)` background
- Include a "Book Now" CTA link or arrow indicator
- Image: consistent aspect ratio (16:9 or 4:3) if service images are available
- Link wraps the entire card (accessible `<a>` tag)

## Product Purchase Area (React Island)

The product detail page purchase section — option selectors (variant pills) + add-to-cart button. This is a React island (`client:load`) that the stores skill wires to variant resolution and cart operations.

```astro
---
<!-- Styling contract: .purchase-area, .option-group, .option-label, .option-choices, .option-pill, .option-pill.selected, .add-to-cart-btn, .add-to-cart-btn:disabled, .stock-status -->
---

<div class="purchase-area">
  <!-- Placeholder: option selectors + add-to-cart -->
  <div class="option-group">
    <span class="option-label">Size</span>
    <div class="option-choices">
      <button class="option-pill">30ml</button>
      <button class="option-pill selected">50ml</button>
    </div>
  </div>
  <button class="add-to-cart-btn">Add to Cart</button>
</div>

<style is:global>
  /* is:global is REQUIRED — ProductPurchase is a React island (client:load).
     Astro scoped styles won't apply to React-rendered DOM. */
  .purchase-area {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .option-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .option-label {
    font-size: 0.8125rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: var(--font-body);
    color: var(--color-text);
  }
  .option-choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .option-pill {
    padding: 0.5rem 1rem;
    border-radius: var(--radius-md);
    border: 1.5px solid color-mix(in srgb, var(--color-text) 20%, transparent);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 0.875rem;
    font-weight: 500;
    font-family: var(--font-body);
    cursor: pointer;
    transition: all 0.15s;
  }
  .option-pill:hover {
    border-color: var(--color-text);
  }
  .option-pill.selected {
    background: var(--color-text);
    color: var(--color-bg);
    border-color: var(--color-text);
  }
  .add-to-cart-btn {
    width: 100%;
    padding: 0.75rem 1.5rem;
    background: var(--color-accent);
    color: var(--color-bg);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-weight: 500;
    font-size: 1rem;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .add-to-cart-btn:hover {
    opacity: 0.9;
  }
  .add-to-cart-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .stock-status {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    font-family: var(--font-body);
  }
</style>
```

**Design notes:**
- **`<style is:global>` is required** — same reason as ContactForm: React islands don't inherit Astro scoped styles.
- Option pills use inverted colors when selected (text color → background, background → text)
- Add-to-cart button should be the most prominent action on the page
- States: default, hover, selected (for pills), disabled (when no variant selected), loading ("Adding...")
- The stores skill replaces the placeholder with `<ProductPurchase client:load>` and `<AddToCartButton>`

## Cart View (React Island)

The cart page interactive area — line items, quantity controls, remove buttons, subtotal, and checkout button. React island (`client:load`) wired by the stores skill.

```astro
---
<!-- Styling contract: .cart-items, .cart-item, .cart-item-image, .cart-item-info, .cart-item-quantity, .quantity-btn, .cart-item-remove, .cart-subtotal, .checkout-btn, .cart-empty -->
---

<style is:global>
  /* is:global is REQUIRED — CartView is a React island (client:load). */
  .cart-items {
    display: flex;
    flex-direction: column;
  }
  .cart-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  }
  .cart-item-image {
    width: 5rem;
    height: 5rem;
    object-fit: cover;
    border-radius: var(--radius-md);
  }
  .cart-item-info {
    flex: 1;
  }
  .cart-item-info h3 {
    font-family: var(--font-body);
    font-weight: 500;
    color: var(--color-text);
  }
  .cart-item-quantity {
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }
  .quantity-btn {
    width: 2rem;
    height: 2rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 20%, transparent);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    cursor: pointer;
    font-family: var(--font-body);
  }
  .cart-item-remove {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-body);
    transition: color 0.15s;
  }
  .cart-item-remove:hover {
    color: var(--color-accent);
  }
  .cart-subtotal {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem 0;
    border-top: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
    margin-top: 1rem;
    font-family: var(--font-body);
    color: var(--color-text);
  }
  .checkout-btn {
    width: 100%;
    padding: 0.75rem 1.5rem;
    background: var(--color-accent);
    color: var(--color-bg);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-weight: 500;
    font-size: 1rem;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .checkout-btn:hover {
    opacity: 0.9;
  }
  .checkout-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cart-empty {
    text-align: center;
    padding: 3rem 0;
    color: var(--color-text-muted);
    font-family: var(--font-body);
  }
</style>
```

**Design notes:**
- Cart items separated by subtle borders using `color-mix()`
- Remove button is understated (muted color) until hovered
- Checkout button matches add-to-cart styling (primary action)
- Empty state centered with muted text + "Browse Products" link

## Cart Badge (React Island)

A minimal badge in the navigation showing the cart item count. React island (`client:load`) that updates via `CustomEvent` when items are added/removed.

```astro
---
<!-- Styling contract: .cart-badge, .cart-badge-count -->
---

<style is:global>
  /* is:global is REQUIRED — CartBadge is a React island. */
  .cart-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    text-decoration: none;
    color: var(--color-text);
    font-family: var(--font-body);
    font-size: 0.75rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .cart-badge-count {
    font-size: 0.6875rem;
    min-width: 1.125rem;
    height: 1.125rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.3125rem;
    background: var(--color-accent);
    color: var(--color-bg);
  }
</style>
```

**Design notes:**
- Count bubble only appears when items > 0
- Badge inherits nav styling (font, color) via CSS variables
- Keep minimal — just the count indicator, not a full cart preview

## Availability Picker (React Island)

The service detail page booking section — date selector, check button, and time slot grid. React island (`client:load`) wired by the bookings skill.

```astro
---
<!-- Styling contract: .availability-picker, .date-input, .check-btn, .slot-grid, .slot-btn, .slot-btn.selected, .no-slots -->
---

<style is:global>
  /* is:global is REQUIRED — AvailabilityPicker is a React island (client:load). */
  .availability-picker {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .availability-picker > div:first-child {
    display: flex;
    gap: 1rem;
    align-items: flex-end;
  }
  .date-input {
    flex: 1;
    padding: 0.75rem 1rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 20%, transparent);
    border-radius: var(--radius-md);
    background: var(--color-bg-alt);
    color: var(--color-text);
    font-family: var(--font-body);
    font-size: 1rem;
  }
  .date-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent);
  }
  .check-btn {
    padding: 0.75rem 1.5rem;
    background: var(--color-accent);
    color: var(--color-bg);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.2s;
    white-space: nowrap;
  }
  .check-btn:hover {
    opacity: 0.9;
  }
  .check-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .slot-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }
  @media (min-width: 768px) {
    .slot-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  .slot-btn {
    padding: 0.75rem 1rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 20%, transparent);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-body);
    text-align: center;
    cursor: pointer;
    transition: all 0.15s;
  }
  .slot-btn:hover {
    border-color: var(--color-text);
    background: var(--color-bg-alt);
  }
  .slot-btn.selected {
    background: var(--color-accent);
    color: var(--color-bg);
    border-color: var(--color-accent);
  }
  .no-slots {
    color: var(--color-text-muted);
    font-family: var(--font-body);
  }
</style>
```

**Design notes:**
- Date input uses `var(--color-bg-alt)` background (same dark-site rule as form inputs)
- Time slots render as a responsive pill grid (2 cols mobile → 3 cols desktop)
- Selected slot uses accent color (inverted)
- Loading state: "Checking..." on the check button with disabled state

## FAQ Accordion (React Island)

FAQ page with categorized Q&A items using native `<details>/<summary>` for accordion behavior. React island (`client:only="react"`) for client-side search filtering.

```astro
---
<!-- Styling contract: .faq-section, .faq-category, .faq-item, .faq-question, .faq-answer, .faq-toggle, .faq-search -->
---

<style is:global>
  /* is:global is REQUIRED — FaqSection is a React island (client:only="react"). */
  .faq-search {
    width: 100%;
    max-width: 28rem;
    padding: 0.75rem 1rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 20%, transparent);
    border-radius: var(--radius-md);
    background: var(--color-bg-alt);
    color: var(--color-text);
    font-family: var(--font-body);
    font-size: 1rem;
    margin-bottom: 2rem;
  }
  .faq-search:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent);
  }
  .faq-section {
    margin-bottom: 3rem;
  }
  .faq-category {
    font-size: 1.5rem;
    font-weight: 500;
    margin-bottom: 1rem;
    font-family: var(--font-display);
    color: var(--color-text);
  }
  .faq-item {
    border-bottom: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  }
  .faq-item:first-child {
    border-top: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  }
  .faq-question {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 1rem 0;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-weight: 500;
    font-family: var(--font-body);
    color: var(--color-text);
    transition: color 0.15s;
  }
  .faq-question:hover {
    color: var(--color-accent);
  }
  .faq-toggle {
    width: 1.25rem;
    height: 1.25rem;
    color: var(--color-text-muted);
    transition: transform 0.2s;
    flex-shrink: 0;
    margin-left: 1rem;
  }
  details[open] .faq-toggle {
    transform: rotate(180deg);
  }
  .faq-answer {
    padding: 0 0 1rem 0;
    color: var(--color-text-muted);
    font-family: var(--font-body);
    line-height: 1.6;
  }
</style>
```

**Design notes:**
- Uses native `<details>/<summary>` — no JavaScript needed for open/close
- Chevron rotates via CSS `details[open]` selector
- Search input uses same dark-site-safe styling as form inputs
- Category headings use display font, questions use body font
- Subtle borders separate items; accent color on hover

## Image Gallery / Lightbox (React Island)

Grid of images that opens into a full-screen lightbox with previous/next navigation. React island (`client:only="react"`) used in portfolio and other visual pages.

```astro
---
<!-- Styling contract: .gallery-grid, .gallery-item, .lightbox-overlay, .lightbox-image, .lightbox-nav, .lightbox-close -->
---

<style is:global>
  /* is:global is REQUIRED — ImageGallery is a React island (client:only="react"). */
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }
  @media (min-width: 768px) {
    .gallery-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  .gallery-item {
    aspect-ratio: 4/3;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--color-bg-alt);
    cursor: pointer;
  }
  .gallery-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
  }
  .gallery-item:hover img {
    transform: scale(1.05);
  }
  .lightbox-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .lightbox-image {
    max-width: 100%;
    max-height: 90vh;
    object-fit: contain;
    border-radius: var(--radius-md);
  }
  .lightbox-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
    padding: 1rem;
    opacity: 0.7;
    transition: opacity 0.15s;
  }
  .lightbox-nav:hover {
    opacity: 1;
  }
  .lightbox-nav.prev { left: 0.5rem; }
  .lightbox-nav.next { right: 0.5rem; }
  .lightbox-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: none;
    border: none;
    color: white;
    font-size: 1.75rem;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s;
  }
  .lightbox-close:hover {
    opacity: 1;
  }
</style>
```

**Design notes:**
- Gallery grid is responsive (2 cols → 3 cols)
- Lightbox overlay uses semi-transparent black — works on any site theme
- Navigation buttons are semi-transparent white — visible on dark overlay
- Image hover zoom provides interactive feedback

## Auth Button

Login/logout area in the navigation. This is an Astro component (server-rendered) that checks auth state and renders the appropriate button.

```astro
---
<!-- Styling contract: .auth-area, .auth-btn, .auth-btn-login, .auth-btn-logout -->
---

<style is:global>
  .auth-area {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .auth-btn {
    padding: 0.5rem 1rem;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .auth-btn:hover {
    opacity: 0.85;
  }
  .auth-btn-login {
    background: var(--color-accent);
    color: var(--color-bg);
    border: none;
  }
  .auth-btn-logout {
    background: none;
    color: var(--color-text);
    border: 1px solid color-mix(in srgb, var(--color-text) 25%, transparent);
  }
  .auth-btn-logout:hover {
    border-color: var(--color-text);
  }
</style>
```

**Design notes:**
- Login button uses accent color (primary action)
- Logout button is understated (outlined, secondary action)
- Auth area flexbox layout works in nav action slot
- Profile link (when logged in) uses text styling, not a button

## Project Card (CMS)

```astro
---
// src/components/ProjectCard.astro
interface Props {
  title: string;
  category?: string;
  coverImageUrl?: string;
  slug: string;
  client?: string;
  year?: string;
}
---
```

**Design notes:**
- Image-heavy card — cover image should dominate (4:3 or 16:9 aspect ratio)
- Hover effect on image (scale) and title (color shift or underline)
- Category + year metadata in muted text above or below the title
- Client name as secondary text if present
- Link wraps the entire card

## Team Member Card (CMS)

```astro
---
// src/components/TeamMemberCard.astro
interface Props {
  name: string;
  role: string;
  department?: string;
  photoUrl?: string;
  slug?: string;
}
---
```

**Design notes:**
- Centered layout: circular photo → name → role
- Photo uses circular crop (`border-radius: 50%`), consistent size (e.g., 12rem)
- Fallback: show first letter initial when no photo, using `var(--color-bg-alt)` background
- Hover effect on photo (subtle scale) and name (color shift)
- Social icons (email, LinkedIn, Twitter) below role — use inline SVGs, not an icon library
- Link wraps the card if individual profile pages exist

## Resource Card (CMS)

```astro
---
// src/components/ResourceCard.astro
interface Props {
  title: string;
  description?: string;
  fileType?: string;
  downloadUrl?: string;
  coverImageUrl?: string;
  fileSize?: string;
  slug: string;
}
---
```

**Design notes:**
- File type badge: small pill showing type (PDF, DOC, ZIP) — color-coded by type
- Cover image or file type icon placeholder when no image
- File size displayed as secondary metadata
- Download CTA or arrow indicator
- Hover effect on card (shadow, border change)

## Category Filter (Shared)

```astro
---
// src/components/CategoryFilter.astro
interface Props {
  categories: string[];
  activeCategory?: string | null;
  basePath: string;
}
---
```

**Design notes:**
- Horizontal pill/tab bar for filtering — server-rendered via URL search params (no JS)
- Active pill: solid background using `var(--color-text)` bg + `var(--color-bg)` text (inverted)
- Inactive pill: `var(--color-bg-alt)` background, `var(--color-text-muted)` text
- "All" option always first
- Wraps on small screens (`flex-wrap`)
- Used across multiple CMS use cases (portfolio, resources) and potentially stores

---

## Responsive Breakpoints

Use Tailwind's default breakpoints:
- `sm`: 640px (mobile landscape)
- `md`: 768px (tablet)
- `lg`: 1024px (desktop)
- `xl`: 1280px (wide desktop)

**Mobile-first:** Write base styles for mobile, then add breakpoint overrides for larger screens.

## Accessibility Checklist

- Color contrast ratios meet WCAG AA (4.5:1 for text, 3:1 for large text)
- Focus states visible on all interactive elements
- Images have `alt` attributes
- Form labels associated with inputs
- Navigation is keyboard-accessible
- Skip-to-content link for screen readers
