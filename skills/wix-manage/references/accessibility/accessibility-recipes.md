---
name: "Accessibility Recipes"
description: "Site accessibility auditing — scan a whole site, a single page, or every page in a collection (products, blog posts, booking services, events, restaurant pages) for accessibility issues and read the prioritized findings. Use for anything users call accessibility, a11y, WCAG, compliance, screen-reader, or contrast problems."
---

# Accessibility Recipes

Accessibility work on a Wix site goes through a scan: it runs asynchronously, so the recipe covers starting a scan, polling it to completion, and reading the findings — including which pages failed to scan at all. Scans can target the whole site, one page, or a page collection, so establish the scope the user means before starting one.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Scan a Wix Site for Accessibility Issues](https://dev.wix.com/docs/api-reference/site/accessibility/skills/scan-a-wix-site-for-accessibility-issues)
**Technical:** Run a Wix accessibility scan for a full site, one page, or every page in
any supported page collection, including products, blog posts, booking services, events,
and restaurant pages. Poll the asynchronous scan to completion, report failed pages
separately, retrieve prioritized findings, and use the returned fix guidance to help the
user resolve and verify issues.
