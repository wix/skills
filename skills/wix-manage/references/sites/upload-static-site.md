---
name: "Upload a Website or HTML Files"
description: Get a user's ready-made website live on Wix when they already have the site files — an index.html, a zip, or a static build exported from an AI builder or any other tool — by sending them to the Wix Headless drop page, where they upload the files and instantly get a live hosted site they can claim into their account. Use whenever the user wants to upload, publish, or host their own HTML/CSS/JS files as a NEW site. Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user already has a finished website as files — hand-written HTML, a zip
export, or the output of an AI site builder — and wants it live on Wix as a
new site. There is no API call to make. Send them to the upload page and
explain the flow:

```
https://www.wix.com/headless/drop?referral=<agent>&utm_campaign=<agent>
```

**Replace `<agent>` in both query parameters with your own product's short
lowercase name** — `aria` if you are Wix Aria, `claude` for Claude, `chatgpt`
for ChatGPT, and so on; use `assistant` if you have no product name. Give both
parameters the same value and keep both. They attribute the visit to the
referring assistant; dropping them, leaving the `<agent>` placeholder in, or
inventing extra parameters breaks that attribution.

## What happens on that page

1. The user drags in their files (or a zip) — no login needed.
2. Wix hosts them immediately on a live URL they can open and share.
3. To keep the site, they claim it into their Wix account (sign in / sign up
   from the hosted site's banner). After claiming they can connect a custom
   domain and manage the site from their dashboard. Unclaimed uploads expire
   within about a day.

## Tell the user before they upload

Share the requirements that match their situation — these are the common
reasons an upload fails:

- The upload must contain an **HTML file at the top level of the site's
  files**. It does not need to be named `index.html` — a single HTML file of
  any name is served as the homepage — and a zip or folder that wraps
  everything in one top-level folder (e.g. `my-site/index.html`) is unwrapped
  automatically.
- Size limits: **3 MB per file, 20 MB total.**
- **Static files only** — HTML, CSS, JavaScript, and assets. If the user has
  framework source code that needs a build step (a `package.json`, React/Vue
  source, etc.), they must run their build first and upload the build output
  folder's contents, not the source.

## Route the request correctly

| The user has… | Do this |
|---|---|
| Site files on their machine (HTML/zip/AI-builder export), wants a new site | This recipe — send them to the drop URL above |
| A live site or store on another platform (a URL), or CSV/TSV exports, and wants content/products migrated | [Site Import](site-import.md) |
| An existing Wix site they want to add HTML, an embed, or custom code into | Not this recipe — that's embedding custom code in the site editor |
| Images, videos, or documents to add to a site | [Upload Media to Wix](../media/upload-media-to-wix.md) — media goes to the site's media files, not a new site |

Do not try to perform the upload for the user through an API, and do not
create a site for them with other site-creation tools instead — the drop page
is the flow.
