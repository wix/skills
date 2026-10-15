---
name: wix-export
description: Install the origami CLI, sign in to Wix, and export a site or create a new one. Checks Node, Corepack and access to the Wix npm registry first. Use when origami is not installed, is outdated or is signed out, or when the user is starting with Origami. Never imports or publishes.
---

# Wix export

Goal: install the origami CLI, sign the user in, and put the user's Wix site in a local folder that is ready to edit.
Origami needs Node 22.16 or later and Corepack.
The CLI installs from `https://npm.dev.wixpress.com/`, which works only on the Wix network or VPN.

## 1. Check the machine

```bash
node -v
corepack -v
npm view @wix/origami-cli version --registry=https://npm.dev.wixpress.com/
```

- Install Node or change its version yourself once the user approves, and never run npm with `sudo`.
- When Node works but `npm view` fails, ask the user to connect to the Wix network or VPN.

## 2. Install the CLI

```bash
npm install -g @wix/origami-cli --registry=https://npm.dev.wixpress.com/
```

## 3. Sign in

- When `origami whoami` prints no email address, run `origami login`, give the user the URL and the code it prints, and wait for `Logged in as …`.
- Never type the user's password.

## 4. Get the site

- Set `<site>` to a new folder path, such as `./my-site`.
- Before you export or create a site, tell the user that the export adds a web OAuth app named `export site` to a site that has none.
- For a site the user names, find it in `origami sites` by exact name or msid, ask the user when none or several match, and run `origami export-site --site <msid> -o <site>`.
- For a new site, run `origami create-site --name <name> -o <site>` once; it creates a blank, unpublished Studio 2 site and exports it.
- When `create-site` prints `was created but isn't ready to export yet`, run the `origami export-site` command it prints a minute later; never run `create-site` again for that site.
- When the export fails without detail, export once more into a new empty folder.
- Report each `Warning: no component wrapper for …` line to the user.

## 5. Install the site's packages

- In `<site>`, run `yarn install`.
- When `yarn` is not found, run `corepack enable`, then run `yarn install` again.
- When the install fails, report the command and the error, and do not change the exported packages to make it pass.

## 6. Done

- Tell the user the site is in `<site>` and they can now ask for changes to it.
- To make those changes, read `<site>/node_modules/@wix/origami-skills/skills/wix-site-edit/SKILL.md`.
- Never publish the site.
