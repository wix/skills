# Capability Map — Business Need to Wix Implementation

Maps business requirements to Wix apps, appDefIds, SDK packages, and implementation approach.

## Wix Apps (require `--apps` flag during scaffolding)

These apps must be installed on the Wix business to use their SDK packages.

| Business Need | Wix App | appDefId | `--apps` value | SDK Packages | Key Methods |
|---------------|---------|----------|----------------|--------------|-------------|
| E-commerce / sell products | Wix Stores | `215238eb-22a5-4c36-9e7b-e7c08025e04e` | `stores` | `@wix/stores`, `@wix/ecom`, `@wix/redirects` | `products.queryProducts()`, `currentCart.addToCurrentCart()`, `currentCart.createCheckoutFromCurrentCart()`, `redirects.createRedirectSession()` |
| Form data collection | Wix Forms | `14ce1214-b278-a7e4-1373-00cebd1bef7c` | `forms` | `@wix/forms` | `forms.getForm()`, `submissions.createSubmission()` |
| Blog posts and articles | Wix Blog | `14bcded7-0066-7c35-14d7-466cb3f09103` | `blog` | `@wix/blog` | `posts.queryPosts()`, `posts.getPost()` |

## Built-In Capabilities (no app installation needed)

These capabilities are available on any Wix Managed Headless project without installing additional apps.

| Business Need | SDK Package | Key Methods | Notes |
|---------------|-------------|-------------|-------|
| Cart + checkout (with Stores) | `@wix/ecom` | `currentCart.addToCurrentCart()`, `currentCart.getCurrentCart()`, `currentCart.createCheckoutFromCurrentCart()` | Requires Wix Stores app installed |
| Checkout redirect (with Stores) | `@wix/redirects` | `redirects.createRedirectSession({ ecomCheckout: { checkoutId } })` | Redirects to Wix-hosted checkout page |
| Blog posts and articles | `@wix/blog` | `posts.queryPosts()`, `posts.getPost()` | Requires Wix Blog app (install via `--apps blog`). Rendered with `@wix/ricos` RicosViewer. **Do NOT use `@wix/data` for blog posts.** |
| Custom CMS collections (portfolio, team directory, FAQ, resource library, menus, testimonials) | `@wix/data` | `items.query()`, `items.get()`, `items.insert()` | Uses Wix CMS data collections. Automatically included when content pages are marked as CMS-managed during discovery (Step 3b). For structured content with custom schemas — NOT for blog posts, products, bookings, or form submissions. |
| Permission elevation | `@wix/essentials` | `auth.elevate()` | For privileged server-side operations |
| Static pages | None | — | Pure Astro pages with Tailwind CSS |

## Common Business Type Mappings

| Business Type | Typical Apps | Typical Features |
|---------------|-------------|-----------------|
| E-commerce store | `stores`, `forms` | Product catalog, cart, checkout, contact form. **Do NOT include `@wix/data`** — product data is handled entirely by `@wix/stores`. |
| Service business (salon, studio) | `forms` | Service list, contact form |
| Blog / content site | `blog` | Blog posts via `@wix/blog` (Wix Blog app), about page. **Do NOT use `@wix/data` for blog posts** — use `@wix/blog` which provides dedicated blog APIs and rich content rendering. |
| Portfolio / agency | `forms` | Work showcase via `@wix/data` (portfolio projects), contact form |
| SaaS landing page | `forms` | Feature sections, waitlist/signup form |
| Restaurant | `forms` | Menu items via `@wix/data`, contact form |
| Fitness / wellness | `stores` | Class schedule, merchandise store |
| Consultant / freelancer | `forms` | Services, contact form, case studies/testimonials via `@wix/data` |
| Non-profit / community | `forms` | Events, donation form, volunteer signup |

## App Combinations

| Combination | Use Case |
|-------------|----------|
| `stores` alone | Pure e-commerce |
| `forms` alone | Lead generation, contact, waitlist |
| `stores,forms` | E-commerce with contact/support forms |
| No apps | Static site or CMS-powered content. `@wix/data` is added when the user marks content pages as CMS-managed during discovery. |
