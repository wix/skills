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
- **restaurants** → `b278a256-2757-4f19-9313-c05c783bec92` (Wix Restaurants **Menus** — the seedable core). Online ordering and table reservations are **separate optional apps**, install only if intent calls for them: Orders (New) → `9a5d83fd-8570-482e-81ab-cfa88942ee60`, Table Reservations → `f9c07de2-5341-40c6-b096-8eb39de391fb`. **Experiences** (special dining occasions guests reserve — wine tastings, chef's tables; see `CAPABILITIES.md`) are a **feature of the Table Reservations app, not a separate install** — installing Table Reservations is all that's needed to create and book them (`setup-restaurant-experiences.md`).
- **portfolio** → `d90652a2-f5a1-4c7c-84c4-d4cdcc41f130` (Wix Portfolio; the install ships a default sample collection + projects — `setup-portfolio.md` STEP 0 cleans them)
- **cms** → **no install** (Wix Data is core) — skip

For any vertical added later, its appDefId is in the docs — "Apps Created by Wix": <https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md>.

> **members — install is conditional on the layer, and only the *profile* layer installs anything.** Members is a cross-cutting capability (`CAPABILITIES.md`), not a `verticals[]` entry, so it has no unconditional row above. Split by layer:
> - **Identity only** (sign-up / log-in / log-out, "logged-in vs not" gating — the common case, and all that pricing-plans' subscribe flow needs) → **no install.** It's the headless OAuth app; members self-register. Skip, exactly like cms.
> - **Profile / Members Area** (the site *displays or edits* member data — name / photo / roles / badges, a my-account page) → install the **Wix Members Area app**, `appDefId` **`14cc59bc-f0b7-15b8-e1c7-89ce41d0e0c9`** (via the same `apps-installer-service` call above; it pulls in its Site-Members dependency automatically). **Wrinkle:** Members Area is **not** in the "Apps Created by Wix" table (that table has Stores, Blog, Pricing Plans, Groups… but no Members Area), so the GUID can't be grabbed from there — it comes from the App Market listing (<https://www.wix.com/app-market/web-solution/members-area>). Install it **only when the run genuinely needs profile data**; pure "logged-in vs not" gating (the common case) is the identity layer and needs no install.

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

Confirm every required app returned 200 (cms skipped). Then continue to **`SEED.md`**, which seeds from the local inline recipes.
