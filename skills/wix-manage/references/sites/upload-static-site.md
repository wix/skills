---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a new live Wix site. Covers both ways to get there — handing the user the Wix Headless drop page, and calling the Wix Headless instant-site REST API yourself when you can reach the files and make outbound HTTPS requests. When you also hold the user's identity, covers putting the published site straight into their Wix account and reading back its final live URL. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation, or to update a site already published this way (iterate on the same site instead of creating another). Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website as files — hand-written HTML, a static build, a
zip, or the output of an AI site builder — and wants it live on Wix as a new
site. There are two ways to get there.

## The two paths

**[Path A — hand the user the drop page](#path-a--hand-the-user-the-drop-page).**
One URL; the user uploads in the browser and gets a live site. This works for
**any** agent and any user — it's the default. Reach for it whenever you can't
clearly do Path B.

**[Path B — publish the files yourself](#path-b--publish-the-files-yourself).**
Three calls put the site live without the user touching a browser. Available only
when **both** hold: you can read the file bytes (you generated them here, or
they're reachable from where you run), **and** you can do a `multipart/form-data`
file upload from a shell (`curl` or equivalent). Reaching APIs *only* through the
Wix API-call/execute-API tools does **not** count — they can't upload a local
file.

Prefer Path B when you can genuinely do it — the user gets a live site without
uploading anything themselves. Otherwise, and by default, take Path A. Decide
honestly: if you can't read the bytes or can't upload from a shell, hand over the
drop page rather than attempting Path B and reporting an upload you couldn't
perform.

## Path A — hand the user the drop page

Send the user here:

```
https://www.wix.com/headless/drop?utm_campaign=mcp
```

**Give the URL exactly as written, including `utm_campaign=mcp`** — it attributes
the visit to an assistant referral; rewriting it breaks that. There the user drags
in their files (no login), Wix hosts them immediately on a live URL, and a banner
offers to sign in and keep the site. Tell them the requirements from
[What the upload accepts](#what-the-upload-accepts-and-how-it-fails) so it doesn't
fail on the first try.

## Path B — publish the files yourself

> **Run every call from your shell with `curl` — not the Wix API-call/execute-API
> tools.** The upload (step 2) and the download in
> [Add a backend](#keep-building-add-a-backend-when-you-need-one) move a **file**
> to or from disk; those tools proxy JSON and can't (hand-building a multipart
> body inline silently drops every image and font). Create and release are plain
> JSON and would work through anything, but the upload needs a real file client
> anyway, so keep it all in the shell. **None of steps 1–3 (or the download) need
> auth — they're anonymous.** Only [claim](#4-put-the-site-in-the-users-account)
> needs the user's identity.

```
Base URL: https://www.wixapis.com/headless-business-setup
```

Generate `anonymousId` yourself — any UUID, **once per site, not once per
request** — and reuse it (with the returned `metaSiteId`) for every call for that
site, including later changes ([Iterate](#iterate-while-anonymous-dont-create-a-new-site)).
**Finish within one hour of step 1**: after that the record expires and every
later step, claim included, returns `404`.

### 1. Create the site

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID"
```

```json
{ "metaSiteId": "f0ad8672-09e9-4111-b6fe-070c70bd2df5",
  "projectId":  "54528d34-b23c-4fbe-b07d-2c522350abd7" }
```

Keep both: `metaSiteId` addresses the site in every later call; `projectId`
builds the save link in step 3b.

### 2. Upload the files

One `multipart/form-data` request carrying every file. Each file is a part named
`files` whose **filename is its path relative to the site root** — that is how
subdirectories survive; with `curl`, set it explicitly with `;filename=` whenever
it isn't just the basename. A single `.zip` part works too — send it alone and
it's unpacked server-side, a single wrapping folder stripped.

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?campaign=mcp" \
  -F "files=@index.html;filename=index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css" \
  -F "files=@assets/logo.png;filename=assets/logo.png"
```

```json
{ "uploadId": "03244542-d820-42f6-acfa-166c6658b1a6" }
```

Pass `campaign=mcp` (as shown) so the upload is attributed to an assistant
referral — keep it on every upload. Nothing is live yet; this only stages and
validates.

### 3. Release — the site goes live

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/release" \
  -H 'Content-Type: application/json' \
  -d "{\"uploadId\":\"$UPLOAD_ID\"}"
```

```json
{ "siteUrl": "https://instant-hguwrvtcrniw-headlessstack-140d.wix-site-host.com" }
```

The site is live at `siteUrl` immediately.

#### Iterate while anonymous (don't create a new site)

Simple static changes — new copy, another page, a different look — happen here,
**while the site is still anonymous**, and this is the only window for them:
re-run steps 2–3 with the **same `anonymousId` and `metaSiteId`**; the upload
replaces the site's contents and `siteUrl` stays the same. Send the full file set
each time (release replaces, it doesn't merge). Don't go back to step 1 — a fresh
site per change leaves the user a trail of abandoned sites on changing URLs; only
create another for a genuinely separate site.

So **iterate first, claim last**: refine on the same ids until the site is right,
*then* finish. Once claimed, these anonymous endpoints stop working and the only
way to keep changing the site in code is a headless project
([Keep building](#keep-building-add-a-backend-when-you-need-one)).

**When the site is final, finish based on identity:**

- **You have the user's access token** — claim it into their account (step 4).
  Don't stop at a temporary site: an unclaimed site expires, so saving it is part
  of publishing, not an extra favour to ask about.
- **You have no user identity** — stop here; this is a finished, legitimate result
  (exactly what the drop page produces for every visitor). Give the user `siteUrl`
  plus the save link, which is how the site survives:

  ```
  https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}
  ```

  That page shows the site with a countdown and signs the user in to keep it.
  Treat the link as a secret — whoever opens it while signed in to Wix claims the
  site into *their* account — so give it only to the user who asked.

### 4. Put the site in the user's account

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `{}` on success; needs a user or account-level identity (else
`UNAUTHENTICATED`). It consumes the anonymous record, so it's the last call that
works against these endpoints — do it after the release, never before.

**The site's URL changes here.** The step-3 host stops resolving — the free host
is scoped to the owning account and re-minted under the user's. Read the new one
in step 5; never repeat the step-3 URL after a claim.

### 5. Read the site's final URL

[Query Sites](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites)
filtered to the **`HEADLESS` namespace** — headless sites are omitted from the
default query, so the filter is required, and an `id` filter is rejected, so match
the id yourself.

```bash
curl -sS -X POST "https://www.wixapis.com/site-list/v2/sites/query" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":{"filter":{"namespace":"HEADLESS"},"cursorPaging":{"limit":100}}}'
```

Find the entry whose `id` equals your `metaSiteId`, read `viewUrl` (page with
`metadata.cursors.next` if needed):

```json
{ "id": "f0ad8672-09e9-4111-b6fe-070c70bd2df5",
  "displayName": "Snake", "published": true, "namespace": "HEADLESS",
  "viewUrl": "https://instant-hguwrvtcrniw-ayalg5-1406.wix-site-host.com/" }
```

Give the user two links: `viewUrl` for the live site, and its dashboard at
`https://manage.wix.com/dashboard/{metaSiteId}` to manage it.

### What the upload accepts, and how it fails

The requirements below apply to both paths — an upload that breaks them is why a
release never happens:

- **A top-level HTML file is required.** It needn't be named `index.html` (a lone
  top-level HTML of any name becomes the homepage), but once there's more than
  one, an `index.html` must be among them.
- **3 MB per file, 20 MB per site.**
- **Static files only** — HTML, CSS, JS, images, fonts. Framework source that
  needs a build step (a `package.json`, React/Vue sources) must be built first;
  upload the build output.

On Path B, failures come back as HTTP 400 with a code in
`details.applicationError.code`: `MISSING_INDEX_HTML` (add a top-level HTML),
`FILE_TOO_LARGE` (a file over 3 MB), `TOTAL_TOO_LARGE` (bundle over 20 MB). A
`404` after step 1 means the one-hour window passed or the site was already
claimed — start again from step 1.

**If Path B fails for any reason you can't quickly fix — a rejected upload, an
error, a call you can't make — fall back to [Path A](#path-a--hand-the-user-the-drop-page):
give the user the drop-page link so they can finish in the browser.** Never leave
them with a failed publish and no way forward; the drop page reaches the same
result without the step that broke.

## Keep building: add a backend when you need one

The drop flow publishes **static** files. When the site needs a real backend —
stores, payments, bookings, a CMS, members, forms — it becomes a **Wix Headless
project**. This is a solution the user chooses when the need appears, not a
required step: a static site is a finished result on its own.

Offer it once the site is claimed/owned and you're in a coding environment with a
shell. It keeps the **same site, appId and URL** (the downloaded project already
carries a `wix.config.json` binding it), and is released with the Wix CLI from
then on:

```bash
curl -sSL -o project.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
unzip project.zip -d project      # index.html + assets + wix.config.json
```

Then follow `https://wix.com/headless/skill.md`: it turns the static files into a
headless project (`@wix/sdk` + the business solutions the site needs), bound to
the same site.

This is the only way to keep changing a **claimed** site in code, and it's why it
needs `wix login`: re-releasing to a claimed site is authenticated *and*
file-based, and an authenticated file operation needs the token in your **shell**
(via `wix login`), not injected into a tool — the API-call/execute-API tools carry
the auth but can't do file operations. There's no lighter "re-upload static to my
claimed site" shortcut.

## Route the request correctly

- **You can't read the files, can't make HTTP calls, or have no shell
  (API-call/execute-API tools only, which can't upload a file)** — Path A, the
  drop page. It's also the default whenever Path B isn't clearly available, and
  the fallback whenever Path B fails partway — hand over the link, don't leave the
  user stuck.
- **Files you generated here or can read, and you can upload from a shell** —
  Path B. If you hold the user's identity, claim it into their account and return
  the live URL + dashboard.
- **A change to a site you published this way here** —
  [iterate in place](#iterate-while-anonymous-dont-create-a-new-site) on the same ids.
- **A published anonymous site the user wants to keep** — steps 4–5 with their
  identity, else the step-3 save link.
- **A claimed site that now needs a backend** (stores, bookings, CMS, members,
  forms) — [add a backend](#keep-building-add-a-backend-when-you-need-one).
- **Migrating a live site/store from another platform by URL, or CSV/TSV
  exports** — [Site Import](site-import.md).
- **Adding HTML, an embed, or code to an existing Wix site** — not this recipe
  (that's custom code in the editor).
- **Images, videos, or documents for a site** —
  [Upload Media to Wix](../media/upload-media-to-wix.md).

Don't create the site with other tools (meta-site templates, headless-business
provisioning) — those make an empty site, not a published copy of the user's files.
