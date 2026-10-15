---
name: "Create Headless Site"
description: Creates a Wix Headless website: a site in the user's Wix account whose frontend is files uploaded to Wix hosting, with the Wix business backend behind it through APIs. Two flows make one: Upload a Website or HTML Files, for pages the user has or that you write; the Wix Headless kit's cold start, for a store, blog, bookings or another Wix Business Solution built on its shipped code.
---
# Create Headless Site

A Wix Headless site is a site in the user's Wix account whose frontend is files
uploaded to Wix hosting and served at a `*.wix-site-host.com` URL, with the Wix
business backend (stores, bookings, forms, a CMS) behind it through APIs. Two flows
make one, and both create the site themselves:

- **Pages the user has, or that you write** (an index.html, a static build, a zip, a
  form on one page): [Upload a Website or HTML Files](upload-static-site.md), online at
  https://dev.wix.com/docs/api-reference/account-level/sites/skills/upload-a-website-or-html-files.md.
  It creates the site, uploads the files, changes them later and connects a backend.
- **A Wix Business Solution built on shipped code** (a store, a blog, bookings, events,
  a CMS, forms, members and more, with its pages, data layer and seed): the Wix Headless
  kit, starting at its cold start, https://www.wix.com/skills/headless-cold-start/headless-kit.md.
  It takes a machine from nothing (the skills, the Wix CLI sign-in) to a built, seeded,
  released site; the upload recipe says how to run it with no shell of your own.
