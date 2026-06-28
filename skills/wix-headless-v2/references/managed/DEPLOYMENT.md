# Deployment — managed (Wix CLI release)

For a **managed** project, Wix owns the hosting, so finalizing the live site is a single command — Wix handles publishing the site **and** registering the deployed origin on the OAuth app **out of the box**. There are no manual publish or origin-registration calls (unlike the self-hosted types).

## Release

From the project directory:

```bash
npx @wix/cli@latest release
```

- Publishes whatever the managed project is configured to deploy to Wix's hosting/CDN, and brings the live site up.
- The deployed origin is registered on the OAuth app automatically — the frontend's visitor SDK calls are accepted from the live URL with no extra step.
- The published URL is printed on stdout (`Site published on <url>`).

## Static frontends (no build step)

These two fixes are **Wix-hosting facts** — they apply to a connected **static** site (plain HTML, no bundler) on the managed path, and the docs are silent on both. A bundler SPA that builds to its own output directory doesn't need them.

- **The entry file must be named `index.html`.** Wix serves `index.html` at the site root. A brought-in design named anything else (e.g. `"My Design.html"`) **publishes "successfully" but 500s/404s at runtime**. Rename the entry to `index.html` **before** release and fix internal references to it.
- **`site.outputDirectory` must point at the directory holding `index.html`.** `init` writes `site.outputDirectory: "./dist"`, which assumes an SPA that *builds* to `dist`. A static site has no build, so `./dist` is wrong — set `outputDirectory` in `wix.config.json` to the directory that actually contains `index.html`, or `release` publishes but the live site 404s at root.

## Transient errors

A release can hit transient infrastructure errors (`ECONNRESET`, `ETIMEDOUT`, `STATE_MISMATCH`, "try again shortly"). Retry the release serially up to **3×** with a short backoff. **Build failures are not retryable** — they're code bugs; fix the code, not the retry.

That's the whole of finalize for `managed` — no `site-publisher` call, no `oauth-app` origin PATCH.
