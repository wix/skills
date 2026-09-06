# From docs to calls — identities, tokens, site context

You've confirmed the contract (`SKILL.md`); this is the execution side: which identity the call
runs under, how to mint its token, and how to see what a site actually has installed.

## Which identity?

Wix APIs run under several identities — Wix user (admin), app, site member, site visitor — and
**each method documents which it accepts**: check the method page's permissions/identity notes
rather than assuming. The identity model:
[`about-identities`](https://dev.wix.com/docs/api-reference/articles/authentication/about-identities)
(append `.md` to read). The two tokens you mint most often:

| token | minted from | typical use |
|---|---|---|
| **admin** | API key, connector, OAuth-app admin grant, or the Wix CLI | managing the site — ad hoc calls, or the same fetch inside an app's backend function |
| **visitor** | the site's OAuth app client id, `anonymous` grant | anonymous end-user calls from the site's frontend — storefront reads, cart, checkout |

A logged-in **member** is a third case: member calls use a member token (the same `/oauth2/token`
endpoint, a member grant — see
[`about-authentication`](https://dev.wix.com/docs/go-headless/authentication/about-authentication)),
not the visitor token.

## Admin token

Any management or read call, straight from its docs contract:

```bash
curl -sS -X POST 'https://www.wixapis.com/contacts/v5/contacts/query' \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data-raw '{"query": {"cursorPaging": {"limit": 10}}}'
```

In a Wix CLI project, the CLI mints `$ADMIN_TOKEN` — at either scope:

```bash
TOKEN=$(npx @wix/cli@latest token --site "$SITE_ID")   # site-scoped: this one site's APIs
TOKEN=$(npx @wix/cli@latest token)                     # account-scoped: account-level APIs (list sites, …)
```

Mint once per run and cache it — within a run the CLI returns a byte-identical token, so re-minting
only spends startup time.

## Visitor token

Minted from the OAuth app's **client id** — a public value, usually already on disk before it is in
any API: in a managed headless project it is the `appId` field of `wix.config.json` (**the OAuth app
id and the client id are the same value**), so read it from the project's config instead of querying
the OAuth-apps API for it. The mint is one unauthenticated call, so it belongs in the site's own
frontend code:

```bash
curl -sS -X POST 'https://www.wixapis.com/oauth2/token' \
  -H 'Content-Type: application/json' \
  --data-raw '{"clientId": "<oauth app client id>", "grantType": "anonymous"}'
# → { "access_token": "OauthNG.JWS.…", … } — bearer for products, cart, checkout
```

The cart and checkout APIs act on the *caller's* identity, so an anonymous shopper's calls want the
visitor token — the admin token is for managing the site, the visitor (or member) token is for
being on it.

## The authentication docs

Append `.md` to read:

- [`about-identities`](https://dev.wix.com/docs/api-reference/articles/authentication/about-identities) — the identity model
- [`rest-api-authentication`](https://dev.wix.com/docs/api-reference/articles/authentication/rest-api-authentication) — headers, token kinds
- [`retrieve-tokens`](https://dev.wix.com/docs/api-reference/business-management/headless/authentication/retrieve-tokens) — the `/oauth2/token` contract, all grant types
- [`about-authentication`](https://dev.wix.com/docs/go-headless/authentication/about-authentication) — visitor vs member sessions
- [`create-an-oauth-app-for-visitors-and-members`](https://dev.wix.com/docs/go-headless/getting-started/setup/authentication/create-an-oauth-app-for-visitors-and-members) — where the client id comes from
- [`set-up-a-headless-client`](https://dev.wix.com/docs/go-headless/authentication/setup/set-up-a-headless-client) — wiring the client

## Dynamic Site Context — "what IS this site?"

One admin call returns a markdown report of the whole site — installed apps, status, URL, locale,
CMS collections — the same output the Wix MCP's site-context tool renders:

```bash
curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data-raw '{"siteId": "<metasite id>"}' | jq -r '.markdown'
```

A `200` with `"markdown": ""` means the token or `siteId` is wrong — the endpoint reports an empty
context instead of an auth error, so treat empty as "check auth", never as "empty site".

For site management, the **`wix-manage`** skill carries per-area recipes. It may already be
installed at
`.agents/skills/wix-manage/`; install it with `npx -y skills add wix/skills/skills/wix-manage`,
or read it straight off the registry: `https://www.wix.com/skills/wix-manage`.
