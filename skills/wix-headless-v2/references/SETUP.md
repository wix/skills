# Setup — install the business apps

Install the Wix apps the resolved capabilities need, on the given metasite. That is the whole of setup — the frontend toolchain stays with the host.

## 1 · Obtain the token

Obtain `$TOKEN` (a bearer authorized for the metasite) and `$SITE_ID` (the metasite id) **using the provided authentication mechanism** — see `<TYPE_DIR>/AUTHENTICATION.md`. Hold them for the install calls below.

All Wix REST calls in this skill then use the same universal call shape:

```
Authorization: Bearer $TOKEN
wix-site-id: $SITE_ID
Content-Type: application/json
```

## 2 · Install one app per capability

For each capability in `verticals[]`, install its app by `appDefId` (these are the constants the install call needs):

- **stores** → `215238eb-22a5-4c36-9e7b-e7c08025e04e`
- **blog** → `14bcded7-0066-7c35-14d7-466cb3f09103`
- **forms** → `225dd912-7dea-4738-8688-4b8c6955ffc2`
- **events** → `140603ad-af8d-84a5-2c80-a0f60cb47351`
- **bookings** → `13d21c63-b5ec-5912-8397-c3a5ddb27a97`
- **pricing-plans** → `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3`
- **gift-cards** → `d80111c5-a0f4-47a8-b63a-65b54d774a27`
- **portfolio** → `d90652a2-f5a1-4c7c-84c4-d4cdcc41f130`
- **restaurants** → `b278a256-2757-4f19-9313-c05c783bec92` (Wix Restaurants **Menus** — the seedable core). Online ordering and table reservations are **separate optional apps**, install only if intent calls for them: Orders (New) → `9a5d83fd-8570-482e-81ab-cfa88942ee60`, Table Reservations → `f9c07de2-5341-40c6-b096-8eb39de391fb`.
- **donations** → `333b456e-dd48-4d6b-b32b-9fd48d74e163`
- **cms** → **no install** (Wix Data is core) — skip

For any vertical added later, its appDefId is in the docs — "Apps Created by Wix": <https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md>.

Fire one install `curl` per app — `POST /apps-installer-service/v1/app-instance/install`:

```bash
# TOKEN, SITE_ID from the provided authentication mechanism — see <TYPE_DIR>/AUTHENTICATION.md
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

Confirm every required app returned 200 (cms skipped). Then continue to **`SEED.md`**, which reads the live Wix REST docs for content seeding.
