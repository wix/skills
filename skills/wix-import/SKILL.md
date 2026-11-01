---
name: wix-import
description: Import local site code into a Wix Studio 2 site with the Wix CLI, either into the site the folder was exported from or into a new Studio 2 site. Works from an exported site folder; for code from any other project, such as a hand-coded or generated page, it prepares a site folder and hands the rebuild to that folder opened as a project. Confirms what the import replaces before saving. Not for sites built in the Wix Editor or Studio 1, and not for content or business changes such as products, bookings or blog posts, which belong to wix-manage. Never publishes.
---

# Wix import

## How to reply

- Keep each message to 1–3 short lines, plus a short list when naming pages. Report results, not commands or setup steps.
- When the user must act, end the message with one bold line starting with 👉, and nothing after it.

## 1. Find the site folder

A site folder holds `packages/site-app/.env`. Look in the folder the user named, then the working folder and its parents, then, for a site the user named, `<home>/wixsites/<the site's exact name>`.

- **Found:** it was exported with the Wix CLI, so skip the setup. Go to step 3.
- **Not found:** the code is in another project or the user's message. Run the setup in step 2, then step 4.
- **Nothing to import:** send `**👉 Reply with the project folder to import, or paste its code.**`

Put user-given values in single quotes (`'` as `'\''`) and write the home folder as an absolute path.

## 2. Set up

Run `wix whoami; wix origami --help; git --version`.

- `wix` not found: check `node -v` (24.18 or later; ask before installing Node), then run `npm install -g @wix/cli && wix flows add origami`.
- `wix origami` unknown: run `wix flows add origami`.
- `git --version` fails: the export needs git. Ask before installing it: `brew install git` on a Mac with Homebrew, otherwise `xcode-select --install`, then wait for its installer; `winget install --id Git.Git -e --source winget` on Windows. On Linux, ask the user to run their package manager's install, since it needs `sudo`.
- No email address: run `wix login` in the background, send `**👉 Sign in at <url> with code <code>**` from its output, and continue once it reports the signed-in user.

When a command asks to update the CLI, run the update it prints and retry. In a found folder, run this setup only when a `wix` command is not found or reports that you are not signed in.

## 3. Choose the destination

- **Original site** (default): the msid in `VITE_WIX_METASITE_ID` in `<site>/packages/site-app/.env`.
- **New site**, when the user asks for one or replies `new`: create it as `wix-create-studio-two-site` step 2 says, and import `<site>` into the msid in its `Created … "<name>" (<msid>)` line.

Then go to step 5.

## 4. Get a site folder for other code

Create a new site as in step 3, and use its folder as `<site>`. When the user names an existing site instead, find it with `wix origami sites | grep -iF -- '<name>'` and keep only an exact match. `<site>` is `<home>/wixsites/<site name>`: the site's exact name, spaces included, with only `/`, `\`, `:` and `?` turned into `-`. The export replaces everything in that folder, so when it already holds files, say so and send `**👉 Reply yes to replace <site>.**` first. Exporting adds a web OAuth app named `export site` to the site if it has none: unless the user already agreed, say so and send `**👉 Reply yes to export "<name>".**` Then run `wix origami export-site --site <msid> -d '<site>'`. When `node -v` is older than `<site>/.nvmrc`, ask before switching to that version. In `<site>`, run `corepack enable && yarn install`.

When the code is in the user's message, save it as `<site>-source/index.html`, beside `<site>`, and name that folder in the request below.

Don't write the site's files from here. The rebuild and the import run from `<site>` opened as the project:

```
"Bloom Florist" is ready in /Users/dana/wixsites/Bloom Florist to take your page.
**👉 Open /Users/dana/wixsites/Bloom Florist as your project and ask: "Rebuild /Users/dana/wixsites/Bloom Florist-source in this site, then import it."**
```

## 5. Validate

When `<site>/node_modules` is missing, check `.nvmrc` as in step 4, then run `corepack enable && yarn install` there first. Run `yarn lint` in `<site>`, then `yarn lint --full` once. When it reports errors and `<site>` is the working folder, fix them until it passes. When `<site>` is not the working folder, don't fix them here: send the error count and `**👉 Open <site> as your project and ask: "Fix the lint errors, then import."**`

## 6. Confirm and import

Run `wix origami pages --site <msid>` and compare it with the folders in `<site>/packages/site-app/src/pages/`. Unless the destination was created in this request, confirm and wait:

```
Importing into "Bloom Florist" replaces its theme, header, footer, menus and Home, and deletes:
- About
- Blog
**👉 Reply yes to import into "Bloom Florist", or new to import into a new site.**
```

Then:

1. When pages name images by URL or local file, run `wix origami upload-media --site <msid> -d '<site>'`.
2. Run `wix origami import-site --site <msid> -d '<site>'`. If it says code import is not enabled for this site, tell the user and stop.

## 7. Report

```
Imported into "Bloom Florist": Home, Menu, Contact. Deleted: About, Blog. Saved, not published.
**👉 Open in the editor: https://manage.wix.com/editor/<msid>**
```

Never publish the site.
