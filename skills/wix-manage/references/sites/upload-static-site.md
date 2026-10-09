---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a live Wix site. Covers every way to get there — publishing straight into the user's Wix account when you hold their identity, publishing anonymously with a save link when you don't, and handing the user the Wix Headless drop page, or releasing it as a Wix Headless project — and how to get the user's identity through the Wix CLI. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation, or to update a site published this way (replace its files on the same site and URL, or change it from the site's Dev Machine, a remote shell Wix provides per headless site). Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website as files — hand-written HTML, a static build, a
zip, or the output of an AI site builder — and wants it live on Wix as a static,
Wix-hosted site.

## Choose the route

Five ways to get the files live; what you have decides which are open to you.

| Option | Needs | Carries | The user ends up with |
| --- | --- | --- | --- |
| **A.** `curl` + CLI token → [into the account](#publish-into-the-users-account) | A shell; a Wix CLI login | Anything on disk | A site in their account, final URL |
| **B.** `ExecuteWixAPI` → [into the account](#publish-into-the-users-account) | The Wix MCP | Files already in the conversation — text as is, small binaries as base64 — and anything downloaded from the site | A site in their account, final URL |
| **C.** `curl` → [anonymous](#publish-anonymously) | A shell | Anything on disk | A live site for one hour; kept by a [claim](#claim-it-into-the-users-account) (through the Wix MCP or a CLI token) or the save link |
| **D.** [The drop page](#the-drop-page) | Nothing | Whatever the user uploads | The same, after they upload it themselves |
| **E.** [The headless skill](#keep-building-add-a-backend-when-you-need-one) | A shell; Node; a Wix CLI login | A project folder, source included (built for you) | A site in their account as a Wix Headless project, released with the Wix CLI, ready for Wix Business Solutions |

What sets them apart:

- **`curl -F` streams files from disk** — the bytes never pass through you: any type, any
  number, up to the [limits](#what-the-upload-accepts-and-how-it-fails).
- **`ExecuteWixAPI` has no filesystem.** The Wix MCP's tool runs JavaScript whose
  `wix.request` calls carry the user's login — no install, no token — but every
  byte is written out inside the call. That costs nothing extra for a page you
  generated or the user pasted (it's already in the conversation); for files on
  disk it means reading them in and writing them back out, and each change
  resends all of it. Files travel in the tool's `files` param — text raw, a
  binary file (PNG, JPG, fonts) as base64 — and `wix.multipart()` builds the
  upload body (below). Base64 costs about a third more than the file and every
  byte is tokens, so it suits small assets (an icon, a logo, a font) and files
  you downloaded from the site to change; a photo goes in by absolute URL
  (`<img src="https://…">`) or with `curl` from a shell. The bundle is capped at
  4M characters. On ChatGPT the tool's `attachments` param takes files
  themselves, up to 10 MB per call; they arrive in the `files` global as
  base64 entries. Other hosts have no such param: there, a site that is only
  text goes in the drop, and a site with images
  [starts at its Dev Machine](#starting-at-the-machine), where pages are
  written as commands and images with a URL are fetched.
- **A CLI login** is one approval by the user in the browser: run
  `npx @wix/cli login` and have them approve; `npx @wix/cli token` then prints a
  token (see [Before the calls](#before-the-calls)). It also unlocks later
  changes from disk and
  [Keep building](#keep-building-add-a-backend-when-you-need-one).
- **Anonymous** needs no identity, but the record expires after an hour and the
  URL changes on claim.
- **The headless skill** is the heaviest — an install, a project, a build — and
  the only one that takes framework source as is and leaves a project ready for a
  backend. A drop site can still move to it [later](#keep-building-add-a-backend-when-you-need-one).

So: a site already in the conversation — pages, styles, a logo — with the Wix
MCP connected — B, shell or not. Static files on disk — A with a CLI login, else C (claimed through
the Wix MCP when it's connected). A framework project (a `package.json`), or a
site that needs stores, bookings, a CMS or members from the start — E. Files out
of your reach, or nothing above fits — D.

Publishing yourself beats the drop page whenever an option fits — the user gets a
live site without uploading anything. Never report an upload you couldn't
perform; whenever a route fails partway, hand over the drop page.

A published site also has a [Dev Machine](#work-on-the-site-from-its-dev-machine):
a remote shell Wix provides per headless site, with the site's code and the Wix
CLI logged in, for changes without the files at hand or without a shell of your
own.

## Before the calls

The `curl` examples here and in the anonymous route read shell variables.

- **`$ACCESS_TOKEN`** is the user's access token, from wherever you have it. A
  token from the Wix CLI (`npx @wix/cli token`) lasts 15 minutes; running the
  command again returns a valid one, refreshed if needed, so set `$ACCESS_TOKEN`
  again when it may have expired, and always after a `403`.
- **`$META_SITE_ID`, `$UPLOAD_ID`, …** come from the previous response; set each
  one before the next call.

In an `ExecuteWixAPI` script there is no token to handle, and the ids go into the
URL as values; a `$NAME` there is sent as is.

## Publish into the user's account

### 1. Create the site

The [Create Headless Site](create-headless-site.md) call with no Wix Business
Solutions. Name it after the page's `<title>`, and keep `"origin": "drop"`: it marks
the site as a dropped one, the same as the drop page and the anonymous route do.

```bash
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/provision" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"origin":"drop","newMetasite":{"namingStrategy":{"metaSiteName":"Northwind Studio"},"seedOptions":[]},
       "synchronousSteps":["SET_METASITE_NAME","CONFIGURE_HEADLESS_APP"]}'
```

```json
{ "metaSiteId": "7597a72e-bedc-4d86-af86-9a25d11f0632", "appId": "9f0a8b59-1acb-4a67-aafd-f8602259cbfa" }
```

### 2. Drop the files — the site goes live

One multipart request uploads and releases. (A host with no shell and a site
with images skips this step and [starts at the machine](#starting-at-the-machine)
instead; step 1 is the same.) Each file is a part named `files`
whose **filename is its path relative to the site root** — that is how
subdirectories survive; with `curl`, set it with `;filename=` whenever it isn't
just the basename. A single `.zip` part works too — it's unpacked server-side, a
single wrapping folder stripped.

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/$META_SITE_ID/drop" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "files=@index.html;filename=index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css" \
  -F "files=@assets/logo.png;filename=assets/logo.png"
```

```json
{ "uploadId": "c0d5b3bb-60a9-43f9-9d27-7ca8df967825",
  "siteUrl": "https://headless-zjfqzddjtww-northwind-1406.wix-site-host.com" }
```

Option B — the same two calls as one `ExecuteWixAPI` script, for files already
in the conversation. The files go in the tool's **`files` param**, not in
`code`: one bundle, each file introduced by a line `=== FILE: <path> ===` and
followed by its raw text, `<path>` relative to the site root. A binary file is
introduced by `=== FILE: <path> base64 ===` and followed by its base64. Nothing
in it is escaped, so quotes, backticks, `${}` and backslashes arrive as written.

```
=== FILE: index.html ===
<!doctype html><html><head><title>Northwind Studio</title>
<link rel="stylesheet" href="assets/styles.css"></head><body><h1>Northwind Studio</h1><img src="assets/logo.png"></body></html>
=== FILE: assets/styles.css ===
body { font-family: sans-serif; margin: 0; padding: 4rem; }
=== FILE: assets/logo.png base64 ===
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==
```

In `code`, the bundle is the `files` global (`[{ path, content, encoding? }]`,
`encoding: 'base64'` on the binary entries) and `wix.multipart()` turns it into
the upload body: one part named `files` per file, the path as its filename, a
content type guessed from the extension, base64 entries decoded to their bytes.

```javascript
async function run() {
  const created = await wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
    body: { origin: 'drop', newMetasite: { namingStrategy: { metaSiteName: 'Northwind Studio' }, seedOptions: [] },
            synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP'] } });
  const mp = wix.multipart();                                   // the `files` param; or pass [{ path, content | base64 | bytes }]
  return await wix.request({ scope: 'account', method: 'POST',
    url: `https://www.wixapis.com/headless-business-setup/v1/headless-business/${created.data.metaSiteId}/drop`,
    headers: { 'Content-Type': mp.contentType },
    body: mp.body });
}
```

A zip passed through `attachments` is one base64 entry; unpack it first:
`const mp = wix.multipart(await wix.unzip(files[0].content));`.

`wix.request` returns `{ status, data }`; read a response's fields from `data`
(`created.data.metaSiteId`). Don't build the multipart body by hand — a missing
`\r\n` or a boundary mismatch is a bare `500` — and don't put file text inside
`code` as string literals: that second layer of escaping is what corrupts
backslashes and `${}`. Don't put image bytes in `code` either — they're a
`base64` entry in `files`. The one thing `files` cannot carry is a file with a
line that reads exactly `=== FILE: … ===`.

`siteUrl` is the site's final address — it's already in the user's account. Give
the user two links: `siteUrl`, and its dashboard at
`https://manage.wix.com/dashboard/{metaSiteId}`.

### Change it later

Drop again with the full file set, or change it from its
[Dev Machine](#work-on-the-site-from-its-dev-machine) when the files are not
at hand, the site needs a build, or it was already released from there.

Re-run step 2 on the same `metaSiteId` with the **full** file set: each drop
replaces the site's files (a file left out is gone), and `siteUrl` stays the same.
Never create another site for a change. The same call updates any site the user
owns that was published this way, including one claimed from an
[anonymous publish](#publish-anonymously). For a site from an earlier conversation,
find its `metaSiteId` with the [Query Sites](#claim-it-into-the-users-account) call
below, matching the site's name or `viewUrl`.

**When you no longer have the files** and the site has no Dev Machine release
yet, download what the site serves, edit it, and drop the full set back. Leave
out `wix.config.json`; the download adds it, and it isn't part of the site.

```bash
curl -sSL -o current.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
unzip -o current.zip -d current      # the site's files + wix.config.json
```

In an `ExecuteWixAPI` script, request the same URL with `responseType: 'base64'`
and unzip it in memory with `wix.unzip()`. Each entry is `{ path, bytes, text() }`:
`bytes` is the file as stored, `text()` decodes it when it's text. Don't decode
every entry — an image run through a text decoder is corrupted.

```javascript
const r = await wix.request({ scope: 'account', method: 'GET', responseType: 'base64',
  url: `https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/${metaSiteId}/download.zip` });
const entries = await wix.unzip(r.data);
// entries: [{ path: 'index.html', bytes, text() }, { path: 'assets/logo.png', bytes, text() }, { path: 'wix.config.json', … }]
```

Edit in memory — text through `text()`, binaries left as they are — then drop
the full set back in the same script, leaving `wix.config.json` out. Entries go
to `wix.multipart()` as they are; an edited file replaces its entry with
`{ path, content }`:

```javascript
const edited = entries.filter((e) => e.path !== 'wix.config.json').map((e) =>
  e.path === 'index.html' ? { path: e.path, content: e.text().replace('Northwind Studio', 'Northwind Studio — Est. 1998') } : e);
const mp = wix.multipart(edited);
await wix.request({ scope: 'account', method: 'POST', headers: { 'Content-Type': mp.contentType }, body: mp.body,
  url: `https://www.wixapis.com/headless-business-setup/v1/headless-business/${metaSiteId}/drop` });
```

The live URL itself (`*.wix-site-host.com`) can't be read from a script; this
download is the way back to the files. Don't rebuild the site from memory.

## Publish anonymously

No identity needed: the site is created under a temporary owner and lives for one
hour unless the user keeps it.

Generate `anonymousId` yourself — any UUID, **once per site, not once per
request** — and reuse it, with the returned `metaSiteId`, for every call for that
site. **Finish within one hour of step 1**: after that the record expires and
every later call, claim included, returns `404`.

### 1. Create the site

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID"
```

```json
{ "metaSiteId": "f0ad8672-09e9-4111-b6fe-070c70bd2df5",
  "projectId":  "54528d34-b23c-4fbe-b07d-2c522350abd7" }
```

Keep both: `metaSiteId` addresses the site, `projectId` builds the save link.

### 2. Upload the files

Same multipart shape as the [drop](#2-drop-the-files--the-site-goes-live), to the
upload path, with the attribution parameters (in a script: `wix.multipart()` with
the `files` param, posted to this URL):

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?campaign=mcp&agent=$AGENT" \
  -F "files=@index.html;filename=index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css"
```

```json
{ "uploadId": "03244542-d820-42f6-acfa-166c6658b1a6" }
```

Keep `campaign=mcp` (the referral tag — don't change it) and set `agent` to your
own identifier: a short, stable, lowercase-hyphenated slug for the coding agent or
tool you are (e.g. `claude-code`, `cursor`, `codex-cli`, `windsurf`,
`github-copilot`, or your product's name; `unknown-agent` if you can't name
yourself). Nothing is live yet; this only stages and validates.

### 3. Release — the site goes live

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/release" \
  -H 'Content-Type: application/json' -d "{\"uploadId\":\"$UPLOAD_ID\"}"
```

```json
{ "siteUrl": "https://instant-hguwrvtcrniw-headlessstack-140d.wix-site-host.com" }
```

**To change it**, re-run steps 2–3 with the same `anonymousId` and `metaSiteId` and
the full file set; `siteUrl` stays the same. Never go back to step 1 for a change.
Iterate first, claim last: after a claim, changes are a [drop](#change-it-later),
which needs the user's identity — a CLI token for files on disk.

**When it's final:** with the user's identity, [claim it](#claim-it-into-the-users-account).
Without it, stop here — a finished result. Give the user `siteUrl` plus the save
link, which is how the site survives:

```
https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}
```

That page shows the site with a countdown and signs the user in to keep it. Treat
the link as a secret — whoever opens it while signed in to Wix claims the site
into *their* account — so give it only to the user who asked.

### Claim it into the user's account

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `{}`. Claim after the release, never before — it consumes the anonymous
record, so the anonymous endpoints stop working for this site; later changes go
through the [drop](#change-it-later).

**The URL changes on claim**: the step-3 host stops resolving. Read the new one
with [Query Sites](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites),
filtered to the `HEADLESS` namespace (the default query omits headless sites, and
an `id` filter is rejected, so match the id yourself):

```bash
curl -sS -X POST "https://www.wixapis.com/site-list/v2/sites/query" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":{"filter":{"namespace":"HEADLESS"},"cursorPaging":{"limit":100}}}'
```

Take `viewUrl` from the entry whose `id` is your `metaSiteId` (page with
`metadata.cursors.next` if needed), and give the user it plus
`https://manage.wix.com/dashboard/{metaSiteId}`.

## The drop page

```
https://www.wix.com/headless/drop?utm_campaign=mcp&agent=<your-agent-id>
```

Keep `utm_campaign=mcp` and set `agent` to your own identifier, as in the
[upload](#2-upload-the-files). The user drags in their files (no login), Wix hosts
them on a live URL at once, and a banner offers to sign in and keep the site. Tell
them the [requirements](#what-the-upload-accepts-and-how-it-fails) so it doesn't
fail on the first try.

## What the upload accepts, and how it fails

These apply to every route:

- **A top-level HTML file is required.** A lone top-level HTML of any name becomes
  the homepage; with more than one, an `index.html` must be among them.
- **3 MB per file, 20 MB per site.**
- **Static files only** — HTML, CSS, JS, images, fonts. Framework source that
  needs a build step (a `package.json`, React/Vue sources) must be built first;
  upload the build output, or take the project to the headless skill (option E).

Failures come back as HTTP 400 with a code in `details.applicationError.code`:
`MISSING_INDEX_HTML`, `FILE_TOO_LARGE`, `TOTAL_TOO_LARGE`. Beyond those:

- **`403 PERMISSION_DENIED` on a drop** — the token expired or is missing (see
  [Before the calls](#before-the-calls)), or the site isn't the caller's. A site
  that's still anonymous is changed by upload + release, not by a drop.
- **`500` on a drop or upload** — the multipart body was built by hand and is malformed (see the shape
  above). Rebuild it from the example; sending it again unchanged fails the
  same way.
- **`404` on the anonymous route after step 1** — the hour passed or the site was
  claimed; start again.

**If publishing fails for any reason you can't quickly fix, hand the user the
[drop page](#the-drop-page).** Never leave them with a failed publish and no way
forward.

## Work on the site from its Dev Machine

A Dev Machine is a remote machine Wix runs for a headless site, holding its
code and taking shell commands over HTTPS. Each command runs with `bash -c` in
the code folder; every command that changes files ends with the changes pushed
to the site's code store, so the code outlives the machine. The machine ends
3.5 hours after it starts or after 40 minutes without a call, and the next one
starts from what was pushed.

The machine is a minimal Astro project bound to the site, with Node, git, the
Wix CLI logged in for the site, and the Wix Headless skills under
`.agents/skills/`. A dropped site's machine holds the dropped files under
`public/`. A site that has not been released yet gets the blank starter:
`src/pages/index.astro` owns `/` and `public/` holds only a favicon.

Base URL `https://www.wixapis.com/headless-remote-project`. Every call acts on
the site the identity is scoped to: a site token from the CLI,
`npx @wix/cli@latest token --site $META_SITE_ID`, or `scope: 'site', siteId` in an
`ExecuteWixAPI` script. No request takes a site id.

### The calls

```bash
DM=https://www.wixapis.com/headless-remote-project
# the machine: PROVISIONING until READY, poll every 5 to 10 s
curl -sS -X POST "$DM/v1/dev-machines/get-or-create" -H "Authorization: $SITE_TOKEN" -H 'Content-Type: application/json' -d '{}'
# {"devMachine":{"id":"…","status":"READY","seed":{"origin":"STATIC_SITE","codeRevision":"…"},"expirationDate":"…","codeBehindLiveSite":false}}

# a command; waitSeconds 0 to 25, timeoutSeconds up to 1800 (default 600), outputTailLength up to 250000 (default 20000)
curl -sS -X POST "$DM/v1/dev-machines/execute-command" -H "Authorization: $SITE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"command":"sed -i \"s/Welcome/Hello/\" public/index.html && CI=1 wix build && CI=1 wix release 2>&1 | tail -3","timeoutSeconds":900,"waitSeconds":25}'
# {"execution":{"id":"…","status":"COMPLETED","shellResult":{"exitCode":0,"timedOut":false,"stdout":"…","stderr":""},"codeRevision":"…"}}

# a command still RUNNING when the wait ran out
curl -sS "$DM/v1/executions/$EXECUTION_ID?waitSeconds=25" -H "Authorization: $SITE_TOKEN"
```

`status` is the service's: `COMPLETED` means the command ran to its end and its
changes were pushed, a non-zero exit code included. The command's own result is
`shellResult.exitCode` and `timedOut`. `seed.origin` is `STATIC_SITE` for the
dropped files and `CODE_STORE` for what an earlier machine pushed. Keep
`execution.id` while a command runs; `POST …/v1/executions/{id}/cancel` stops
one. `POST …/v1/code/generate-download-url` returns a one-hour link to a zip of
the source.

A change is a command that writes the file: `sed -i` for a line, a heredoc for
a whole file. Publishing is `CI=1 wix build && CI=1 wix release`; the release
goes to the same `siteUrl`. Once a site has been released from its machine, keep
changing it there: a new drop replaces the live site with the dropped files and
the machine's code falls behind (`codeBehindLiveSite: true`).

### Starting at the machine

For a host with no shell, the machine is where a site with images is built:
provision the site (step 1 above), `get-or-create` its machine, and the first
command writes the pages as heredocs, fetches every image that has a URL,
removes `src/pages/index.astro` and adds `redirects: { "/": "/index.html" }`
to `astro.config.mjs`. Then build and release. Images that have no URL follow
the rules below; a mock that shows a business solution continues into
[Keep building](#keep-building-add-a-backend-when-you-need-one) on the same
machine.

### Images

With a shell, images travel in the drop itself (`curl -F`). On ChatGPT they
travel as `attachments`. Otherwise:

- A file with a URL is fetched by the machine: `curl -sSL -o public/assets/hero.jpg "https://…"`
  in a command. The machine reaches public URLs only.
- A file that exists only on your side goes in as base64 written into
  commands. Your output carries about 4,000 characters of base64 intact per
  call and corrupts longer runs, so: gzip the file when that makes it smaller;
  split the base64 into chunks of at most 4,000 characters; append each with
  its own command, `printf '%s' '<chunk>' >> public/assets/x.b64`, checking
  the `wc -c` the command prints; decode once (`base64 -d x.b64 | gunzip > x.png`)
  and compare `sha256sum` with the original; on a mismatch, locate the bad
  chunk by hashing prefixes and resend from there; remove the `.b64` files and
  release once.
- A set larger than that is the user's to add: release the pages, name the
  missing files, and give the site's Media Manager,
  `https://manage.wix.com/dashboard/<metaSiteId>/media-manager`; the machine
  then fetches each by URL. The page keeps its image references as they are.

### Errors

| Code | Meaning |
| --- | --- |
| `428 DEV_MACHINE_NOT_READY`, `DEV_MACHINE_NOT_FOUND` | Call `get-or-create` again. |
| `428 DEV_MACHINE_SETUP_FAILED` | `data.retryDate` says when a new machine can start. |
| `428 DEV_MACHINE_LIMIT_REACHED` | The account has `data.limit` machines running; each frees at its `expirationDate`. A site with no release yet can publish by drop meanwhile. |
| `428 SITE_SOURCE_UNAVAILABLE` | The site was released from a project elsewhere; work in that project. |
| `428 SITE_CONNECTED_TO_GITHUB` | The code lives in the connected repository; work there. |
| `428 COMPANION_APP_NOT_FOUND` | Not a headless site from the provision call. |
| `404 EXECUTION_NOT_FOUND` | Unknown id, or older than 7 days. |
| `FAILED` with `error.code: PERSIST_FAILED` | The command ran, the push did not; `error.reason` names the git state to fix from a command. |

### In an ExecuteWixAPI script

```javascript
async function run() {
  const base = 'https://www.wixapis.com/headless-remote-project';
  const site = { scope: 'site', siteId: metaSiteId };
  let machine;
  for (let i = 0; i < 40; i++) {
    machine = (await wix.request({ ...site, method: 'POST', url: `${base}/v1/dev-machines/get-or-create`, body: {} })).data.devMachine;
    if (machine.status === 'READY') break;
    await new Promise((r) => setTimeout(r, 8000));
  }
  let execution = (await wix.request({ ...site, method: 'POST', url: `${base}/v1/dev-machines/execute-command`,
    body: { command: "sed -i 's/Welcome/Hello/' public/index.html && CI=1 wix build > /dev/null && CI=1 wix release 2>&1 | tail -3",
            timeoutSeconds: 900, waitSeconds: 25 } })).data.execution;
  while (execution.status === 'RUNNING') {
    execution = (await wix.request({ ...site, method: 'GET', url: `${base}/v1/executions/${execution.id}?waitSeconds=25` })).data.execution;
  }
  return { status: execution.status, exitCode: execution.shellResult?.exitCode, tail: execution.shellResult?.stdout };
}
```

## Keep building: add a backend when you need one

The headless skill, `https://wix.com/headless/skill.md`, builds and releases a
**Wix Headless project** with the Wix CLI: it adopts a project folder (a
`package.json`, or an `index.html` at its root) into a new site, or takes a
dropped one. A dropped site is **static**; when it needs a real backend — stores,
payments, bookings, a CMS, members, forms — it moves to a headless project,
keeping the same site, appId and URL.

**A mock that shows a business solution gets it connected in the same run.**
Buttons that add to a cart, a buy or checkout link, a booking or reservation
form, a menu with an order flow, tickets, a members sign-in, a donation button:
each names a Wix Business Solution the page is pretending to have, and "make
this a real site" includes making those work. Publish the pages first, so the
site is live, then connect the solution the markup shows (Stores for a cart,
Bookings for appointments, Events for tickets, Restaurants for orders, Members
for sign-in, Donations for giving) through the headless skill, and say in the
closing message what is now real and what the mock still only shows. A plain
brochure site, or a request that says static, stops at the pages; a mock with
inert commerce handed over as "say the word" is the run stopping short.

To move a dropped site, in a shell, once it's in the user's account:

```bash
curl -sSL -o project.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
unzip project.zip -d project      # the site's files + wix.config.json
```

Then follow the headless skill from that folder: it turns the files into a
headless project bound to the same site, released with the Wix CLI from then on.

Without a shell of your own, the site's
[Dev Machine](#work-on-the-site-from-its-dev-machine) is that folder: a Wix
project bound to the site, with the headless skills installed under
`.agents/skills/`. Read `.agents/skills/wix-headless-kit/SKILL.md` from a
command and follow it there.

## Route the request correctly

- **A new site from the user's files** — [Choose the route](#choose-the-route);
  with no shell and images in the site, [start at the machine](#starting-at-the-machine).
- **A change to a site published this way** — the same site: a
  [drop](#change-it-later) with the full file set, or its Dev Machine; upload +
  release while it's anonymous.
- **An anonymous site the user wants to keep** — [claim](#claim-it-into-the-users-account)
  it, else the save link.
- **A site that now needs a backend** — [Keep building](#keep-building-add-a-backend-when-you-need-one).
- **Migrating a live site/store from another platform by URL, or CSV/TSV
  exports** — [Site Import](site-import.md).
- **Adding HTML, an embed, or code to an existing Wix site** — not this recipe
  (that's custom code in the editor).
- **Images, videos, or documents for a site** —
  [Upload Media to Wix](../media/upload-media-to-wix.md).

Don't create the site from a template — that makes an empty site, not a published
copy of the user's files.
