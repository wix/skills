---
name: wix-cli-light
description: "The Wix CLI's headless-project operations as plain Node scripts, no install: device-code login that completes across two short calls, whoami, account and site tokens, env pull, site and app provisioning (init, create), release of a static or Astro build, and `call`, a Wix API request made with the session so the token never leaves the process. For hosts where a long-running or detached process cannot finish, or where installing @wix/cli is slow or blocked. Node 18 or later, network, a file system."
---

# Wix CLI light

The commands a headless project asks of the Wix CLI, as scripts that each finish inside one call.
Same endpoints, same request bodies, same files: a session saved here is the CLI's own session
file, a project made here is a project the CLI releases, and the other way round.

```
node scripts/wix-light.mjs <command> [flags]
```

Every command prints one JSON object per line and exits with 0, or with 1 after a line whose
`ok` is false. Event names follow the Wix CLI's agent mode where it has one: `awaiting_user`,
`logged_in`, `login_required`, `<command>_failed`.

## login

```
node scripts/wix-light.mjs login
```

The first run requests a device code, saves it, prints `awaiting_user` with `verificationUri` and
`userCode`, and exits. Show the owner the URL and the code. After the owner approves, run the same
command again: it exchanges the saved code, saves the session, and prints `logged_in`. A run before
the owner has approved prints `awaiting_user` again with the same code.

`--wait <seconds>` polls inside the call instead of exiting, for a host that keeps a call open while
the owner acts. `--force` discards a pending code and requests a new one.

## whoami

`logged_in` with the account's email, or `login_required`.

## token

```
node scripts/wix-light.mjs token                 # account access token
node scripts/wix-light.mjs token --site <siteId> # site-scoped access token
```

Prints the bare token, for exactly one use: a shell substitution straight into a request header,
in the same command, as in `-H "Authorization: $(node scripts/wix-light.mjs token)"`. For anything
else use `call`, which makes the request without the token ever leaving the process.

## call

```
node scripts/wix-light.mjs call <METHOD> <url or /path> [--site <siteId>] [--body '<json>' | --body-file <file>]
```

A Wix API request with the session's token. A bare path is on `https://www.wixapis.com`; a full
URL must be on `*.wixapis.com` or `*.wix.com`, the only hosts the token is sent to. `--site`
scopes the token to that site, for site-level APIs. Prints the response body; a non-2xx exits 1
with `call_failed` carrying `status` and the body.

The account's sites, headless ones included (the site list leaves them out unless asked):

```
node scripts/wix-light.mjs call POST /site-list/v2/sites/count \
  --body '{"filter":{"namespace":{"$in":["WIX","HEADLESS"]}}}'
node scripts/wix-light.mjs call POST /site-list/v2/sites/query \
  --body '{"query":{"filter":{"namespace":{"$in":["WIX","HEADLESS"]}},"sort":[{"fieldName":"createdDate","order":"DESC"}],"cursorPaging":{"limit":20}}}'
```

Each site's `id` is its `siteId`. `namespace` is `HEADLESS` for a site made by `init` or `create`.
Count before enumerating: an account can hold thousands, and the next page's cursor is at
`metadata.cursors.next`.

What a site is, in one call: its installed apps, namespace, URL, locale and currency, and its CMS
collections. As JSON, or as one markdown document to read (returned as `{ "markdown": "..." }`):

```
node scripts/wix-light.mjs call POST /_api/dynamic-context/v1/dynamic-context --body '{"siteId":"<siteId>"}'
node scripts/wix-light.mjs call POST /_api/dynamic-context/v1/dynamic-context/markdown --body '{"siteId":"<siteId>"}'
```

A site-level API, with the token scoped to the site:

```
node scripts/wix-light.mjs call GET /site-properties/v4/properties --site <siteId>
```

Every other Wix API works the same way. The `wix-manage` skill holds the operations and their
request shapes; the `wix-docs` skill finds an endpoint and its method schema. Neither is needed
for the calls above.

## env pull

```
node scripts/wix-light.mjs env pull [--dir <project>]
```

Writes the app's `prod` environment variables into the project's `.env.local`, merged over the
existing file (`WIX_CLIENT_ID`, `WIX_CLIENT_SECRET`, `WIX_CLIENT_PUBLIC_KEY`,
`WIX_CLIENT_INSTANCE_ID`, and whatever else the environment holds). `env_pulled` lists the keys.

## init

```
node scripts/wix-light.mjs init [--business-name <name>] [--astro] [--output <dir>] [--dir <folder>]
```

The folder becomes a Wix project: a new headless site, its app (the public OAuth client), the app
installed on the site, a hosting project, the OAuth app pointed at it, the environment variables
set. Writes `wix.config.json` and `.env.local`. Events: `site_created`, `app_created`,
`project_ready` with `siteId`, `appId`, `baseUrl`.

Static by default: `wix.config.json` names `site.outputDirectory` (`./dist`, or `--output`), and
`release` uploads that folder as-is. `--astro` leaves the output directory out, for a project with
a Wix Astro build. The business name defaults to the folder's name; it must not contain "wix".

## create

```
node scripts/wix-light.mjs create --business-name <name> --folder <name> \
  [--template-dir <path> | --template-repo <git url> [--template-path <subfolder>] [--template-ref <ref>]] \
  [--static] [--output <dir>] [--site-template <id>]
```

A new folder with the template's files (a local folder, or a shallow git clone when `git` is on
the machine), then `init` in it. Astro by default, `--static` or `--output` for a static site. No
dependency install: `project_ready.next` says what to run. Template files are copied as they are,
so an Astro template must already carry its Wix setup (`@wix/astro`, `@wix/astro-pages` and the
`@wix/astro-wix-hosting-adapter` in `astro.config`), the way the `wix-headless-templates` skill's
`<vertical>/project` folders do. The Wix CLI adds that setup to a bare template; this skill does not.

## release

```
node scripts/wix-light.mjs release [--minor] [--comment <text>] [--dir <project>]
```

Uploads the build and makes it the live version. A static project uploads `site.outputDirectory`
(dotfiles, lockfiles, `package.json`, `wix.config.json`, logs, and any `build*`, `dist*`,
`node_modules*`, `coverage*` folder inside it are left out). An Astro project reads
`.wix/build-metadata.json` from the project's own build (`npx astro build` with the Wix adapter)
and uploads its client and server output with the app manifest. Events: `uploading`, `uploaded`
with the deployment URL, `released` with `url` (the custom domain when one is connected, else the
site's hosting URL).

## Tokens

Three tokens exist: the account access token (hours), the account refresh token that mints the
others (long-lived), and a site token (minutes) scoped to one site. They live in the files below
and in the `authorization` header of requests these scripts make. Nowhere else.

Do:
- `call` for any Wix API. The token is read, sent, and dropped inside the process.
- `token` only as a shell substitution into a header, in the same command.
- `--site <siteId>` for site-level APIs, so the token sent is the narrow one.
- Leave `.env.local` where it is. It holds the app's secret; `init` adds it to the project's
  `.gitignore` when there is one.

Do not:
- Print, echo, log or paste a token: not in the chat, not in a file, not in a commit, not in a
  URL or a query string, not in an issue or a message to anyone.
- Copy a token into a variable that outlives the command, into the project, or into notes.
- Send a token anywhere but `*.wixapis.com` and `*.wix.com`. `call` refuses other hosts.
- Copy `~/.wix/auth/` between machines, or read the files to "check" a token: `whoami` says
  whether a session exists.
- Paste `.env.local`, or its `WIX_CLIENT_SECRET`, anywhere. `WIX_CLIENT_ID` alone is public.

Every failure line these scripts print passes through a redaction that masks token-shaped
values, so an error can be shown as it is. If a token did reach a transcript, the owner logs the
Wix CLI out (`wix logout`) and logs in again; that revokes the refresh token behind it.

## Files

| file | holds |
|---|---|
| `~/.wix/auth/account.json` | the session, the Wix CLI's own file and shape |
| `~/.wix/auth/<siteId>.json` | a site token, the CLI's own cache |
| `~/.wix/auth/pending-login.json` | a device code waiting for the owner, deleted on login |
| `<project>/wix.config.json` | `appId`, `siteId`, and for a static site `site.outputDirectory` |
| `<project>/.env.local` | the app's environment variables, `KEY="value"` per line |

`WIX_CLI_LIGHT_AUTH_DIR` moves the three auth files.
