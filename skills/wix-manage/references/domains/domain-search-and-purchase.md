---
name: "Domain Search and Purchase"
description: Help users connect a domain they already own to their Wix site. Verify the domain is registered, resolve the site UUID/MSID, check Premium status, then route to the connection wizard or an upgrade prompt.
---

# Connect Domain

Use this recipe when a user wants to:
- Connect a domain they already own to their Wix site
- Point an existing domain at their site
- Says something like "I have a domain", "connect my domain", "I already own mybusiness.com"

**UX rule:** Execute checks silently — don't narrate API calls. Reveal information only when it changes what the user needs to do next.

---

## Overview

```
User wants to connect
    ↓
Ask for domain (+ 3 suggestions)
    ↓
Check Availability
    ├─ Available (not registered) → "Nice pick! Domain available — secure it now" → Purchase flow
    └─ Taken (registered) → "Domain is registered. If it's yours, connect it. Here are alternatives."
            ↓ (user clicks Connect)
        ┌─────────────────────────────────┐
        │  Step 3: Resolve UUID / MSID    │  ← shared by both connect & purchase intents
        │                                 │
        │  UUID in context? ──Yes──────── → resolved with MSID
        │       │ No                      │
        │  Site context?                  │
        │  ├─ Case A: in dashboard ─────→ resolved with MSID
        │  └─ Case B: call ListWixSites → resolved with MSID
        │                                 │
        │  Standalone (no site):          │
        │  Ask if connecting to Wix site  │
        │  ├─ Yes → sign in/up widget ──→ resolved with MSID
        │  └─ No  → skip premium ───────→ go to purchase Step 3
        └─────────────────────────────────┘
            ↓ resolved with MSID
        Site Premium?
            ├─ Yes → "Great choice! Click here to connect" + Redirect to Concierge
            └─ No  → "To connect a custom domain you need a Premium plan" + Upgrade Banner Widget
```

> **Arrow key:** pink paths = connect intent · green paths = purchase intent. The UUID/MSID stage sits on both paths — it is also required in the [Domain Search and Purchase](domain-search-and-purchase.md) flow before the TLD voucher and sale checks.

---

## Step 1: Ask for the Domain

Ask: *"What domain do you have in mind?"* and immediately show **3 available suggestions** from the Suggest Domains API so the user has something to react to:

```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query={business name or keywords}&paging.limit=3
```

All returned suggestions are available for purchase — they are **not** registered and cannot be connected right now. Show them as purchase alternatives only.

**Normalize the domain before any API call:**
- Remove `http://` / `https://` and `www.` prefixes
- Add `.com` if no TLD given: `example` → `example.com`

---

## Step 2: Check Availability

```
GET https://www.wixapis.com/domain-search/v2/check-domain-availability?domain={domain}
```

No special auth headers — this is a public API.

| Result | Action |
|--------|--------|
| `available: true` | Domain is NOT registered → see [Available Domain](#available-domain) |
| `available: false` | Domain IS registered → continue to Step 3 |
| `DOMAINS_UNSUPPORTED_TLD` error | → see [Unsupported TLD](#unsupported-tld) |

> ⚠️ Ignore the `premium` field in this response — it refers to domain pricing, not site Premium status.

### Available Domain

The domain isn't registered yet, so the user can't connect it. Respond:

> "Nice pick! [DOMAIN] is available — secure it now."

Route to [Domain Search and Purchase](domain-search-and-purchase.md).

### Taken Domain

Respond with:

> "Domain is already registered. If it's yours — connect it to a Wix site. Here are alternatives that fit your brand."

Show the alternatives widget. The user signals connect intent by clicking **Connect**; they signal purchase intent by selecting a suggestion. The connect path continues to Step 3 below.

### Unsupported TLD

> "We don't currently support .[TLD] domains for connection. To connect a domain, it needs a supported TLD like `.com`, `.net`, or `.org`. Do you have a different domain?"

---

## Step 3: Resolve UUID / MSID

> ⚠️ **This step is shared by both the connect and purchase intents** (pink and green paths in the diagram). Run it before any Premium or voucher check.

Determine which Wix site to associate with this domain and get its `siteId` (MSID/UUID).

### UUID already in context

**Condition:** `siteId` / `msid` is already present in the environment (site dashboard, headless setup).

**Action:** Use it directly. Do NOT call `ListWixSites`. Proceed as **resolved with MSID**.

---

### No UUID — resolve from context

**Condition:** No `siteId` in context.

**Case A — user is in a site context** (dashboard or mentions a specific site by name):
→ Extract the MSID from the environment. Proceed as **resolved with MSID**.

**Case B — no site context:**
Call `ListWixSites`. Multiple sites → list them and ask the user to pick one.
Once selected → proceed as **resolved with MSID**.

---

### Standalone — no Wix site

**Condition:** No UUID and the user has no Wix site (or `ListWixSites` returns empty).

Ask: *"Are you planning to connect this domain to a Wix site?"*

| User answer | Action |
|-------------|--------|
| Yes | Show sign in / sign up widget → after authentication, re-resolve UUID → proceed as **resolved with MSID** |
| No | Skip to purchase Step 3 (save contact info) — skip all Premium / voucher checks |

---

## Step 4: Check Site Premium Status

> Runs only after **resolved with MSID**.

Call `checkPremiumStatus` silently. Extract:
- `allowedDomain` (boolean) — `true` = site has a Premium plan that allows domain connection

---

## Step 5: Route to Connection or Upgrade

### Premium site (`allowedDomain: true`)

**Message (verbatim):**
> "Great choice! Click here to connect."

**Tool call (same response):**
```json
redirectToConcierge({
  "domainName": "[FULL_DOMAIN]",
  "displayName": "[DISPLAY_DOMAIN]"
})
```

Do not add any text after the widget.

### Free site (`allowedDomain: false`)

**Message (verbatim):**
> "To connect a custom domain you need a Premium plan."

**Tool call (same response):**
```json
premiumUpgradeBanner({ "editorType": "sunrise" })
```

`editorType` values:
- `"sunrise"` — Classic Wix Editor (default)
- `"studio"` — Wix Studio Editor (use only if confirmed from context)

---

## Domain Display Truncation

Always pass both `domainName` (full, for URLs) and `displayName` (for display) to `redirectToConcierge`.

Truncate `displayName` only when domain length > 20 characters — formula: `[first 6]...[last 6 + TLD]`

| Full domain | displayName |
|-------------|-------------|
| `short.com` | `short.com` |
| `myamazingbusiness.com` | `myamaz...iness.com` |

---

## Quick Reference

| Step | API / Tool | Purpose |
|------|-----------|---------|
| 1 | `GET /domain-search/v2/suggest-domains` | Show 3 suggestions on entry |
| 2 | `GET /domain-search/v2/check-domain-availability` | Confirm domain is registered |
| 3 | `ListWixSites` (if needed) | Resolve site UUID/MSID |
| 4 | `checkPremiumStatus` → `allowedDomain` | Check if site can connect domains |
| 5a | `redirectToConcierge` widget | Open connection wizard (Premium) |
| 5b | `premiumUpgradeBanner` widget | Upgrade-to-connect prompt (Free) |

---

## Error Handling

Retry any failed API call once silently. If still failing: *"I'm having trouble checking your domain. Please try again in a moment."*

Never expose: "API failed", "checkDomainAvailability returned an error", "Let me try again."

---

## Scenario Reference

| Scenario | Flow |
|----------|------|
| Domain not registered | Available → "Nice pick! Secure it now" → purchase flow |
| Unsupported TLD | Availability error → suggest supported TLDs |
| Taken, user connects, UUID in context | Step 3 Case A → `checkPremiumStatus` → Concierge or Banner |
| Taken, user connects, no context | Step 3 Case B → `ListWixSites` → `checkPremiumStatus` → Concierge or Banner |
| Taken, user connects, standalone, no site | Step 3 standalone → sign in/up or skip to purchase Step 3 |
| Taken, user selects suggestion instead | Purchase flow (green path) — same UUID/MSID step 3 applies |
