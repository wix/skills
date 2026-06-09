# Setup — install the business apps

Install the Wix apps the resolved capabilities need, on the given metasite. That is the whole of setup — the frontend toolchain stays with the host.

## 1 · Mint the token

Per `references/AUTHENTICATION.md` § "Minting the token" — one Bash call, secret stays out of context, token to `/tmp/wix_token`. Mint once; later calls read it back.

## 2 · Install one app per capability

For each capability in `verticals[]`, look up its `appDefId` in `references/CAPABILITIES.md`:

- **stores** → `215238eb-22a5-4c36-9e7b-e7c08025e04e`
- **blog** → `14bcded7-0066-7c35-14d7-466cb3f09103`
- **forms** → `225dd912-7dea-4738-8688-4b8c6955ffc2`
- **cms** → **no install** (Wix Data is core) — skip

Fire one install `curl` per app — `POST /apps-installer-service/v1/app-instance/install`:

```bash
set -a; . ./.env; set +a
TOKEN=$(cat /tmp/wix_token)
SITE_ID="${WIX_WIX_METASITE_ID:-$WIX_METASITE_ID}"
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/apps-installer-service/v1/app-instance/install" \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant":      { "tenantType": "SITE", "id": "'"$SITE_ID"'" },
    "appInstance": { "appDefId": "<appDefId>", "enabled": true }
  }'
```

The installs are independent — issue them in whatever order is convenient.

A **200** confirms the install. On a non-200, surface the response verbatim and stop.

## 3 · Proceed to Seed

Confirm every required app returned 200 (cms skipped). Then continue to **`SEED.md`**, which loads the `wix-manage` recipes for content seeding.
