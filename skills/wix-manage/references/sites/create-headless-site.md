---
name: "Create Headless Site"
description: Creates a Wix Headless website: a site in the user's Wix account whose frontend is files uploaded to Wix hosting, with the Wix business backend behind it through APIs. The site is created and its pages put live by Upload a Website or HTML Files; a Wix Business Solution (a store, blog, bookings and more) is then integrated into it by the Wix Headless kit, from its cold start.
---
# Create Headless Site

A Wix Headless site is a site in the user's Wix account whose frontend is files
uploaded to Wix hosting and served at a `*.wix-site-host.com` URL, with the Wix
business backend (stores, bookings, forms, a CMS) behind it through APIs. It comes
to be in two steps:

1. **Create the site and put its pages live**: [Upload a Website or HTML Files](upload-static-site.md),
   online at https://dev.wix.com/docs/api-reference/account-level/sites/skills/upload-a-website-or-html-files.md.
   It holds the call that creates the site, then uploads the pages, the user's or
   ones you write, and changes them later on the same site and URL.
2. **Integrate Wix Headless into it**: a Wix Business Solution built on shipped code (a
   store, a blog, bookings, events, a CMS, forms, members and more, with its pages,
   data layer and seed) comes from the Wix Headless kit, starting at its cold start,
   https://www.wix.com/skills/headless-cold-start/headless-kit.md. It takes a machine
   from nothing (the skills, the Wix CLI sign-in) to a built, seeded, released site on
   the same site and URL; the upload recipe says how to run it with no shell of your own.
