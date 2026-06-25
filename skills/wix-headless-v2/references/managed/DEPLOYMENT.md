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

## Transient errors

A release can hit transient infrastructure errors (`ECONNRESET`, `ETIMEDOUT`, `STATE_MISMATCH`, "try again shortly"). Retry the release serially up to **3×** with a short backoff. **Build failures are not retryable** — they're code bugs; fix the code, not the retry.

That's the whole of finalize for `managed` — no `site-publisher` call, no `oauth-app` origin PATCH.
