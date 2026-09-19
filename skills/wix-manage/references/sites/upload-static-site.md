---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a new live Wix site. Covers both ways to get there — calling the Wix Headless instant-site REST API yourself when you can reach the files and make outbound HTTPS requests, and handing the user the Wix Headless drop page when you cannot. When you also hold the user's identity, covers putting the published site straight into their Wix account and reading back its final live URL. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation, or to update a site already published this way (iterate on the same site instead of creating another). Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website as files — hand-written HTML, a static build, a
zip, or the output of an AI site builder — and wants it live on Wix as a new
site.

## The two paths

**[Path A — publish the files yourself](#path-a--publish-the-files-yourself).**
Three unauthenticated calls — create a site, upload the files, release — and the
user has a live URL in seconds, without ever leaving the conversation. Available
only when **both** hold: you can read the file bytes (you generated them in this
conversation, or they are reachable from where you are running), **and** you can
run a real HTTP file client from a shell — `curl` or equivalent that does a
`multipart/form-data` upload from disk. Making requests **only** through the Wix
API-call/execute-API tools does **not** qualify: those cannot pipe local files
into a multipart upload (hand-building the body inline drops all binary assets),
so an agent whose only outbound path is those tools must use Path B, not Path A.
From there Path A finishes one of two ways, and both are complete answers:

- **No user identity — the anonymous finish.** You hand over the live URL plus a
  save link the user opens to sign in and keep the site. This is the ordinary
  outcome, not a degraded one: it is exactly what the drop page itself does, and
  it works for someone who has never had a Wix account.
- **You hold the user's identity — the account finish.** Two more calls put the
  site in their Wix account and return its permanent URL and dashboard, with
  nothing left for them to do.

**[Path B — hand the user the drop page](#path-b--hand-the-user-the-drop-page).**
One URL. The user drags their files in themselves, gets the same instantly
hosted site, and signs in there to keep it. Use it when the files live only on
the user's machine, when you cannot make arbitrary HTTP requests, or — even if
you can call APIs — when you **cannot run a shell / direct file client** and your
only way out is the Wix API-call/execute-API tools. This is the right answer for
that case, not a consolation prize: the user gets the same hosted site.

Prefer Path A when it is genuinely available — the user gets a live site without
doing the upload themselves. But decide honestly on both conditions: if you
cannot read the bytes, or cannot do a real file upload from a shell, take Path B
rather than attempting the API path and reporting an upload you could not
actually perform. Do not try to force Path A through the API-call/execute tools;
route to Path B instead.

## Path A — publish the files yourself

Steps 1–3 put the site live and need no authentication at all. Step 3 then
branches on whether you hold the user's identity: without one you hand over the
site and a save link and you are done; with one you continue to steps 4 and 5
and finish the job yourself. Neither ending is a fallback for the other.

```
Base URL: https://www.wixapis.com/headless-business-setup
```

**Run this flow with your own shell / a direct HTTP client — not the Wix
API-call or execute-API tools.** Step 2 is a `multipart/form-data` upload that
reads files off disk, and the download in [Keep building](#keep-building-add-a-backend-when-you-need-one)
writes a file to disk — both are filesystem operations. The Wix API-call/execute
tools proxy a JSON request through the Wix API and return the result into the
conversation; they cannot pipe your local files in or write a download out. In
particular, do **not** hand-build a multipart body inside an execute-API call: it
can only carry text you inline into the code, so it silently drops every image
and font, and the manual encoding is brittle. Use `curl` (or any direct HTTP
client) for the whole flow — create and release are plain JSON, but the upload
needs a real file client anyway, so keep all of it in the shell.

**These direct calls need no auth.** Create, upload, release and the download are
all **anonymous** — no token, no login, no credentials. So even if your Wix
access is normally injected only into the API-call/execute-API tools, you do not
need it here: call these endpoints directly from your shell with no auth header
and they work. Don't reach for those tools just to borrow their credentials —
there's nothing to authenticate. The **only** call that needs the user's identity
is [step 4, claim](#4-put-the-site-in-the-users-account) (put the site in their
account); everything up to and including the live URL is credential-free.

The two calls that **must** use a direct file client are the ones that move a
file:

- **Step 2, upload** — `POST …/{metaSiteId}/upload`, a `multipart/form-data`
  request whose body is your files read from disk.
- **The download** in [Keep building](#keep-building-add-a-backend-when-you-need-one)
  — `GET …/instant-sites/{metaSiteId}/download.zip`, whose body is a zip you save
  to disk.

The other calls — **create** (`POST …/anonymous/{anonymousId}`) and **release**
(`POST …/{metaSiteId}/release`) — are small JSON in, small JSON out; calling those
through the Wix API-call/execute-API tools is fine, since you just read the
returned `metaSiteId` / `uploadId` / `siteUrl` from the response. It's only the
two file-transfer calls those tools can't do (they can't pipe a local file in or
write a downloaded file out). So the real capability question for Path A is
narrow: **can you do the multipart upload from disk?** If your only way to reach
APIs is the API-call/execute-API tools, you can't — use Path B. Simplest when you
can: run all of it with one shell/`curl`, since the upload needs it anyway.

Generate `anonymousId` yourself — any UUID, **once per site, not once per
request**. Reuse the same `anonymousId` and `metaSiteId` for every call for that
site, and keep them for the rest of the conversation: when the user asks to
change the site later, iterate on this same site (see [Iterate](#iterate-on-the-site-dont-create-a-new-one))
rather than creating another one. **The whole flow must finish within one hour
of step 1.** After that the site's record expires and every later step returns
`404`, including the claim, so do not leave the account step for a later session.

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

#### Iterate on the site (don't create a new one)

When the user asks to change the site after it's live — new copy, another page,
a different look — **update this same site in place. Do not go back to step 1.**
Re-run step 2 (upload) then step 3 (release) with the **same `anonymousId` and
`metaSiteId`** you already have; the new upload replaces the site's contents and
`siteUrl` stays the same. Send the full set of files each time (the release
publishes exactly what the upload contained — it is a replace, not a merge), so
include unchanged files too.

Creating a fresh site per change (a new `anonymousId`) instead leaves the user
with a trail of abandoned one-off sites and a different URL each time — only
create a new site when the user genuinely wants a separate, additional one.

This applies as long as the site is still anonymous and within its one-hour
window, so **do the iterating first and claim last** — keep refining on the same
anonymous ids, then claim once (step 4) when the site is right. Once the site has
been claimed into the user's account the anonymous endpoints no longer apply: to
keep changing a claimed site with code, move it to a headless project (see
[Keep building — add a backend](#keep-building-add-a-backend-when-you-need-one)),
and otherwise it's a normal Wix site the owner edits in Wix.

**3a. You have a user or account-level access token for the user.** Continue to
step 4 now. Do not stop here and hand over a temporary site: an unclaimed site
expires, so putting it in their account is part of publishing it, not an extra
favour to ask about.

**3b. You have no user identity.** Stop here — this is a finished, legitimate
result, and the one the drop page produces for every visitor. Give the user
`siteUrl` together with the save link, which is how the site survives:

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

### Keep building: add a backend when you need one

The drop flow publishes **static** files. When the site needs a real backend —
stores, payments, bookings, a CMS, members, forms — it should become a **Wix
Headless project**. This is a solution the user chooses when they need it, not a
required next step: a static marketing page is a finished result on its own.

Offer this once the site is the user's (claimed / owned) and you're in a coding
environment with a shell and a filesystem. It keeps the **same site, appId and
URL** — the downloaded project already carries a `wix.config.json` binding it to
this site — and from then on the project is released with the Wix CLI, not the
drop API.

**This is the post-claim path — and it's why it needs `wix login`.** Once the
site is claimed, changing it again is an *authenticated* operation, and there is a
hard constraint to understand: authenticated **file** operations need the token in
your shell, not in a tool. The drop flow avoided auth entirely (create / upload /
release / download are anonymous), and claim is small JSON so it can go through
the Wix API-call/execute-API tools or a shell token. But re-releasing files to a
claimed site is authenticated *and* file-based — and the API-call/execute-API
tools can't do file operations. So the way to keep building a claimed site is to
`wix login` (which puts a real account/site token in your shell) and work through
the **Wix CLI / headless project**. There is no lighter "re-upload static files to
my claimed site" shortcut: if you need to keep changing a claimed site with code,
it's the headless/CLI flow. (This is also why claiming *last* — iterating while
the site is still anonymous, then claiming once it's right — keeps the simple
path open for as long as possible.)

**Download the project to disk, then follow the headless guide:**

```bash
# Download to the local filesystem with a redirect-following HTTP client.
curl -sSL -o project.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
unzip project.zip -d project      # index.html + assets + wix.config.json
```

Then open `https://wix.com/headless/skill.md` and follow it: it turns the static
files into a headless project (`@wix/sdk` + the business solutions the site
needs) bound to the same site, released with the Wix CLI.

**Download to disk — never through the Wix API-call tools.** The download must
land on the machine as a file so the agent can edit it with filesystem
operations. Do **not** fetch it through the Wix API-call/execute tools (the ones
that run a request or JavaScript through the Wix API on your behalf): they return
the response into the conversation, not to disk — so even on success you'd get an
unusable blob instead of a project — and the download redirects to storage those
tools are not allowed to follow, so it fails outright. Use your own shell or a
direct HTTP client, as above.

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
- **Site files only on the user's machine; or you cannot make HTTP calls; or you
  have no shell / direct file client and can only reach APIs through the Wix
  API-call/execute-API tools** — Path B, the drop URL. (Those tools can't do the
  multipart file upload, so Path A is not open to you — send the user to the UI.)
- **A change to a site you already published this way in this conversation** —
  [iterate in place](#iterate-on-the-site-dont-create-a-new-one) with the same
  ids; don't publish a new site.
- **A published anonymous site the user now wants to keep** — steps 4 and 5 if
  you hold their identity, otherwise the save link from step 3b.
- **The site (claimed/owned) now needs a backend — stores, payments, bookings,
  CMS, members, forms** — [move it to a headless project](#keep-building-add-a-backend-when-you-need-one):
  download the project to disk and follow the headless guide; same site and URL.
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
