---
name: "Upload a Website or HTML Files"
description: Publish HTML, CSS, JavaScript or a static build as a Wix Headless website; inspect its deployed files and edit them on the same site and URL. Covers file and ZIP uploads, selective additions, replacements and deletions while preserving other files, full-site replacement, authenticated and anonymous publishing, verification, and connecting a Wix business backend; a Wix Astro build is released as a server-rendered site rather than dropped. Use for files the user supplies or pages you create for them. Not for migrating a live site from another platform by URL or CSV (use Site Import), embedding code in an editor-built Wix site, or uploading assets to Media Manager.
---

# Upload a Website or HTML Files

Wix serves uploaded static files at a `*.wix-site-host.com` URL. **A raw drop
replaces the entire file set: omitted files disappear.** The file helpers below
simulate a patch by downloading the current ZIP, merging changes, and dropping
the complete result. They preserve omitted files, but still transfer the full
site and are not atomic against another editor.

## Choose the task

| Request | Flow |
| --- | --- |
| Publish files as a new site | [Choose an upload route](#before-the-calls), [create once](#create-the-site), upload, [verify](#verify-and-report). |
| Publish a Wix Astro build | [Create once](#create-the-site) for a new site, then [release it](#release-a-wix-astro-build); it is not dropped. |
| Inspect or edit a deployed site | [Find its ID](#find-an-existing-site), then [list, read or patch](#change-it-later). Do not create another site. |
| Replace the entire deployed frontend | Confirm replacement of the serving frontend, then drop the complete intended file set on the same ID. |
| Make a shop, bookings, forms or other business controls work | [Connect a backend](#connect-a-backend) on the same site. A static upload alone does not make them functional. |
| Publish without a login | [Anonymous upload and release](#publish-anonymously), then claim or give the private save link. |
| Migrate a live site by URL or CSV/TSV | [Site Import](site-import.md), not this recipe. |
| Add an embed to an editor-built site / upload media assets | Use the editor / [Upload Media to Wix](../media/upload-media-to-wix.md), respectively. |

A request to publish or edit authorizes that work; do not ask again. A request
to inspect files authorizes no writes. Do not create from a template: that
creates an empty site rather than publishing the supplied files.

Quick reference: [upload through MCP](#drop-through-the-wix-mcp) ·
[upload with curl](#drop-with-curl) ·
[release an Astro build](#release-a-wix-astro-build) · [list/read](#list-and-read) ·
[patch](#patch-files) · [ZIP fallback](#download-edit-drop-fallback) ·
[images](#images) · [limits/errors](#limits-and-failures).

## Before the calls

Choose an already-authenticated route that can access the files, not by the
client's name. Check the available tools before choosing:

- **Wix MCP connected:** use `UploadHeadlessWebsiteFiles` for a complete
  upload and `ExecuteWixAPI` for API scripts and list/read/patch helpers.
  `ExecuteWixAPI` supplies authenticated `wix.request({ scope: 'account', ... })`,
  returning `{ status, data }`; no token or extra CLI login is needed.
- **Shell reaches Wix:** check `curl -sI https://www.wixapis.com` for an HTTP
  status. Run `npx @wix/cli@latest login` once for browser approval, then
  `npx @wix/cli@latest token`. Its token lasts 15 minutes; refresh after expiry
  or a `403`. Use it as `$ACCESS_TOKEN`. Without login, use the anonymous route.
- **Neither route works:** use [the drop page](#the-drop-page). Never claim an
  upload you could not perform.

Network access does not give access to files on the user's machine. If you
cannot read their files, ask for an attachment/export or give the drop page;
do not provision an empty site.

Build projects that need dependencies first, and upload only their static
output. If your environment cannot build the project, ask for the build output.
For a Wix business project, follow [Connect a backend](#connect-a-backend).

### Static pages or a Wix Astro build

| What you have | How it goes live |
| --- | --- |
| Static pages: HTML, CSS, JS, images, or a static build's output | **Dropped**, by every route in this recipe. |
| A Wix Astro build: `.wix/build-metadata.json` beside `dist/`, written by `astro build` with the Wix hosting adapter | **Released** as a server-rendered site, by `UploadHeadlessWebsiteFiles` only: [release a Wix Astro build](#release-a-wix-astro-build). Never dropped. |

A build's `dist/client/` dropped as static pages loses its server pages, and a
drop or patch on a site whose live release is a build replaces the build with
static files; nothing on the server stops that. [Change it later](#change-it-later)
tells the two apart before any edit.

The JavaScript examples below run in `ExecuteWixAPI`, not directly in a shell
or browser. Without MCP, use the curl examples and edit downloaded files locally;
`wix.request`, `wix.multipart` and `wix.headless.files` are sandbox utilities,
not public SDK methods.

For external file inputs on either MCP tool, use only parameters in its visible schema.
Prefer resolved `attachments`: they transport files without retyping them.
If an attachment arrives unresolved as a local path, retrying that path cannot
work; use supported text input or [another image route](#images).
`files` text input uses this unescaped format:

```text
=== FILE: index.html ===
<!doctype html><html><head><title>Northwind Studio</title>
<link rel="stylesheet" href="assets/styles.css"></head><body><h1>Northwind Studio</h1></body></html>
=== FILE: assets/styles.css ===
body { font-family: sans-serif; padding: 4rem; }
```

Each path is relative to the site root. This format cannot carry a file
containing an identical `=== FILE: … ===` delimiter line. Binary images are
not text input.

Replace example IDs with response values: `metaSiteId` is the site ID, not
`appId` or `uploadId`. `$AGENT` / `AGENT_SLUG` is your short lowercase
attribution slug, or `unknown-agent`. Raw uploads use
`?campaign=mcp&agent=$AGENT`. Never leave a `$NAME` placeholder inside a
JavaScript URL.

Read linked skills from disk when installed; otherwise use `ReadFullDocsArticle`
when available for Wix skill/docs URLs, with web fetch as fallback.

## Create the site

Create only for a new site. Use the page title, at most 40 characters. Keep
`origin: 'drop'`, empty `seedOptions`, and both synchronous steps:

```javascript
async function run() {
  return wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
    body: { origin: 'drop',
      newMetasite: { namingStrategy: { metaSiteName: 'Northwind Studio' }, seedOptions: [] },
      synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP'] }
  });
}
// result.data: { metaSiteId, appId }
```

The shell equivalent:

```bash
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/provision" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"origin":"drop","newMetasite":{"namingStrategy":{"metaSiteName":"Northwind Studio"},"seedOptions":[]},"synchronousSteps":["SET_METASITE_NAME","CONFIGURE_HEADLESS_APP"]}'
```

## Drop through the Wix MCP

If `UploadHeadlessWebsiteFiles` is available, pass the existing
`metaSiteId` as `siteId` and the **complete** files. It creates no site,
replaces all files, adds attribution, and returns the live URL and dashboard.
Prefer a ZIP attachment containing the whole site, including images; a single
wrapping folder is stripped. Its limit is 10 MB per call. Otherwise use the
`files` text format above.

Without that tool, use `ExecuteWixAPI`. File inputs belong in the
external `files` or `attachments` parameter, not inside `code`; the script
receives them as the `files` global. For individual files:

```javascript
async function run() {
  const siteId = 'META_SITE_ID';
  const mp = wix.multipart(files);
  return wix.request({ scope: 'account', method: 'POST',
    url: `https://www.wixapis.com/headless-business-setup/v1/headless-business/${siteId}/drop?campaign=mcp&agent=AGENT_SLUG`,
    headers: { 'Content-Type': mp.contentType }, body: mp.body });
}
// result.data: { uploadId, siteUrl }
```

For a single ZIP attachment, use
`wix.multipart(await wix.unzip(files[0].content))` instead. Its entries must
already be site-root-relative; this local unzip does not strip a wrapper.
Do not hand-build multipart while `wix.multipart` exists.

An older execution schema without file inputs can pass inline entries to
`wix.multipart([{ path, content }])`. In JavaScript template literals, escape
backslashes first, then backticks and `${`; otherwise text is reinterpreted.
Only if `typeof wix.multipart !== 'function'`, construct multipart yourself:
parts named `files`, site-relative path as `filename`, CRLF line endings,
closing `--<boundary>--`, and the same boundary in the Content-Type header.

## Drop with curl

One request uploads and releases. Each part is named `files`; its
`filename` is the site-root-relative path, preserving subdirectories:

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/$META_SITE_ID/drop?campaign=mcp&agent=$AGENT" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "files=@index.html;filename=index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css" \
  -F "files=@assets/logo.png;filename=assets/logo.png"
# { "uploadId": "...", "siteUrl": "https://...wix-site-host.com" }
```

A single ZIP part also works: it is unpacked server-side with one wrapping
folder stripped. `siteUrl` is the final address.

## Release a Wix Astro build

This recipe releases a build you have. Making one is the Wix Headless kit's run
(`https://www.wix.com/skills/headless-cold-start/headless-kit.md`), which states
its own requirements: Node, a reachable npm registry, the project's install. A
sandbox with no network cannot make one.

**Who releases from here:** the build has to reach `UploadHeadlessWebsiteFiles`,
by one of two carriers. Check before starting, measured rather than assumed:

| Carrier | Check |
| --- | --- |
| Attachments | Your client passes `attachments` as files (a local path swapped for a download URL when the call is made). |
| A shell that reaches the internet | `curl -sI https://s3.amazonaws.com` shows `Server: AmazonS3`. The upload URLs are on Amazon S3; a sandbox limited to a few hosts gets a proxy's refusal instead, which is an HTTP answer without that header. |

With neither, no build is released from here. For a new site, publish static
pages instead. For a site already released as a build, report that it cannot be
changed from this environment, and change nothing.

A build goes through `UploadHeadlessWebsiteFiles` and nothing else: no drop
route takes it. The site stays the same, at the same URL, now server-rendered.

- **Attached:** zip the project from its root after `astro build`, leaving out
  `node_modules`, `.env*` and caches, and pass the ZIP as `attachments`. The
  tool releases the build and stores the rest as the project's source in the
  site's Code Store repository, where a later session continues from. A ZIP of
  only `.wix/` and `dist/` releases too, storing no source.
- **From a shell, without attachments:** two calls. `{ siteId, prepare: true, size }`
  with the ZIP's `size` (`wc -c < build.zip`) answers with `curl` commands for
  the build ZIP and, when the site's repository takes it, a source ZIP; run them
  as given, then make the second call it names, with `uploadKey`. A 404 on the
  second call means the upload URL expired: prepare again. A prepared upload is
  finished by that second call and by nothing else: a release made another way
  (the ZIP attached, say) leaves the prepared upload behind and releases without
  its source, so a prepare that failed on the way is prepared again, not replaced
  by another carrier.

`expectedHeadRevisionId` is the repository revision the project started from:
the `headRevisionId` the prepare returned for a project made in this run, or
the `revision.id` it was [downloaded at](#a-site-released-as-a-wix-astro-build).
`EXPECTED_HEAD_REQUIRED` or a 409 means the repository holds newer work:
download it, carry the change over, and release again.

## Find an existing site

Reuse the ID from the earlier upload. If only a name or URL is known, query the
user's sites and match it; ask if ambiguous. The default namespace omits
headless sites, so explicitly filter `HEADLESS`:

```javascript
async function run() {
  return wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/site-list/v2/sites/query',
    body: { query: { filter: { namespace: 'HEADLESS', id: { $in: ['META_SITE_ID'] } },
      cursorPaging: { limit: 100 } } } });
}
// result.data.sites: match id/displayName/viewUrl
```

Omit the `id` filter when looking up by name/URL. While `data.metadata.hasNext`,
follow `data.metadata.cursors.next` with `{ query: { cursorPaging: { limit: 100,
cursor } } }`. See [Query Sites](query-sites.md) for name search on large accounts.
With a known ID, use `$in`, not a scalar ID or `$eq` (rejected).
Unclaimed anonymous sites instead use their saved ID and
[anonymous upload/release](#publish-anonymously).

## Change it later

Use the same site ID and URL. The file helpers and the ZIP fallback below edit
static pages: they read the site's last drop and drop the result. A site whose
live release is a Wix Astro build is changed in its project instead; a drop or
patch there replaces the build with static files, and the server does not stop
it. So first tell what is live.

When this conversation published the site, or the user says how it was made,
you know. Otherwise one read-only call tells, in `ExecuteWixAPI`:

```javascript
async function run() {
  return wix.request({ scope: 'account', method: 'GET',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/META_SITE_ID/files' });
}
// 200 { revision, files: [{ path, size }] }: the live site is its last static drop
```

| Answer | What is live | Do |
| --- | --- | --- |
| `200` | Its last static drop | [Edit the static pages](#a-site-of-static-pages). |
| `409 LIVE_SITE_CHANGED` | A release replaced the last drop: a Wix Astro build | [Change the project](#a-site-released-as-a-wix-astro-build). No drop, no patch. |
| `404 SITE_CODE_NOT_FOUND` | Nothing was ever dropped | Open the live URL. Pages there mean a build released without a drop: change the project. Nothing there means an empty site: drop as for a new one. |

### A site released as a Wix Astro build

The project lives in the site's Code Store repository, which is the managed
project whose id is the site's app id: `appId` in `wix.config.json`, or the
companion app. In `ExecuteWixAPI`, in site scope:

```javascript
async function run() {
  const siteId = 'META_SITE_ID';
  const app = await wix.request({ scope: 'site', siteId, method: 'POST',
    url: 'https://manage.wix.com/_api/companion-apps/v1/companion-apps/get-or-create', body: {} });
  const appId = app.data.companionApp.id;
  try {
    const dl = await wix.request({ scope: 'site', siteId, method: 'POST',
      url: `https://www.wixapis.com/codestore/v2/git-code-store-projects/${appId}/generate-download-url`, body: {} });
    return { appId, downloadUrl: dl.data.downloadUrl, revision: dl.data.revision };
  } catch (e) {
    return { appId, repository: false, error: String(e.message).slice(0, 200) };
  }
}
```

- **A download URL:** from a shell, `curl -o project.zip "<downloadUrl>"` (the
  URL is signed and lasts 5 minutes; `ExecuteWixAPI` cannot fetch it), unpack,
  `npm ci`, make the change, `npx astro build`, and
  [release the build](#release-a-wix-astro-build) with `revision.id` as
  `expectedHeadRevisionId`. The download holds the project without
  `node_modules` or `.env*` files. Without a shell that can build, report that
  the site is a server-rendered project and change nothing.
- **A 404 (`NOT_FOUND`, `GIT_BRANCH_NOT_FOUND`), or a repository whose root
  holds `index.html` rather than a project:** the project's source was not
  stored with the release. The site can be changed only from the project where
  it was built; report that, and change nothing here.

### A site of static pages

With `ExecuteWixAPI`, prefer its file helpers
for selective edits, not `UploadHeadlessWebsiteFiles`: sending only changed
files to that upload tool would remove omitted files. Without MCP, go directly
to the [ZIP fallback](#download-edit-drop-fallback).

The server may have helpers newer than the client's visible description.
Check once in `ExecuteWixAPI` without changing anything:

```javascript
async function run() {
  try {
    const h = wix.headless.files;
    return { fileHelpers: ['list', 'read', 'patch'].every(k => typeof h[k] === 'function') };
  } catch { return { fileHelpers: false }; }
}
```

If false, use the [ZIP fallback](#download-edit-drop-fallback). Do not retry a
missing helper or invent `UploadHeadlessWebsiteFiles` parameters such as `mode: 'merge'`.
These execution helpers do not change the full-replacement upload contract.
List/read/inline edits work without external file inputs.

### List and read

```javascript
async function run() {
  return wix.headless.files.list({ siteId: 'META_SITE_ID', prefix: 'assets/', offset: 0, limit: 100 });
}
// { files: [{ path, bytes, contentType }], total, offset, hasMore }
```

Omit `prefix` to list all paths. Default limit is 100, maximum 200; advance
`offset` by the limit while `hasMore`. The size field is `bytes`, not `size`.

```javascript
async function run() {
  return wix.headless.files.read({ siteId: 'META_SITE_ID', path: 'index.html' });
}
// { path, bytes, contentType, text }
```

`text` is a **string**, not a method. Read supports UTF-8 text up to 256,000
bytes; use the ZIP fallback for larger/binary files. Helpers exclude the
generated `wix.config.json`. Each list/read fetches a fresh full snapshot, so
request only needed paths/pages; for bulk inspection download once instead.

### Patch files

For a small edit, keep the original in the execution sandbox and guard the
replacement. Do not return/retype the whole file just to change one string:

```javascript
async function run() {
  const siteId = 'META_SITE_ID';
  const current = await wix.headless.files.read({ siteId, path: 'index.html' });
  const before = 'Welcome to Bloom Cafe';
  if (current.text.split(before).length !== 2) throw new Error('Expected one headline; inspect before editing.');
  return wix.headless.files.patch({ siteId, agent: 'AGENT_SLUG',
    files: [{ path: current.path, content: current.text.replace(before, 'Bloom Cafe — Now Open') }] });
}
```

For authored additions/replacements, pass only changed files through supported
external file inputs, then:

```javascript
async function run() {
  return wix.headless.files.patch({ siteId: 'META_SITE_ID', files,
    deletePaths: ['old-offer.html'], agent: 'AGENT_SLUG' });
}
```

If the visible `ExecuteWixAPI` schema has neither `files` nor `attachments`,
do not reference the `files` global. Supply changed text files inline as
`files: [{ path: 'hours.txt', content: 'Mon–Fri 8–5' }]` instead. Helper
availability does not imply file-input support; use the ZIP/shell fallback
for binary additions that cannot be supplied.

- Omitted paths are preserved. Delete only with explicit `deletePaths`; omit it
  when nothing should be removed. Delete-only: `files: []` plus exact paths.
- Rename: supply the new path with the original bytes and delete the old path.
  Never write and delete the same path.
- ZIP inputs expand without stripping a project folder. Paths must be literal,
  case-sensitive, site-relative; duplicate/unsafe paths and `wix.config.json`
  are rejected. Keep a root `index.html` or `index.htm` in the final site.
- Serialize edits. Neither read-then-patch nor patch's internal
  download/merge/drop protects against a concurrent writer.

Inspect `summary.added/replaced/deleted/unchanged/missingDeletes`.
`unchanged` means supplied files already matched byte-for-byte; omitted files
are preserved too. `published: false` means no byte change, not failure.
A publish returns `siteUrl`, `uploadId`, `fileCount`. Then
[verify](#verify-and-report).

### Download, edit, drop fallback

For older servers, bulk/binary reads, or a shell workflow, obtain the current
ZIP rather than reconstructing the site from memory:

```bash
curl -sSL -H "Authorization: Bearer $ACCESS_TOKEN" -o current.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
```

In an execution script, use `responseType: 'base64'` and feed `data` directly
to `wix.unzip`. Entries contain `{ path, bytes, text() }`: unlike helper
reads, **`text()` is a method**. Call it only on known text files. Here is a
complete guarded edit; untouched assets remain bytes:

```javascript
async function run() {
  const siteId = 'META_SITE_ID';
  const r = await wix.request({ scope: 'account', method: 'GET', responseType: 'base64',
    url: `https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/${siteId}/download.zip` });
  if (r.status !== 200) throw new Error('Snapshot unavailable; do not publish a partial site.');
  const entries = (await wix.unzip(r.data)).filter(e => e.path !== 'wix.config.json');
  const byPath = new Map(entries.map(e => [e.path, e]));
  const page = byPath.get('index.html');
  if (!page) throw new Error('Missing index.html; inspect the inventory.');
  const before = 'Welcome to Bloom Cafe', text = page.text();
  if (text.split(before).length !== 2) throw new Error('Expected one headline; inspect before editing.');
  byPath.set(page.path, { path: page.path, content: text.replace(before, 'Bloom Cafe — Now Open') });
  const mp = wix.multipart([...byPath.values()]);
  return wix.request({ scope: 'account', method: 'POST',
    url: `https://www.wixapis.com/headless-business-setup/v1/headless-business/${siteId}/drop?campaign=mcp&agent=AGENT_SLUG`,
    headers: { 'Content-Type': mp.contentType }, body: mp.body });
}
```

Reuse the download/unzip portion for these operations:

| Operation | Script after obtaining `entries` / `byPath` |
| --- | --- |
| List only | `return entries.map(e => ({ path: e.path, bytes: e.bytes.length }));` No drop. |
| Read only | Find the exact entry, fail if missing, then `return entry.text();` for a known text file. No drop. |
| Add/replace | `byPath.set('hours.txt', { path: 'hours.txt', content: 'Mon–Fri 8–5' });` |
| Delete | `byPath.delete('old-offer.html');` |
| Merge supplied individual files | `for (const e of files) byPath.set(e.path, e);` |

For a single supplied ZIP, use `await wix.unzip(files[0].content)` instead of
`files` in that merge loop; its entries must be site-root-relative.
For mutations, validate paths and the final homepage, then drop **all** map
values. Leave `wix.config.json` out; preserve other unchanged entries as bytes.
Never pass only a delta to a raw drop. For a shell edit, likewise preserve the
downloaded files and upload the complete result.

If snapshot access is blocked by host policy, use authenticated curl or request
the complete current ZIP. Do not keep retrying, bypass the policy, or claim to
preserve files you could not retrieve. A failed file lookup is not evidence
that the site is empty.

## Verify and report

1. Check publication status and returned URL. For a patch, compare its change
   summary with the requested paths, including missing deletions.
2. Check the saved changed files using read or the ZIP; confirm removals and
   preservation of unrelated assets. Do not treat a successful drop alone as
   proof that the requested edit is correct.
3. When available, open the live page and exercise the changed UI. HTTP/HTML
   retrieval can verify delivery, but not layout or JavaScript behavior.
   If live fetch/browser access is blocked, report the saved-file checks and
   that limitation; do not claim a browser test.

If a call fails after publishing, inspect the current snapshot before retrying:
the write may have succeeded and only its subsequent verification failed.
Avoid repeating a mutation merely because the last call returned an error.

Give the live URL, what changed, what was verified, and any missing assets.
On first authenticated publish (or after claim), also give
`https://manage.wix.com/dashboard/{metaSiteId}` and
[domain connection](../domains/domain-search-purchase-and-connect.md) options
for a Wix-purchased or existing domain. For an unclaimed anonymous site, give
the live URL and private save link instead, not a dashboard link.

## Connect a backend

A static page cannot itself provide stores, payments, bookings, CMS, members
or forms. For an uploaded mock, publish it, then name the nonfunctional
buy/book/order/join/submit/pay controls, what Wix solution and content would
be created, and ask before connecting. A request for a working shop or real
bookings already supplies that consent; do not stop at a static mock.

Use the headless skill on the **same site, appId and URL**, not another site.
[Claim an anonymous site](#claim-it-into-the-users-account) first.

- With a build-capable shell, read
  `https://www.wix.com/skills/headless-cold-start/headless-kit.md`. It installs
  the skills, checks CLI login, then hands off to the kit for deployment,
  seeding, build and release. Start from the site's downloaded ZIP, unpacked
  into a project folder.
- With MCP execution only, read
  `https://www.wix.com/skills/wix-headless-kit/guides/api-run.md` for the API
  route, then upload the frontend as above.

## Images

SVG is text; other images are bytes. Prefer, in order:

1. Local originals included in the curl drop.
2. Resolved file/ZIP attachments.
3. A direct public image URL kept in the page, or imported through
   `UploadImageToWixSite` when available using `imageUrls`; use its returned
   `static.wixstatic.com` URL. A sharing page is not a direct file URL.
4. Tool-encoded `imageBase64` with `mimeType`, one image per call, if the
   tool exposes those fields. Never synthesize base64 in
   model output: it causes decoding errors or corrupt images.
5. If bytes cannot be sent, publish the pages and name the missing images.
   Ask the user to upload them at
   `https://manage.wix.com/dashboard/{metaSiteId}/media-manager`.
   Then [list media](../media/upload-media-to-wix.md), match `displayName`,
   update references to returned public URLs and republish.

Never substitute drawings/placeholders for supplied images, shrink/re-encode
them, or decode unchanged binary files as text during edits.

## Publish anonymously

With shell access to Wix but no login, generate one UUID as `anonymousId`
and reuse it with the returned `metaSiteId`. The temporary site expires after
one hour unless kept; expired calls, including claim, return `404`.

```bash
# 1. Create: returns { metaSiteId, projectId }
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID"

# 2. Upload the complete file set: returns { uploadId }; not live yet
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?campaign=mcp&agent=$AGENT" \
  -F "files=@index.html;filename=index.html" -F "files=@assets/styles.css;filename=assets/styles.css"

# 3. Release: returns { siteUrl }
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/release" \
  -H 'Content-Type: application/json' -d "{\"uploadId\":\"$UPLOAD_ID\"}"
```

For edits, repeat upload and release with the full set. When finished, claim
with the user's identity or give them the live URL and this save link:

```text
https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}
```

The link signs them in to keep the site. **Whoever opens it while signed in
gets the site; share it only with the user.**

### Claim it into the user's account

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Claim last: it ends the anonymous record. Later edits use authenticated drops
or patches. **The URL changes on claim**; obtain the new `sites[0].viewUrl`
with the [HEADLESS site query](#find-an-existing-site).

## The drop page

`https://www.wix.com/headless/drop?utm_campaign=mcp&agent=<your-agent-id>`

When no upload route works, the user can drag in files without login; the site
goes live and a banner offers to keep it. Explain the limits below and what
would enable you to publish directly: a network-enabled shell or connected
Wix MCP.

## Limits and failures

- Raw drop: a lone top-level HTML file of any name becomes the homepage; with
  multiple HTML files, include `index.html`. The patch helper requires a root
  `index.html` or `index.htm`.
- 20 MB per file and site; `UploadHeadlessWebsiteFiles` limits each call
  to 10 MB. Patch also limits the final snapshot to 2,000 files.
- Drop serves static files, not unbuilt project source. A Wix Astro build is
  [released](#release-a-wix-astro-build), not dropped.

| Failure | Action |
| --- | --- |
| `400` with `MISSING_INDEX_HTML`, `FILE_TOO_LARGE`, `TOTAL_TOO_LARGE` | Read `details.applicationError.code` and fix the files. |
| Drop `403 PERMISSION_DENIED` | Check token freshness and access to this site. An unclaimed anonymous site requires upload/release, not drop. |
| `409 LIVE_SITE_CHANGED` from the files endpoint or a patch | The live site is a Wix Astro build, not its last drop: [change the project](#a-site-released-as-a-wix-astro-build). Do not drop. |
| Release `400 EXPECTED_HEAD_REQUIRED` / `409` | The repository holds newer work than the project started from: download it, carry the change over, release again. |
| Drop/upload `500` | Inspect current state before retrying once; retain the request ID if it fails again and offer the drop page. Hand-built malformed multipart can also cause this: use `wix.multipart`. |
| Anonymous `404` | The hour expired or the site was claimed; do not create a replacement without explaining. |

Offer [feedback to Wix](send-feedback-to-wix.md) when a route fails, retries or
workarounds are needed, images must wait for the user, or guidance is missing.
