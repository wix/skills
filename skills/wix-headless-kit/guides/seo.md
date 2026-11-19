# SEO tags: what every page carries

Read when you write or wire pages, on any stack. Search engines and link previews read the HTML of
a page.

## Every page

- A `<title>` and a `<meta name="description">`, different on each page.
- `lang` on `<html>`.
- One `<h1>`, and `alt` text on each picture.
- The Open Graph tags `og:title`, `og:description` and `og:image`.

On managed Astro, a page at a fixed address takes its title, description and social tags from Wix:
"Main pages on managed Astro" below. On a static site the tags are in the files, and the owner
changes them through you, not in the dashboard. Say so when you close.

## Main pages on managed Astro

A main page is a page at a fixed address: the home page, an about page, a list. Wix adds its
title, description and social tags to the HTML on the server, from the SEO settings of the site,
where the owner edits them. A tag the page writes itself comes first and hides the owner's. These
pages pass no `title` and no `description` to the site layout, and write no Open Graph tags.

After the release, set the title and the description of each main page in Wix: Set Item SEO Tags
with item type `STATIC_PAGE` and `publish: true` (`wix-manage/references/seo/manage-seo-tags.md`).
List Item SEO Tags returns one entry for each main page of the released site. Use its `itemId` as
returned: `{siteId}_HOME` for the home page, `{siteId}_{name}` for another page. A page with
nothing set shows the name of the page and the name of the site.

## Item pages: a product, a post, a service, an event

- **Managed Astro.** The shipped item pages render the owner's SEO settings on the server. Keep
  their SEO pieces as the vertical's `INSTRUCTIONS.md` says. A page you create for one item passes
  the `title` and `description` of the item to the site layout.
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
