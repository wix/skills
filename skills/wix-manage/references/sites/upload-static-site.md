---
name: "Upload a Website or HTML Files"
description: Publish HTML, CSS, JavaScript or a static build as a Wix Headless website; inspect its deployed files and edit them on the same site and URL. Covers file and ZIP uploads, selective additions, replacements and deletions while preserving other files, full-site replacement, authenticated and anonymous publishing, verification, and connecting a Wix business backend; a Wix Astro build is released as a server-rendered site rather than dropped. Use for files the user supplies or pages you create for them. Not for migrating a live site from another platform by URL or CSV (use Site Import), embedding code in an editor-built Wix site, or uploading assets to Media Manager.
---

# Upload a Website or HTML Files

Wix serves uploaded static files at a `*.wix-site-host.com` URL. **A raw drop
replaces the entire file set: omitted files disappear.** `UploadHeadlessWebsiteFiles`
and the file helpers below merge instead: they download the current files, apply
the changes, and drop the result. They preserve omitted files, but still
transfer the full site and are not atomic against another editor.

**What this recipe publishes is static pages.** A site whose content lives in Wix
(a blog, a store, bookings, events, a CMS, forms, members, payments, among
others) is a Wix Headless build: the solution's app on the site, its content in Wix, pages that
read it. That build is Wix's headless guide,
`https://www.wix.com/headless/skill.md`; this recipe is its site call and its
drop, not the build. Pages with that content written into them are a mock of
the site, not the site, and a request for a working one is not met by a mock.
The build runs from here through the tools alone, as the guide's "The run, through the
plugin": the provision below with the solution in `seedOptions`, the content
created through `ExecuteWixAPI`, and pages that read it dropped with the upload
tool.

## Choose the task

| Request | Flow |
| --- | --- |
| Publish files as a new site | [Choose an upload route](#before-the-calls), [create once](#create-the-site), upload, [verify](#verify-and-report). |
| Publish a Wix Astro build | [Create once](#create-the-site) for a new site, then [release it](#release-a-wix-astro-build); it is not dropped. |
| Inspect or edit a deployed site | [Find its ID](#find-an-existing-site), then [list, read or patch](#change-it-later). Do not create another site. |
| Replace the entire deployed frontend | Confirm replacement of the serving frontend, then upload the complete intended file set on the same ID with `replaceAll: true`, or drop it raw. |
| A blog, a store, bookings, events, a CMS, forms, members, payments, and the like: anything whose content lives in Wix | Wix's headless guide, `https://www.wix.com/headless/skill.md`, on the site this recipe creates ([Connect a backend](#connect-a-backend)). A static upload alone does not make them functional. |
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
[media](#images-video-audio-and-documents) · [limits/errors](#limits-and-failures).

## Before the calls

Choose an already-authenticated route that can access the files, not by the
client's name. Check the available tools before choosing:

- **Wix MCP connected:** use `UploadHeadlessWebsiteFiles` to upload files (the
  whole site the first time, the changed files later, each one complete) and
  `ExecuteWixAPI` for API scripts and list/read/patch helpers.
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
For a site whose content lives in Wix, read `https://www.wix.com/headless/skill.md`
before the first call ([Connect a backend](#connect-a-backend)).

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
An attachment carries only its file name, not the folder it came from: a file
attached on its own lands at the top of the site, so attach a site with folders
as one ZIP.
If an attachment arrives unresolved as a local path, retrying that path cannot
work; use supported text input or [another media route](#images-video-audio-and-documents).
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
`origin: 'agent'` and both synchronous steps. A site that carries a Wix business solution
names it in `seedOptions`, one entry per solution from `STORES`, `BLOG`, `BOOKINGS`,
`EVENTS`, `PORTFOLIO`, `PRICING_PLANS`: the provision installs that app on the site, with
no demo content. A static site sends no `seedOptions`. `agent` names what is building the site,
three parts joined by `/`: the client product as its vendor writes it, lowercase; the surface, one of
`chat`, `work`, `web`, `cli`, `desktop`, `ide`, `app`; the model as the client's selector shows it.
`chatgpt/work/gpt-6.1`, `claude-code/cli/opus-5.5`. A part you cannot tell is `unknown`.

```javascript
async function run() {
  return wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
    body: { origin: 'agent', agent: 'chatgpt/work/gpt-6.1',
      newMetasite: {
        namingStrategy: { metaSiteName: 'Northwind Studio' },
        // a blog site; leave seedOptions out for static pages
        seedOptions: [{ businessSolution: 'BLOG', clearTemplateContent: true, seedDemoContent: false }]
      },
      synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP'] }
  });
}
// result.data: { metaSiteId, appId }
```

A site whose content lives in Wix continues in the headless guide,
`https://www.wix.com/headless/skill.md`: the content is seeded through the API and
the pages read it. The drops below are for static pages.

The shell equivalent:

```bash
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/provision" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"origin":"agent","agent":"chatgpt/work/gpt-6.1","newMetasite":{"namingStrategy":{"metaSiteName":"Northwind Studio"},"seedOptions":[{"businessSolution":"BLOG","clearTemplateContent":true,"seedDemoContent":false}]},"synchronousSteps":["SET_METASITE_NAME","CONFIGURE_HEADLESS_APP"]}'
```

## Drop through the Wix MCP

If `UploadHeadlessWebsiteFiles` is available, pass the existing
`metaSiteId` as `siteId` and the files: the whole site on a first upload, only
the changed files later, each one complete. It creates no site. On a site that
already has files it writes the files sent and keeps the rest; `deletePaths`
removes files, and `replaceAll: true` keeps only the files sent. It adds
attribution, and returns the live URL, the dashboard and the site's files.
Prefer a ZIP attachment containing the whole site (media goes in
[Wix Media](#images-video-audio-and-documents)): it keeps
the site's folders, and a single wrapping folder is stripped. Its limit is
10 MB per call. Otherwise use the `files` text format above.

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
| Attachments | Your client passes `attachments` as files (a local path swapped for a download URL when the call is made). The tool's `attachments` description names the clients that do; a client that is not named, or that shows no way to pass a file, has no attachment carrier, whatever its shell can do. |
| A shell that reaches the internet | `curl -sI -m 25 https://s3.amazonaws.com` answers with S3's own headers: `x-amz-request-id`, and `Server: AmazonS3` unless a proxy in front rewrote the Server header to its own name. The upload URLs are on Amazon S3; a sandbox limited to a few hosts gets a proxy's refusal instead, an HTTP answer with neither header. A sandbox proxy can take ten seconds to answer. |

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
  as given, then make the second call it names:
  `{ siteId, uploadKey, sourceUploadId?, expectedHeadRevisionId?, releaseNotes? }`. A 404 on the
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

Use the same site ID and URL. Do not keep backups, old copies of pages, `.map`
files, or binaries split into text parts in the site. The file helpers and the ZIP fallback below edit
static pages: they read the site's last drop and drop the result. A site whose
live release is a Wix Astro build is changed in its project instead; a drop
there replaces the build with static files. The file helpers' `patch` and an
`UploadHeadlessWebsiteFiles` upload without `replaceAll` check this themselves
and stop when another release is live; a raw drop and the ZIP fallback do not.
So first tell what is live.

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
| `409 LIVE_SITE_CHANGED` | Wix reports a release other than the last drop. Usually a Wix Astro build, but a site with no `prod` release answers this too while its drop is what is live | In `ExecuteWixAPI`, `fetch()` the site's `*.wix-site-host.com` address (listed by `GET https://www.wixapis.com/urls-server/v2/published-site-urls`, site scope; the sandbox fetches only your own sites at that host, not a custom domain) and compare the page with the drop's `index.html`, leaving out the `wix-site-script` tag. The same page: edit the static pages (the helpers' `patch` makes this check itself). Another page: [change the project](#a-site-released-as-a-wix-astro-build); no drop, no patch. |
| `404 SITE_CODE_NOT_FOUND` | Nothing was ever dropped | A new site gets its files with a first full upload, as for a new one. A site released as a Wix Astro build without a drop is changed in its project. |

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
  `node_modules` or `.env*` files. Where the kit cannot run (the guide's measured
  facts), report that the site is a server-rendered project and change nothing.
- **A 404 (`NOT_FOUND`, `GIT_BRANCH_NOT_FOUND`), or a repository whose root
  holds `index.html` rather than a project:** the project's source was not
  stored with the release. The site can be changed only from the project where
  it was built; report that, and change nothing here.

### A site of static pages

A file sent replaces that file whole. Read the current file first
(`wix.headless.files.read`, or the copy uploaded in this conversation), make the
change in it, and send the whole result. A stylesheet sent with only the new
rules leaves every page unstyled.

Both MCP routes keep the files an edit does not send: `UploadHeadlessWebsiteFiles`
with the changed files, or `ExecuteWixAPI`'s file helpers below, which also edit
a page in place without sending it back through you. Without MCP, go directly
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
missing helper, or pass a parameter the tool's visible schema does not list.
List/read/inline edits work without external file inputs.

### List and read

```javascript
async function run() {
  return wix.headless.files.list({ siteId: 'META_SITE_ID', prefix: 'assets/', offset: 0, limit: 100 });
}
// { files: [{ path, bytes, contentType }], total, offset, hasMore }
```

Omit `prefix` to list all paths. Default limit is 100, and one call lists at
most 200 (a larger limit lists 200); advance `offset` by the files returned
while `hasMore`. The size field is `bytes`, not `size`.

```javascript
async function run() {
  return wix.headless.files.read({ siteId: 'META_SITE_ID', path: 'index.html' });
}
// { path, bytes, totalBytes, contentType, text, offset, length, hasMore }
```

`text` is a **string**, not a method. One read returns at most 256,000 bytes of
a UTF-8 text file, from byte `offset` (default 0), cut on a character boundary.
A larger file comes back in parts: read on from `offset + length` while
`hasMore`. To edit a large file, join the parts and patch in the same function,
without returning the text:

```javascript
async function run() {
  const siteId = 'META_SITE_ID';
  let text = '', offset = 0, part;
  do {
    part = await wix.headless.files.read({ siteId, path: 'index.html', offset });
    text += part.text;
    offset = part.offset + part.length;
  } while (part.hasMore);
  // edit `text` here, then patch as below
  return { bytes: part.totalBytes };
}
```

A read without `hasMore` in its answer is from an older server, which refuses
text over 256,000 bytes: use the [ZIP fallback](#download-edit-drop-fallback)
for that file. Read takes one `path`, not a list, and text files only; binary
files are read through the ZIP fallback. Helpers exclude the generated
`wix.config.json`. The list and read calls in one `ExecuteWixAPI` call share
one download of the site; each new call downloads it again.

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

For authored additions/replacements, pass only the changed files, each one
complete, through supported external file inputs, then:

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
- Patch first checks that the live site is its last static drop. On a site
  live as a Wix Astro build it stops and changes nothing: change the
  [project](#a-site-released-as-a-wix-astro-build) instead.

Inspect `summary.added/replaced/deleted/unchanged/missingDeletes`.
`unchanged` means supplied files already matched byte-for-byte; omitted files
are preserved too. `published: false` means no byte change, not failure.
A publish returns `siteUrl`, `uploadId`, `fileCount`. Then
[verify](#verify-and-report).

### Download, edit, drop fallback

When the file helpers are missing, for binary files, or for a shell workflow,
obtain the current ZIP rather than reconstructing the site from memory. In
`ExecuteWixAPI` the whole site is then held in memory several times over (the
base64 answer, its bytes, the unzipped files), and a large site can exceed the
sandbox's memory limit, so prefer the helpers for text. This route does not
check what is live: tell that first, as in [Change it later](#change-it-later).

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

Give the user two links, each on its own line and named for what it is: the
live site, `{siteUrl}`, and the site's dashboard,
`https://manage.wix.com/dashboard/{metaSiteId}`. Every publish and every edit
closes with both. Then what changed, what was verified, any missing assets, and
[domain connection](../domains/domain-search-purchase-and-connect.md) options:
a domain bought through Wix, or one the user already owns. For an unclaimed
anonymous site, give the live URL and private save link instead, not a
dashboard link.

## Connect a backend

A static page cannot itself provide stores, payments, bookings, a CMS, members
or forms. A site that needs them continues in Wix's headless guide,
`https://www.wix.com/headless/skill.md` (what `StartHeadlessBuild` returns),
section "The run, through the plugin": the same site, `appId` and URL, the
solution installed, its content created through `ExecuteWixAPI`, the pages
rewritten to read it and uploaded here again. A request for a working shop or
real bookings already supplies the consent; do not stop at a static mock. An
anonymous site is [claimed](#claim-it-into-the-users-account) first.

## Images, video, audio and documents

Upload photos, video, audio and documents (PDFs) to the site's Wix Media with
`UploadImageToWixSite` and link the returned URLs. Keep only small assets in the
site files: SVG, icons, the logo, the favicon, fonts.

- One call for all files: `imageUrls` for direct file URLs, resolved
  attachments in `image`, or `imageBase64` with `mimeType` for one local file.
  Never synthesize base64 in model output. A sharing page is not a direct file
  URL.
- From a shell, upload a large local file (a video) through
  [Wix Media's upload URL](../media/upload-media-to-wix.md).
- Video: link `https://video.wixstatic.com/video/<id>/file`; it plays before
  processing finishes.
- Image at a set size: `<url>/v1/fill/w_800,h_450,al_c,q_80,enc_auto/<name>.jpg`.

If the bytes cannot be sent, publish the pages and name the missing files.
Ask the user to upload them at
`https://manage.wix.com/dashboard/{metaSiteId}/media-manager`.
Then [list media](../media/upload-media-to-wix.md), match `displayName`,
update references to returned public URLs and republish.

Never substitute drawings/placeholders for supplied images, shrink/re-encode
them, or decode unchanged binary files as text during edits. Never link a
picture from another website into a page (a stock library, someone else's
photos): import it as above, or leave it out.

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
- 20 MiB for all of a site's files together; `UploadHeadlessWebsiteFiles`
  limits each call to 10 MB. Patch also limits the final snapshot to 2,000
  files.
- Drop serves static files, not unbuilt project source. A Wix Astro build is
  [released](#release-a-wix-astro-build), not dropped.

| Failure | Action |
| --- | --- |
| `400` with `MISSING_INDEX_HTML`, `FILE_TOO_LARGE`, `TOTAL_TOO_LARGE` | Read `details.applicationError.code` and fix the files. |
| The drop answers an HTML `400 Bad Request` page | The site is over 20 MiB. Do not retry. Move its largest media to [Wix Media](#images-video-audio-and-documents), relink it, remove those files with `deletePaths`, upload again. |
| Drop `403 PERMISSION_DENIED` | Check token freshness and access to this site. An unclaimed anonymous site requires upload/release, not drop. |
| A patch or an upload stops: "is live as something other than its last static upload" | Wix reports another release and the live home page is not the drop's, so a drop would put old files back over what is live. Do not drop. Ask the user how the site was made; for a Wix Astro build, [change the project](#a-site-released-as-a-wix-astro-build). To replace what is live with static pages on purpose, upload the whole site with `replaceAll: true`. Do not tell the user it is an Astro build unless you know it is. |
| A helper's "has no static files on Wix hosting" (`404 SITE_CODE_NOT_FOUND`) | Nothing was ever dropped. A new site gets its first full upload; a site released as a Wix Astro build is changed in its project. |
| Release `400 EXPECTED_HEAD_REQUIRED` / `409` | The repository holds newer work than the project started from: download it, carry the change over, release again. |
| Drop/upload `500` | Inspect current state before retrying once; retain the request ID if it fails again and offer the drop page. Hand-built malformed multipart can also cause this: use `wix.multipart`. |
| Anonymous `404` | The hour expired or the site was claimed; do not create a replacement without explaining. |

Offer [feedback to Wix](send-feedback-to-wix.md) when a route fails, retries or
workarounds are needed, images must wait for the user, or guidance is missing.
