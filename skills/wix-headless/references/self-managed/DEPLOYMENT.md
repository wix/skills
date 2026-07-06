# Deployment — self-managed (TBD)

For a **self-managed** project, the deploy/finalize steps are **not yet decided — TBD**.

Because hosting is the user's (not Wix's), this will likely mirror the self-hosted finalize pattern — **publish the metasite** and **register the deployed origin** on the OAuth app once the live URL is known (see `../stripe/DEPLOYMENT.md` for that shape) — but the exact mechanism, and how credentials/URL are supplied, are TBD.

> **TBD.** Until this is defined, tell the user that `self-managed` deployment isn't wired yet, and that the frontend's visitor calls will be rejected until its origin is registered on the OAuth app.
