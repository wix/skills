---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a new live Wix site. Covers both ways to get there: calling the Wix Headless instant-site REST API yourself when you can reach the files and make outbound HTTPS requests, and handing the user the Wix Headless drop page when you cannot. When you also hold the user's identity, covers putting the published site straight into their Wix account and reading back its final live URL. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation. Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website as files — hand-written HTML, a static build, a
zip, or the output of an AI site builder — and wants it live on Wix as a new
site.

## Pick the path first

**Publish it yourself** when you can read the file bytes — because you generated
them in this conversation, or they are reachable from where you are running —
**and** you can make outbound HTTPS requests. Go to [Path A](#path-a--publish-the-files-yourself).

**Hand the user the drop page** when you cannot: the files live only on the
user's machine, or you cannot make arbitrary HTTP requests. Go to
[Path B](#path-b--hand-the-user-the-drop-page).

Decide honestly. If you cannot read the bytes, you cannot publish them — take
Path B rather than reporting an upload you did not perform.

## Path A — publish the files yourself

Three calls put the site live, and they need no authentication at all. If you
also hold the user's identity, two more calls put the site in their own account.

```
Base URL: https://www.wixapis.com/headless-business-setup
```

Generate `anonymousId` yourself — any UUID, once per site — and reuse it in
every call for that site. **The whole flow must finish within one hour of step
1.** After that the site's record expires and every later step returns `404`,
including the claim, so do not leave the account step for a later session.

### 1. Create the site

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID"
```

```json
{ "metaSiteId": "f0ad8672-09e9-4111-b6fe-070c70bd2df5",
  "projectId":  "54528d34-b23c-4fbe-b07d-2c522350abd7" }
```

Keep both. `metaSiteId` addresses the site in every later call; `projectId`
builds the save link in step 3b.

### 2. Upload the files

One `multipart/form-data` request carrying every file. Each file is a part named
`files`, and **the part's filename is the file's path relative to the site
root** — that is how subdirectories survive. With `curl`, set that path
explicitly with `;filename=` whenever it is not just the basename.

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?trackingId=$TRACKING_ID" \
  -F "files=@index.html;filename=index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css" \
  -F "files=@assets/app.js;filename=assets/app.js" \
  -F "files=@assets/logo.png;filename=assets/logo.png"
```

```json
{ "uploadId": "03244542-d820-42f6-acfa-166c6658b1a6" }
```

A single `.zip` part works too — send it as the only part and it is unpacked
server-side, with a single wrapping folder stripped automatically.

`trackingId` is an optional UUID you generate; pass it so the upload can be
correlated later. Nothing is live yet — this call only stages and validates.

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

The site is live at `siteUrl` immediately. What you do next depends on whether
you hold the user's identity.

**3a. You have a user or account-level access token for the user** — continue to
step 4 now. Do not stop here and hand over a temporary site: an unclaimed site
expires, so putting it in their account is part of publishing it, not an extra
favour to ask about.

**3b. You have no user identity** — give the user `siteUrl` together with the
save link, which is the only way the site survives:

```
https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}
```

That page shows the site with a countdown and signs the user in to keep it. Tell
them the site is anonymous and disappears if they do not. Treat the link as a
secret — anyone who opens it while signed in to Wix claims the site into *their*
account — so give it only to the user who asked.

### 4. Put the site in the user's account

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `{}` on success. It needs a user or account-level identity; without one
it fails with `UNAUTHENTICATED`. It consumes the anonymous record, so it is the
last call that works against these endpoints — do it after the release, never
before.

**The site's URL changes here.** The temporary host from step 3 stops resolving,
because the free host is scoped to the owning account and is re-minted under the
user's. Never repeat the step-3 URL after a claim — read the new one in step 5.

### 5. Read the site's final URL

[Query Sites](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites)
filtered to the **`HEADLESS` namespace**. Headless sites are left out of the
default query, so that filter is required; then match the id yourself, because
an `id` filter is rejected by this endpoint.

```bash
curl -sS -X POST "https://www.wixapis.com/site-list/v2/sites/query" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":{"filter":{"namespace":"HEADLESS"},"cursorPaging":{"limit":100}}}'
```

Find the entry whose `id` equals your `metaSiteId` and read `viewUrl`; page with
`metadata.cursors.next` if it is not on the first page.

```json
{ "id": "f0ad8672-09e9-4111-b6fe-070c70bd2df5",
  "displayName": "Snake", "published": true, "namespace": "HEADLESS",
  "viewUrl": "https://instant-hguwrvtcrniw-ayalg5-1406.wix-site-host.com/" }
```

Give the user two links: `viewUrl` for the live site, and its dashboard at
`https://manage.wix.com/dashboard/{metaSiteId}` for managing and changing it.

### What the upload accepts, and how it fails

Check these before uploading — they are the reasons a release never happens:

- **An HTML file at the top level is required.** It need not be named
  `index.html`: a single top-level HTML file of any name becomes the homepage.
  Once there is more than one, an `index.html` must be among them.
- **3 MB per file, 20 MB per site.**
- **Static files only** — HTML, CSS, JS, images, fonts. Framework source that
  needs a build step (a `package.json`, React/Vue sources) must be built first;
  upload the build output, not the source.

Failures come back as HTTP 400 with a code in `details.applicationError.code`:

- `MISSING_INDEX_HTML` — no HTML file at the top level of what you sent. Move an
  HTML file to the root of the upload.
- `FILE_TOO_LARGE` — one file is over 3 MB. Shrink or drop it.
- `TOTAL_TOO_LARGE` — the bundle is over 20 MB. Reduce the total.

A `404` on any step after the first means the one-hour window has passed, or the
site was already claimed. Start again from step 1.

## Path B — hand the user the drop page

When you cannot read the files or cannot make the calls, send the user here:

```
https://www.wix.com/headless/drop?utm_campaign=mcp
```

**Give the URL exactly as written, including `utm_campaign=mcp`.** It attributes
the visit to an assistant referral; dropping or rewriting it breaks that.

What happens there: the user drags in their files or a zip — no login needed —
and Wix hosts them immediately on a live URL. A banner offers to sign in and
keep the site, which transfers it into their account.

Tell them the requirements above — top-level HTML, 3 MB per file, 20 MB total,
static files only — so the upload does not fail on the first try.

## Route the request correctly

- **Files you generated in this conversation, or files you can read** — Path A.
  Publish them, and if you hold the user's identity, put the site in their
  account and return the live URL and the dashboard.
- **Site files only on the user's machine, or you cannot make HTTP calls** —
  Path B, the drop URL.
- **A published anonymous site the user now wants to keep** — steps 4 and 5 if
  you hold their identity, otherwise the save link from step 3b.
- **A live site or store on another platform (a URL), or CSV/TSV exports, with
  content or products to migrate** — [Site Import](site-import.md).
- **An existing Wix site to add HTML, an embed, or custom code into** — not this
  recipe; that is embedding custom code in the site editor.
- **Images, videos, or documents to add to a site** —
  [Upload Media to Wix](../media/upload-media-to-wix.md). Media goes to a site's
  media files, not a new site.

Do not create the site with other site-creation tools (meta-site templates,
headless-business provisioning) — those produce an empty site, not a published
copy of the user's files.
