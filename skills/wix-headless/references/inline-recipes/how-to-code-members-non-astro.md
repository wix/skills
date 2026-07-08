---
name: "How to Code Members (non-Astro)"
description: The frontend contract for member sign-up / log-in / log-out and member-gated surfaces on a **non-Astro** frontend (Vite/React/Vue SPA or static HTML, managed-non-Astro or self-managed) — the manual `OAuthStrategy` handshake off the *same* visitor client non-astro.md already builds (`generateOAuthData → getAuthUrl → parseFromUrl → getMemberTokens → setTokens`, `logout`, `loggedIn()`), token persistence + `renewToken`, the published-site and allow-listed-redirectUri preconditions, defaulting to the Wix login page, reading the current member with `@wix/members`, and the no-`auth.elevate` rule. Specifies the *how* for the non-Astro axis only — read `how-to-code-members-astro.md` for an Astro frontend.
---
**RECIPE**: How to Code Member Auth on a **non-Astro** Frontend (manual `OAuthStrategy`, `@wix/members`)

A concise contract for wiring **login / sign-up / logout and member-gated surfaces** into a non-Astro frontend — a Vite/React/Vue SPA or plain static HTML, whether managed-non-Astro or self-managed. **This is the *how* (which calls, which preconditions, which failure modes), not the *what*** — which pages are gated, what the account page shows, and the design come from the request you're fulfilling.

> **⚠️ AXIS GUARD — this recipe is for non-Astro only.** Here you drive the OAuth handshake yourself on the same manual client `non-astro.md` builds for visitors. If the frontend **is** Astro, **stop and read `how-to-code-members-astro.md`** — Astro ships built-in `/api/auth/login` routes and auto-auth, and building the `OAuthStrategy` handshake below on Astro is wrong (and 500s at SSR). Don't cross the streams.

> **One mechanism, not three.** Sign-up, log-in and log-out are the *same* flow — the Wix login page **logs in an existing member or registers a new one** in one step; you never build a separate "sign up" call. Member tokens are the **same shape** as visitor tokens, just `role: member`: login just swaps the token set on the client you already have.

Pinned docs (read before wiring — `curl` the `.md` directly):
- Wix-managed login via the JS SDK: <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/members/wix-login-page/wix-managed-login-using-the-js-sdk.md>
- `OAuthStrategy` reference (member flows, token/session methods): <https://dev.wix.com/docs/sdk/core-modules/sdk/oauth-strategy.md>
- Handle visitors & members via the JS SDK: <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/visitors/handle-visitors-using-the-js-sdk.md>
- Current member (SDK): <https://dev.wix.com/docs/sdk/frontend-modules/members/current-member/introduction> (open with `?apiView=SDK`)

---

## Preconditions — get these right or `getAuthUrl` fails (read first)

- **`clientId` only, never the secret.** Member auth uses the same **public** OAuth client id as the visitor client (`non-astro.md` N6). No `client_secret` in the frontend, ever.
- **The connected site must be PUBLISHED.** `getAuthUrl` serves the Wix login page; against an unpublished site it fails the redirect with a non-obvious error. Publish before testing login (like the events payment-method precondition).
- **The `redirectUri` must be in the OAuth app's allowed redirect URIs — exact match, and YOU must register it (it is not automatic).** A mismatch (or a missing entry) is the classic login 4xx — login is dead until it's registered. `wix release` auto-registers the deployed **origin** (`allowedRedirectDomains`), but **not** this member-login **callback** (`allowedRedirectUris`) — that's a separate field and a separate, manual step. Because the callback embeds the deployed origin, it's a **post-deploy** step: register it right after release. **⚠️ Do not conclude `allowedRedirectUris` is read-only/dashboard-only** — the `UpdateOAuthApp` doc may not list it prominently, but a **masked `PATCH`** sets it (the field mask is required or it silently no-ops). **Mechanics: `managed/DEPLOYMENT.md` → "Member login on a non-Astro frontend".** Register both the exact callback (`window.location.origin + '/callback'`) and the `https://*-<host>/callback` wildcard; don't rely on trailing-slash/path variants matching.
- **Default to the Wix login page** — the sub-type this recipe uses. Three login sub-types exist (Wix login page / custom login page / externally-managed); the Wix page needs **no UI to build** and is deterministic. **If the brief explicitly asks for a custom/branded in-app login form or custom sign-up fields** (full name / username / address / arbitrary fields), **stop and read `how-to-code-members-custom-login.md`** — that path builds the form and drives `client.auth.register`/`login` directly (works on any project type). Use externally-managed only when specifically requested. When no custom form or extra fields are named, the Wix login page below is the default — don't build a custom form unprompted.

---

## Identity vs. profile — two layers, don't conflate them

- **Identity / auth** — *"is this caller a logged-in member?"*, log in, log out. Native to the headless OAuth app. **No app install needed** — everything in "The login flow" and `loggedIn()`-based gating below runs on this layer alone.
- **Member profile / Members Area** — reading name / photo / roles / badges, an editable my-account page. Served by the **Wix Members Area app**, which **must be installed** (see `SETUP.md`). `@wix/members` `getCurrentMember()` returns data only once that app is present.

If `getCurrentMember()` returns empty/errors on a site where `loggedIn()` is `true`, suspect the **Members Area app isn't installed** — not a code bug.

---

## The login flow — the same client, plus a round-trip

Reuse the one visitor client `non-astro.md` builds (`createClient({ modules, auth: OAuthStrategy({ clientId }) })`) — don't make a second client. Login is three steps across a redirect.

```js
// 1 · start login (sign-up is the SAME call) — from a "Log in" button
const redirectUri  = window.location.origin + '/callback';   // MUST be allow-listed, exact match
const originalUri   = window.location.href;                    // where to send the member back after
const oAuthData = client.auth.generateOAuthData(redirectUri, originalUri); // PKCE: state + codeVerifier
localStorage.setItem('wixOAuthData', JSON.stringify(oAuthData));           // survive the redirect
const { authUrl } = await client.auth.getAuthUrl(oAuthData);
window.location.href = authUrl;                                // → Wix login page (login or register)

// 2 · on the callback page (/callback)
const oAuthData = JSON.parse(localStorage.getItem('wixOAuthData'));
const returned  = client.auth.parseFromUrl();                  // { code, state } or { error }
if (returned.error) { /* surface returned.errorDescription; do NOT loop back into getAuthUrl */ }
const tokens = await client.auth.getMemberTokens(returned.code, returned.state, oAuthData);
client.auth.setTokens(tokens);                                 // subsequent SDK calls now run as the member
persistTokens(tokens);                                         // see persistence below
window.location.href = returned.originalUri ?? '/';            // back to where login started

// 3 · logout
const { logoutUrl } = await client.auth.logout(window.location.href);
clearPersistedTokens();
window.location.href = logoutUrl;
```

Check auth state anywhere: **`client.auth.loggedIn()`** — `false` = anonymous visitor, `true` = logged-in member. Gate a view on it (render the account UI only when `true`; otherwise show a "Log in" control that runs step 1).

---

## Token persistence & renewal — treat member tokens like visitor tokens

Member tokens are the **same token set** the visitor session machinery already handles; login just swaps them in.

- **Persist** the token set (localStorage or a cookie) after `setTokens` so a reload stays logged in. On app boot, if you have a stored set, `client.auth.setTokens(stored)` before first render.
- **Renew** with `client.auth.renewToken(refreshToken)` (or the SDK's automatic renewal when you re-hydrate via `setTokens`) — same as the visitor refresh flow. A member session expiring is a normal state; refresh, don't force a re-login unless the refresh token is gone.
- On logout, **clear** the persisted set so the next boot is a clean anonymous visitor.

---

## Read the current member — `@wix/members`, not the dev-preview package

```js
import { members } from '@wix/members';
// with the member tokens set on the client:
const { member } = await client.members.getCurrentMember({ fieldsets: ['FULL'] });
// member.profile?.nickname, member.profile?.photo, member.loginEmail, member.contactId, member.roles
```

- **⚠️ The SDK export is `getCurrentMember`, NOT `getMyMember`.** The REST method is named *Get My Member* and the SDK docs page may show `GetMyMember`, but `@wix/members` exports it as **`client.members.getCurrentMember`** — calling `getMyMember(...)` throws `is not a function` at runtime. It's a silent trap: a logged-out smoke test never reaches the call, so it only fails once a real member loads the account page.
- **⚠️ Use `@wix/members`** (`getCurrentMember` / `getMember` / `updateMember`) — visitor/member auth, production-ready. **Do NOT use `@wix/site-members`** (`wixSiteMembers`, "Current Member") — it's in **Developer Preview** ("not for production"). Only if a profile-privacy toggle is specifically requested.
- The **photo** is a `wix:image://` identifier — resolve with `media.getScaledToFillImageUrl` (`non-astro.md` N7); never hand-build the CDN URL.
- **Another member by id → PUBLIC fieldset only**; a **private** profile returns nothing to a member/visitor identity (relevant to any "look up author by id" lookup).

---

## ⚠️ Do NOT `auth.elevate()` — and on a SPA you can't anyway

- **Login** is the **identity** axis (anonymous → a specific member). **`auth.elevate()`** is the **permission** axis (→ app/admin scope). A member reading **their own** data (own orders/bookings/subscriptions, plan-gated content, their profile) is authorized under the **member token, no elevation** — reaching for elevate to "make member data work" is the wrong axis and doesn't help.
- A pure SPA / static site has **no server, so there is no `auth.elevate` at all** (`non-astro.md` N5). Admin/site-wide reads (everyone's orders, all members) genuinely can't run on this path — that's a real limitation, but **member features don't need it**, so it does not block login / account / gated content. If a feature truly needs an admin read, it needs a server (out of scope for a static SPA).

---

## pricing-plans is a HARD dependency on members

If the site has pricing-plans, **login is required, not optional**. Ordering a plan (`orders.createOnlineOrder(planId)`) orders it **for a logged-in member**; anonymous → the Wix flow forces sign-up. `orders.memberListOrders()` and "my subscription" reads return **nothing** for an anonymous visitor. So the plans grid is public, but the **subscribe** button and the **my-subscription** surface both need the login flow above; a logged-in member calling `orders.createOnlineOrder` needs **no `onBehalf`**. Everywhere else (stores "my orders", bookings "my bookings", events "my registrations"), login is a *soft* add-on — the purchase/RSVP/book action runs fine as an anonymous visitor; only the account view of it needs a member.

---

## Conclusion
Correct member auth on a non-Astro frontend:
- reuses the **one visitor `OAuthStrategy` client** and drives the handshake — `generateOAuthData → getAuthUrl → parseFromUrl → getMemberTokens → setTokens`, `logout`, `loggedIn()` — **never** an Astro `/api/auth/*` route;
- gets the preconditions right up front: **`clientId` only**, **site published**, **`redirectUri` allow-listed exact-match**, **default to the Wix login page**;
- **persists and renews** member tokens like visitor tokens (`renewToken`), re-hydrating with `setTokens` on boot and clearing them on logout;
- reads the current member via **`@wix/members` `getCurrentMember`** (not the dev-preview `@wix/site-members`), resolving the photo `wix:image://` URI, expecting PUBLIC-only fields for other members;
- does **no `auth.elevate`** (wrong axis for own-data reads; unavailable on a serverless SPA anyway);
- treats **login as required** whenever pricing-plans is present, and as a soft add-on for the "my …" surfaces of the other verticals;
- needs the **Wix Members Area app installed** only for profile *data* — pure "logged-in vs not" gating runs on the identity layer with no install.
