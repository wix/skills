# Authentication (Stripe-Projects → Wix)

Every Wix call this skill makes is a plain `curl` against `wixapis.com` with a bearer token. The credentials come from the project's `.env` (synced by Stripe Projects when Wix was connected), and the token is minted directly from the OAuth client-credentials grant.

## Inputs from `.env`

Stripe Projects namespaces each provider's vars, and Wix's own names already begin with `WIX_`, so a real provision yields a **doubled prefix**:

| Var                     | Role                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `WIX_WIX_CLIENT_ID`     | the OAuth app `client_id` — also the frontend `OAuthStrategy({ clientId })`                       |
| `WIX_WIX_CLIENT_SECRET` | the OAuth app `client_secret` — **server-side only**; mints the token, never goes to the frontend |
| `WIX_WIX_METASITE_ID`   | the metasite id → the `wix-site-id` header on every site-scoped call                              |

The plain `WIX_*` names are accepted as a fallback (in case the provider definition changes). Read them at runtime. If `client_id`/`client_secret` are absent, Wix isn't connected in this project — **stop with a clear error**.

## Minting the token — inline, secret stays out of context

Run this as a **single Bash call**. It sources `.env` *inside the shell*, so the command text references `$WIX_WIX_CLIENT_SECRET` but the secret value is never typed, printed, or returned. The minted token is written to a tmp file so later calls reuse it **without re-minting and without the token entering the model context**:

```bash
set -a; . ./.env; set +a
curl -sS -X POST "https://www.wixapis.com/oauth2/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"${WIX_WIX_CLIENT_ID:-$WIX_CLIENT_ID}\",\"client_secret\":\"${WIX_WIX_CLIENT_SECRET:-$WIX_CLIENT_SECRET}\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])" > /tmp/wix_token \
  && test -s /tmp/wix_token && echo "token minted" || echo "MINT FAILED — Wix not connected, or app/creds invalid"
```

That endpoint returns `{ "access_token": "<…>", "token_type": "Bearer", "expires_in": 14400 }`. `instance_id` is **optional and omitted**. The token is a real OAuth token with a **4-hour expiry**.

> **Shell state does not persist between Bash calls** — that is *why* the token goes to `/tmp/wix_token`. Mint once at the start of the run; every later call reads it back. Do **not** import the CLI "byte-identical, never re-mint" lore — each mint here returns a *different, equally valid* token; "mint once" is for simplicity, not because re-minting is pointless.

## REST call shape

Every later call re-sources `.env` (for the non-secret metasite id) and reads the token from the tmp file — both cheap, both keep secrets out of context:

```bash
set -a; . ./.env; set +a
TOKEN=$(cat /tmp/wix_token)
SITE_ID="${WIX_WIX_METASITE_ID:-$WIX_METASITE_ID}"
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/<endpoint>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" \
  -d '<body>'
```

- **`Authorization: Bearer $TOKEN`** — the `Bearer` prefix is required.
- **`wix-site-id: $SITE_ID`** — required by every site-scoped family (Stores v3, CMS v2, Blog v3, Forms v4, Apps-Installer v1, …). Harmless where unread; include it always.
- **`Content-Type: application/json`** — on every POST/PATCH body.
