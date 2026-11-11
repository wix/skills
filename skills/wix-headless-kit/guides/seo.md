# SEO tags: what every page carries

Read when you write or wire pages, on any stack. Search engines and link previews read the HTML of
a page.

## Every page

- A `<title>` and a `<meta name="description">`, different on each page.
- `lang` on `<html>`.
- One `<h1>`, and `alt` text on each picture.
- The Open Graph tags `og:title`, `og:description` and `og:image`.

## Item pages: a product, a post, a service, an event

- **Managed Astro.** The shipped item pages render the owner's SEO settings on the server. Keep
  their SEO pieces as the vertical's `INSTRUCTIONS.md` says. A page you create passes its own
  `title` and `description` to the site layout.
- **A static or reference-mode site.** One file serves every item, so the tags come from the item
  when it loads. Set the title, the description and the Open Graph tags from the fields the
  vertical's `static.md` names. Add a `<link rel="canonical">` with the address of the page, and
  the item's structured data (`application/ld+json`: `Product`, `BlogPosting`, `Event`) from the
  same fields. A crawler that does not run JavaScript does not see these tags; the Astro build
  renders them on the server. Say so when you close.

## What Wix serves

Wix serves its own `robots.txt` and `sitemap.xml` on the site's address. A file uploaded with one
of those names is not served; do not upload them. The owner sets a site's SEO in the dashboard;
the recipes are `wix-manage/references/seo/`.
