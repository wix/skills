---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a live Wix site. Covers every way to get there — publishing straight into the user's Wix account when you hold their identity, publishing anonymously with a save link when you don't, and handing the user the Wix Headless drop page, or releasing it as a Wix Headless project — and how to get the user's identity through the Wix CLI. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation, or to update a site published this way (replace its files on the same site and URL, or change it from the site's Dev Machine, a remote shell Wix provides per headless site). Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website as files — hand-written HTML, a static build, a
zip, or the output of an AI site builder — and wants it live on Wix. Every route
below ends the same way: a headless site in Wix that serves those files at a
`*.wix-site-host.com` URL.

## Choose the route

The route follows from how the files' bytes can reach Wix.

| You have | Route |
| --- | --- |
| A shell with network access, files on disk | [Drop them](#publish-into-the-users-account) with `curl` and a Wix CLI token. Without a login, [publish anonymously](#publish-anonymously). The files stream from disk and never pass through you. |
| A framework project — a `package.json`, sources that need a build | The [headless skill](#keep-building-connect-a-backend), which builds and releases it. |
| The Wix MCP, and no shell with network access | [Drop through `ExecuteWixAPI`](#from-an-executewixapi-script), then continue on the site's [Dev Machine](#the-dev-machine) for whatever the drop can't carry. |
| None of these | The [drop page](#the-drop-page): the user uploads the files. |

Without a shell, every byte you publish is written out by you inside a tool
call. That is free for a page already in the conversation, costs a read and a
rewrite for text files on disk, and is the hard part for images — see
[Images](#images).

**The Dev Machine is the shell for an agent that has none.** Wix runs one per
headless site, holding the site's code with Node and the Wix CLI. Without a
shell of your own, move to it once the drop has the site live and any of these
holds:

- the site has images that are on your disk, or that have a URL and should be hosted on Wix;
- the site will change again — later in this conversation or in another one —
  so no change resends the whole site;
- the site needs a build, or a business solution such as a store or bookings:
  the machine carries the headless kit.

A single pasted page with one change on the spot is cheaper as a second drop.
With a shell of your own, work locally; the machine matters only when the files
are gone or the site was last released from the machine.

Publishing yourself beats the drop page whenever a route fits. Never report an
upload you couldn't perform. When a route fails partway, hand over the drop page.

## Before the calls

- **`$ACCESS_TOKEN`** is the user's access token. Run `npx @wix/cli login` once
  (the user approves in the browser); `npx @wix/cli token` then prints a token
  that lasts 15 minutes. Run it again whenever the token may have expired, and
  always after a `403`.
- **`$META_SITE_ID`, `$UPLOAD_ID`, …** come from the previous response.

In an `ExecuteWixAPI` script there is no token: `wix.request` carries the user's
login. Ids go into URLs as values; a `$NAME` there is sent as is.

## Publish into the user's account

### 1. Create the site

The [Create Headless Site](create-headless-site.md) call with no Wix Business
Solutions. Name it after the page's `<title>` and keep `"origin": "drop"`.

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

One multipart request uploads and releases. Each file is a part named `files`
whose **filename is its path relative to the site root**; that is how
subdirectories survive. A single `.zip` part works too: it is unpacked
server-side, a single wrapping folder stripped.

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

`siteUrl` is final, and the site is already in the user's account. Give the user
`siteUrl` and the dashboard, `https://manage.wix.com/dashboard/{metaSiteId}`.

### From an ExecuteWixAPI script

Both calls in one script. The files go in the tool's **`files` param**, never
in `code`: one bundle where each file starts with a line `=== FILE: <path> ===`
followed by its raw text, `<path>` relative to the site root. A binary file
starts with `=== FILE: <path> base64 ===` and is followed by its base64 (see
[Images](#images) for what fits). Nothing in the bundle is escaped.

```
=== FILE: index.html ===
<!doctype html><html><head><title>Northwind Studio</title>
<link rel="stylesheet" href="assets/styles.css"></head><body><h1>Northwind Studio</h1><img src="assets/logo.png"></body></html>
=== FILE: assets/styles.css ===
body { font-family: sans-serif; margin: 0; padding: 4rem; }
=== FILE: assets/logo.png base64 ===
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==
```

In `code` the bundle is the `files` global, `[{ path, content, encoding? }]`,
and `wix.multipart()` turns it into the upload body.

```javascript
async function run() {
  const created = await wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
    body: { origin: 'drop', newMetasite: { namingStrategy: { metaSiteName: 'Northwind Studio' }, seedOptions: [] },
            synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP'] } });
  const mp = wix.multipart();              // from the `files` param; or pass [{ path, content | base64 | bytes }]
  return await wix.request({ scope: 'account', method: 'POST',
    url: `https://www.wixapis.com/headless-business-setup/v1/headless-business/${created.data.metaSiteId}/drop`,
    headers: { 'Content-Type': mp.contentType }, body: mp.body });
}
```

`wix.request` returns `{ status, data }`. A zip passed through `attachments`
is one entry; unpack it first: `wix.multipart(await wix.unzip(files[0].content))`.
Don't build a multipart body by hand (a malformed one is a bare `500`), and
don't put file text in `code` as string literals (the extra escaping corrupts
backslashes and `${}`). The bundle can't carry a file with a line that reads
exactly `=== FILE: … ===`.

### Change it later

On the same `metaSiteId`, never a new site:

- **A drop** with the **full** file set: each drop replaces every file, and
  `siteUrl` stays.
- **The [Dev Machine](#the-dev-machine)**: edit and release there. Once a site
  has been released from its machine, keep changing it there. A drop would
  replace the live site and leave the machine's code behind
  (`codeBehindLiveSite: true`).

For a site from an earlier conversation, find its `metaSiteId` with
[Query Sites](#claim-it-into-the-users-account), matching the name or
`viewUrl`. To drop again without the files at hand, download what the site
serves, edit, and drop the full set back without `wix.config.json`:

```bash
curl -sSL -o current.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
```

In a script, request that URL with `responseType: 'base64'` and pass `r.data` to
`wix.unzip()`. Each entry is `{ path, bytes, text() }`; call `text()` only on
text files, since a decoded image is corrupted. Entries go back to
`wix.multipart()` as they are, an edited one as `{ path, content }`. The live URL
itself can't be read from a script; never rebuild a site from memory.

## Publish anonymously

No identity needed. The site belongs to a temporary owner and lives one hour
unless the user keeps it. Generate `anonymousId` yourself, any UUID, once per
site, and reuse it with the returned `metaSiteId` for every call. After one hour
every call, claim included, returns `404`.

```bash
# 1. create
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID"
# {"metaSiteId":"f0ad8672-…","projectId":"54528d34-…"}

# 2. upload: the drop's multipart shape; nothing is live yet
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?campaign=mcp&agent=$AGENT" \
  -F "files=@index.html;filename=index.html" -F "files=@assets/styles.css;filename=assets/styles.css"
# {"uploadId":"03244542-…"}

# 3. release: the site goes live
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/release" \
  -H 'Content-Type: application/json' -d "{\"uploadId\":\"$UPLOAD_ID\"}"
# {"siteUrl":"https://instant-hguwrvtcrniw-headlessstack-140d.wix-site-host.com"}
```

Keep `campaign=mcp` and set `agent` to a short lowercase slug naming you
(`claude-code`, `cursor`, `codex-cli`; `unknown-agent` if you can't tell). To
change the site, repeat steps 2 and 3 with the full file set.

When it's final, claim it with the user's identity. Without one, give the user
`siteUrl` and the save link, which signs them in to keep the site. Whoever opens
the link while signed in to Wix gets the site, so give it only to the user:

```
https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}
```

### Claim it into the user's account

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Claim last: it ends the anonymous record, and later changes are
[drops](#change-it-later). **The URL changes on claim.** Read the new `viewUrl`
with Query Sites in the `HEADLESS` namespace; the default query omits headless
sites and rejects an `id` filter, so match the id yourself, paging with
`metadata.cursors.next`:

```bash
curl -sS -X POST "https://www.wixapis.com/site-list/v2/sites/query" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":{"filter":{"namespace":"HEADLESS"},"cursorPaging":{"limit":100}}}'
```

## The drop page

```
https://www.wix.com/headless/drop?utm_campaign=mcp&agent=<your-agent-id>
```

The user drags in the files without logging in, the site is live at once, and a
banner offers to keep it. Tell them the limits below first.

## Limits and failures

Every route:

- **A top-level HTML file.** A lone one of any name is the homepage; with more
  than one, `index.html` must be among them.
- **3 MB per file, 20 MB per site.**
- **Static files only.** Sources that need a build go to the
  [headless skill](#keep-building-connect-a-backend), or upload the build output.

| Failure | Meaning |
| --- | --- |
| `400` `MISSING_INDEX_HTML`, `FILE_TOO_LARGE`, `TOTAL_TOO_LARGE` | In `details.applicationError.code`; fix the files. |
| `403 PERMISSION_DENIED` on a drop | The token expired or is missing, or the site isn't the caller's. An anonymous site takes upload and release, not a drop. |
| `500` on a drop or upload | A malformed multipart body; rebuild it as shown. The same body fails again. |
| `404` on the anonymous route | The hour passed or the site was claimed. |

## Images

Each image's bytes reach Wix once. Use the first carrier you have:

1. **A shell with network access**: in the drop, from disk.
2. **ChatGPT**: the `ExecuteWixAPI` tool's `attachments` param takes files of up
   to 10 MB per call; they arrive as base64 entries in the `files` global.
3. **A public URL**: keep the absolute URL in the page, or host the file on Wix by
   fetching it on the Dev Machine:
   `curl -sSL -o public/assets/hero.jpg "https://…"`.
4. **Only on your disk, without network access**: the base64 goes through your
   own output. About 3,000 characters of base64 survive one call intact; longer
   runs come back corrupted.
   - A file whose base64 fits, such as an icon or a small logo, goes in the
     drop's `files` bundle.
   - A few larger files go to the Dev Machine in pieces. Split the base64 into
     3,000-character chunks and append each with its own command,
     `printf '%s' '<chunk>' >> /tmp/hero.b64 && wc -c < /tmp/hero.b64`, checking
     the length. Then decode once, `base64 -d /tmp/hero.b64 > public/assets/hero.png`,
     and compare its `sha256sum` with the original. On a mismatch, compare
     prefix hashes to find the first bad chunk and resend from there.
   - Beyond about 30,000 characters of base64 in all, the upload is the user's.
     Publish the pages and give them the site's Media Manager,
     `https://manage.wix.com/dashboard/{metaSiteId}/media-manager`. Once they
     have uploaded, [list the site's files](../media/upload-media-to-wix.md) and
     point the pages at their `static.wixstatic.com` URLs.

Never stand in drawings of your own for the user's images. An image that isn't
on the site yet is named in the closing message.

## The Dev Machine

A Dev Machine is a remote machine Wix runs for a headless site. It holds the
site's code as an Astro project, with Node, git, the Wix CLI logged in for the
site, and the Wix Headless skills under `.agents/skills/`. A dropped site's
files are under `public/` and served as they are. Each command runs with
`bash -c` in the code folder, and every command that changes files ends with
them pushed to the site's code store, so the code outlives the machine. A
machine ends 3.5 hours after it starts, or after 40 minutes without a call; the
next one starts from what was pushed.

Start it after the first drop. A site that was never dropped or released gets a
blank starter instead.

Base URL `https://www.wixapis.com/headless-remote-project`. Calls act on the
site that the identity is scoped to: a site token,
`npx @wix/cli@latest token --site $META_SITE_ID`, or `scope: 'site', siteId` in
a script. No request takes a site id.

```bash
DM=https://www.wixapis.com/headless-remote-project
# the machine: PROVISIONING until READY; poll every 5 to 10 s
curl -sS -X POST "$DM/v1/dev-machines/get-or-create" -H "Authorization: $SITE_TOKEN" -H 'Content-Type: application/json' -d '{}'
# {"devMachine":{"id":"…","status":"READY","seed":{"origin":"STATIC_SITE"},"expirationDate":"…","codeBehindLiveSite":false}}

# a command; waitSeconds 0 to 25, timeoutSeconds up to 1800 (default 600), outputTailLength up to 250000
curl -sS -X POST "$DM/v1/dev-machines/execute-command" -H "Authorization: $SITE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"command":"sed -i \"s/Welcome/Hello/\" public/index.html && CI=1 wix build && CI=1 wix release 2>&1 | tail -3","timeoutSeconds":900,"waitSeconds":25}'
# {"execution":{"id":"…","status":"COMPLETED","shellResult":{"exitCode":0,"timedOut":false,"stdout":"…","stderr":""}}}

# a command still RUNNING when the wait ran out
curl -sS "$DM/v1/executions/$EXECUTION_ID?waitSeconds=25" -H "Authorization: $SITE_TOKEN"
```

- **`status`** is the service's. `COMPLETED` means the command ran to its end and
  its changes were pushed, even with a non-zero exit. The command's own result
  is `shellResult.exitCode` and `timedOut`.
- **A change** is a command that writes the file: `sed -i` for a line, a heredoc
  for a whole file.
- **Publishing** is `CI=1 wix build && CI=1 wix release`, to the same `siteUrl`.
- **Other calls**: `POST …/v1/executions/{id}/cancel` stops a command;
  `POST …/v1/code/generate-download-url` returns a one-hour link to the source.

In an `ExecuteWixAPI` script, a whole file goes in through the `files` param as
well, so its text is never escaped: build the command in `code` from the entry.

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
  const page = files.find((f) => f.path === 'about.html');
  const command = `cat > public/about.html <<'WIXEOF'\n${page.content}\nWIXEOF\n`
    + 'CI=1 wix build > /dev/null && CI=1 wix release 2>&1 | tail -3';
  let execution = (await wix.request({ ...site, method: 'POST', url: `${base}/v1/dev-machines/execute-command`,
    body: { command, timeoutSeconds: 900, waitSeconds: 25 } })).data.execution;
  while (execution.status === 'RUNNING') {
    execution = (await wix.request({ ...site, method: 'GET', url: `${base}/v1/executions/${execution.id}?waitSeconds=25` })).data.execution;
  }
  return { status: execution.status, exitCode: execution.shellResult?.exitCode, tail: execution.shellResult?.stdout };
}
```

| Error | Meaning |
| --- | --- |
| `428 DEV_MACHINE_NOT_READY`, `DEV_MACHINE_NOT_FOUND` | Call `get-or-create` again. |
| `428 DEV_MACHINE_SETUP_FAILED` | `data.retryDate` says when a new machine can start. |
| `428 DEV_MACHINE_LIMIT_REACHED` | The account has `data.limit` machines running; each frees at its `expirationDate`. A site never released from a machine can take a drop meanwhile. |
| `428 SITE_SOURCE_UNAVAILABLE` | The site was released from a project elsewhere; work there. |
| `428 SITE_CONNECTED_TO_GITHUB` | The code lives in the connected repository; work there. |
| `428 COMPANION_APP_NOT_FOUND` | Not a headless site from the provision call. |
| `404 EXECUTION_NOT_FOUND` | Unknown id, or older than 7 days. |
| `FAILED` with `error.code: PERSIST_FAILED` | The command ran but the push did not; `error.reason` names the git state to fix. |

## Keep building: connect a backend

A dropped site is static. Stores, payments, bookings, a CMS, members or forms
need a **Wix Headless project**, built and released with the Wix CLI by the
headless skill, `https://wix.com/headless/skill.md`. The project takes over the
same site, appId and URL.

**A mock that shows a business solution gets it connected in the same run.**
Add-to-cart buttons, a buy or checkout link, a booking form, a menu with
ordering, tickets, a sign-in, a donate button: each one names a Wix Business
Solution the page pretends to have, and "make this a real site" includes making
it work. Publish the pages first, then connect what the markup shows: Stores
for a cart, Bookings for appointments, Events for tickets, Restaurants for
orders, Members for sign-in, Donations for giving. The closing message says what
is now real and what the mock still only shows. A brochure site, or a request
for a static site, stops at the pages.

- **Without a shell of your own**, the site's [Dev Machine](#the-dev-machine) is
  the project. Read `.agents/skills/wix-headless-kit/SKILL.md` from a command and
  follow it there.
- **With a shell**, download the site and follow the headless skill from that folder:

```bash
curl -sSL -o project.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
unzip project.zip -d project
```

## Route the request correctly

- **A new site from the user's files**: [Choose the route](#choose-the-route).
- **A change to a site published this way**: the [same site](#change-it-later);
  upload and release while it's anonymous.
- **An anonymous site the user wants to keep**: [claim it](#claim-it-into-the-users-account), or the save link.
- **A site that now needs a backend**: [Keep building](#keep-building-connect-a-backend).
- **Migrating a live site or store from another platform by URL, or CSV/TSV
  exports**: [Site Import](site-import.md).
- **HTML, an embed or code inside an existing Wix site**: not this recipe; that
  is custom code in the editor.
- **Images, videos or documents for a site's media**: [Upload Media to Wix](../media/upload-media-to-wix.md).

Don't create the site from a template: that makes an empty site, not a copy of
the user's files.
