# Authentication — self-managed (TBD)

For a **self-managed** project (self-hosted, where the user manages their own hosting and credential supply), the authentication method is **not yet decided — TBD**.

When defined, this file must specify how `self-managed` obtains, for the rest of the (project-type-agnostic) flow:

- **`$TOKEN`** — a bearer token authorized for the metasite (used as `Authorization: Bearer $TOKEN`).
- **`$SITE_ID`** — the metasite id (used as the `wix-site-id` header on every site-scoped call).
- **`clientId`** — the OAuth app's public client id for the frontend's `OAuthStrategy` (the OAuth **app id and client id are the same value** — app-id === client-id).

It then ends at the same universal REST call shape every type uses:

```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/<endpoint>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" \
  -d '<body>'
```

> **TBD.** Until the self-managed auth method is defined, a `self-managed` run can't obtain a token — **stop with a clear error** and tell the user this project type isn't wired yet.
