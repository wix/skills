# Recipe: Static Pages — About, Landing, Info Pages

Build static pages with no SDK dependencies — pure Astro + Tailwind CSS.

## Prerequisites

- An existing Wix Managed Headless project with Layout and global styles
- No SDK packages needed for static pages

## Common Static Pages

| Page | File | Purpose |
|------|------|---------|
| About | `src/pages/about.astro` | Company/personal story |
| Home | `src/pages/index.astro` | Landing page with hero + sections |
| FAQ | `src/pages/faq.astro` | Frequently asked questions |
| Privacy / Terms | `src/pages/privacy.astro` | Legal pages |

## Implementation

### About Page (`src/pages/about.astro`)

```astro
---
import Layout from "../layouts/Layout.astro";
---

<Layout title="About Us">
  <main>
    <!-- Hero Section -->
    <section class="py-20 bg-neutral-50">
      <div class="max-w-4xl mx-auto px-4 text-center">
        <h1 class="text-5xl font-light mb-6">About Us</h1>
        <p class="text-xl text-neutral-600 max-w-2xl mx-auto">
          A short tagline about who you are and what you do.
        </p>
      </div>
    </section>

    <!-- Story Section -->
    <section class="py-20">
      <div class="max-w-4xl mx-auto px-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 class="text-3xl font-light mb-4">Our Story</h2>
            <p class="text-neutral-600 mb-4">
              Your story here — what drives the business, the founding story,
              the mission and values.
            </p>
            <p class="text-neutral-600">
              Another paragraph about your approach, philosophy, or what
              makes you different.
            </p>
          </div>
          <div class="aspect-square rounded-lg bg-neutral-100">
            <!-- Placeholder for an image -->
          </div>
        </div>
      </div>
    </section>

    <!-- Values Section -->
    <section class="py-20 bg-neutral-50">
      <div class="max-w-6xl mx-auto px-4">
        <h2 class="text-3xl font-light text-center mb-12">What We Believe</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div class="text-center">
            <h3 class="text-lg font-medium mb-2">Value One</h3>
            <p class="text-neutral-600">Description of this core value.</p>
          </div>
          <div class="text-center">
            <h3 class="text-lg font-medium mb-2">Value Two</h3>
            <p class="text-neutral-600">Description of this core value.</p>
          </div>
          <div class="text-center">
            <h3 class="text-lg font-medium mb-2">Value Three</h3>
            <p class="text-neutral-600">Description of this core value.</p>
          </div>
        </div>
      </div>
    </section>
  </main>
</Layout>
```

### Home / Landing Page (`src/pages/index.astro`)

```astro
---
import Layout from "../layouts/Layout.astro";
---

<Layout title="Brand Name">
  <main>
    <!-- Hero -->
    <section class="min-h-[80vh] flex items-center justify-center">
      <div class="max-w-4xl mx-auto px-4 text-center">
        <h1 class="text-5xl md:text-6xl font-light mb-6">
          Your Main Headline
        </h1>
        <p class="text-xl text-neutral-600 max-w-2xl mx-auto mb-8">
          A compelling subtitle that explains what you offer.
        </p>
        <div class="flex gap-4 justify-center">
          <a
            href="/products"
            class="px-8 py-3 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition-colors"
          >
            Primary CTA
          </a>
          <a
            href="/about"
            class="px-8 py-3 border border-neutral-300 rounded-lg hover:bg-neutral-50 transition-colors"
          >
            Learn More
          </a>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="py-20 bg-neutral-50">
      <div class="max-w-6xl mx-auto px-4">
        <h2 class="text-3xl font-light text-center mb-12">Why Choose Us</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div class="p-6 bg-white rounded-lg">
            <h3 class="text-lg font-medium mb-2">Feature One</h3>
            <p class="text-neutral-600">Brief description of this feature or benefit.</p>
          </div>
          <div class="p-6 bg-white rounded-lg">
            <h3 class="text-lg font-medium mb-2">Feature Two</h3>
            <p class="text-neutral-600">Brief description of this feature or benefit.</p>
          </div>
          <div class="p-6 bg-white rounded-lg">
            <h3 class="text-lg font-medium mb-2">Feature Three</h3>
            <p class="text-neutral-600">Brief description of this feature or benefit.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section class="py-20">
      <div class="max-w-4xl mx-auto px-4 text-center">
        <h2 class="text-3xl font-light mb-4">Ready to Get Started?</h2>
        <p class="text-neutral-600 mb-8">Take the next step today.</p>
        <a
          href="/contact"
          class="inline-block px-8 py-3 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition-colors"
        >
          Get in Touch
        </a>
      </div>
    </section>
  </main>
</Layout>
```

## Customization Guidelines

1. **Replace placeholder text** with actual brand copy
2. **Update CTAs** to link to the correct pages (products, contact, services)
3. **Add images** from `public/` directory or external URLs
4. **Customize colors** using CSS variables from `global.css`
5. **Adjust spacing** using Tailwind classes (py-20, gap-8, etc.)

## Testing

1. Run `npx @wix/cli dev`
2. Navigate to the page URL
3. Check responsive layout at different viewport widths
4. Verify navigation links work correctly
