---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a new live Wix site. Covers both ways to get there: calling the Wix Headless instant-site REST API yourself when you can reach the files and make outbound HTTPS requests, and handing the user the Wix Headless drop page when you cannot. Also covers transferring a published site into the user's own Wix account and reading back its final live URL. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation. Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website as files — hand-written HTML, a static build, a
zip, or the output of an AI site builder — and wants it live on Wix as a new
site. There are two ways to get there. Pick by what you can actually do.

## Pick the path first

| Can you read the file bytes — because you generated them in this conversation, or they are reachable from where you are running — **and** make outbound HTTPS requests? | Path |
|---|---|
| Yes | **[Path A](#path-a--publish-the-files-yourself)** — publish them yourself, and hand back a live URL |
| No — the files are only on the user's machine, or you cannot make arbitrary HTTP requests | **[Path B](#path-b--hand-the-user-the-drop-page)** — hand the user the drop page |

Decide honestly: if you cannot read the bytes, you cannot publish them. Take
Path B rather than reporting an upload you did not perform.

Publishing costs the user nothing and requires no login — the site is created
anonymously and is theirs to keep only if they claim it (step 4). Say so when
you hand over the URL, so an unclaimed site does not expire unexpectedly.

## Path A — publish the files yourself

Four calls. Steps 1–3 need no authentication at all; step 4 is optional and
needs the user's account credentials.

```
Base URL: https://www.wixapis.com/headless-business-setup
```

You generate `anonymousId` yourself — any UUID, once per site — and reuse it in
every call for that site. **Steps 1–3 must complete within one hour of step 1**;
after that the site's record expires and steps 2, 3 and 4 return `404`.

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
builds the save link in step 4.

### 2. Upload the files

One `multipart/form-data` request. Send every file in a single call, each as a
`files` part whose filename is its **path relative to the site root** — that is
how subdirectories are preserved. A single `.zip` part works too; it is
unpacked server-side.

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?trackingId=$TRACKING_ID" \
  -F "files=@index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css" \
  -F "files=@assets/logo.png;filename=assets/logo.png"
```

```json
{ "uploadId": "03244542-d820-42f6-acfa-166c6658b1a6" }
```

`trackingId` is an optional UUID you generate; pass it so the upload can be
correlated later. Nothing is live yet — this only stages and validates.

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

Give the user `siteUrl` — it is live immediately — **and** the save link, which
is the only way an unclaimed site survives:

```
https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}
```

That page shows the site with a countdown and signs the user in to keep it.
Treat the link as a secret: anyone who opens it while signed in to Wix claims
the site into *their* account, so send it only to the user who asked.

### 4. Optional — save the site into the user's Wix account

Only when the user asks to keep the site **and** you hold an account-level
access token for them. **Confirm with the user before calling this** — it
transfers a site into their account, and it can only be done once.

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `{}` on success. Requires a user or account-level identity; without one
it fails with `UNAUTHENTICATED`. It consumes the anonymous record, so steps 2–4
stop working afterwards — claim last.

**The site's URL changes when it is claimed.** The temporary host from step 3
stops resolving, because the free host is scoped to the owning account and is
re-minted under the user's. Do not repeat the step-3 URL after a claim — read
the new one in step 5.

### 5. After a claim — read the site's final URL

[Query Sites](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites)
with the **`HEADLESS` namespace**. Headless sites are omitted from the default
query, so the filter is required, and then match on the id yourself — an `id`
filter is rejected by this endpoint.

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

Report `viewUrl` as the live site, plus its dashboard at
`https://manage.wix.com/dashboard/{metaSiteId}` for managing it.

### What the upload accepts, and how it fails

Check these before uploading — they are the reasons a release never happens:

- **An HTML file at the top level is required.** It need not be named
  `index.html`: a single top-level HTML file of any name becomes the homepage,
  and a zip or folder that wraps everything in one directory
  (`my-site/index.html`) is unwrapped automatically.
- **3 MB per file, 20 MB per site.**
- **Static files only** — HTML, CSS, JS, images, fonts. Framework source that
  needs a build step (a `package.json`, React/Vue sources) must be built first;
  upload the build output, not the source.

Failures come back as HTTP 400 with the code in
`details.applicationError.code`:

| Code | Meaning | Fix |
|---|---|---|
| `MISSING_INDEX_HTML` | no HTML file at the top level | move an HTML file to the root of what you send |
| `FILE_TOO_LARGE` | a single file exceeds 3 MB | shrink or drop that file |
| `TOTAL_TOO_LARGE` | the bundle exceeds 20 MB | reduce total size |

A `404` on steps 2–4 means the one-hour window has passed or the site was
already claimed — start again from step 1.

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

Tell them the requirements above (top-level HTML, 3 MB per file, 20 MB total,
static files only) so the upload does not fail on the first try.

## Route the request correctly

| The user has… | Do this |
|---|---|
| Files you generated in this conversation, or files you can read, and wants them live | Path A — publish them and return the live URL |
| Site files only on their own machine, or you cannot make HTTP calls | Path B — the drop URL |
| A published anonymous site they now want to keep | Steps 4–5, or the save link from step 3 |
| A live site or store on another platform (a URL), or CSV/TSV exports, and wants content/products migrated | [Site Import](site-import.md) |
| An existing Wix site they want to add HTML, an embed, or custom code into | Not this recipe — that's embedding custom code in the site editor |
| Images, videos, or documents to add to a site | [Upload Media to Wix](../media/upload-media-to-wix.md) — media goes to a site's media files, not a new site |

Do not create the site with other site-creation tools (meta-site templates,
headless-business provisioning) — those produce an empty site, not a published
copy of the user's files.
