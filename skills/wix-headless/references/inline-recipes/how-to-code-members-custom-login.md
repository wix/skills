---
name: "How to Code Members (custom login — credentials + Google/Facebook)"
description: The frontend contract for member sign-up / log-in / log-out and member-gated surfaces. **This skill uses a custom, in-app login only** — the Wix-hosted login-page redirect has been removed, so there is no "redirect to Wix login" path and no `how-to-code-members-{astro,non-astro}` recipe. Two mechanisms, both driven directly with the `OAuthStrategy` SDK on the visitor client: (A) **direct-credential** auth — you build the email+password UI and call `register` / `login` / `processVerification` / `getMemberTokensForDirectLogin` / `setTokens` / `sendPasswordResetEmail` / `logout` (the surface for a branded form and custom sign-up fields — name, address, username, arbitrary fields); and (B) **social login** — your own buttons redirect straight to a provider via `getAuthUrl(oAuthData, { idp })` with `idp: 'google' | 'facebook'`, completing through the callback exchange (`parseFromUrl` → `getMemberTokens` → `setTokens`). Enterprise SSO / custom OIDC (`idp: { connectionId }`) is **PARKED — not available in this skill yet; do not build it.** Also covers the `loginState` state machine, custom `profile` fields at sign-up, token persistence, reading the member with `@wix/members`, the Astro-vs-non-Astro wiring split, the pricing-plans hard dependency, and the no-`auth.elevate` rule. Works on **any** headless project (managed or self-managed).
---
**RECIPE**: How to Code Member Auth (custom in-app login — credentials + Google/Facebook — `OAuthStrategy`, `@wix/members`)

A concise contract for wiring **login / sign-up / logout and member-gated surfaces** into any headless frontend. **This is the *how* (which SDK calls, which states, which failure modes), not the *what*** — the form design, which pages are gated, and what the account page shows come from the request you're fulfilling.

> **⚠️ There is ONE login model in this skill: a custom, in-app login you build.** The **Wix-hosted login page redirect has been removed** — do **not** redirect members to a Wix login page, do **not** use Astro's built-in `/api/auth/login` / `/api/auth/logout` routes for member auth, and there is no longer a `how-to-code-members-astro.md` / `how-to-code-members-non-astro.md` recipe. Every members run uses the flow below.

> **One client, one end state — all paths converge.** `register()`, `login()`, and the social callback all end at a **member token set** → `client.auth.setTokens(tokens)` → persist → read the member with `@wix/members`. Member tokens are the **same shape** as visitor tokens (`role: member`); logging in just swaps the token set on the visitor client you already have.

## Two mechanisms — pick by what the brief asks for

| | **(A) Direct-credential** | **(B) Social login** |
| :-- | :-- | :-- |
| **Use when** | branded in-app email+password form, or custom sign-up fields (name / username / address / arbitrary) | "sign in with Google / Facebook" |
| **Visitor leaves your page?** | **No** — direct API calls | **Yes** — redirects to the provider, returns to your callback |
| **Kick-off calls** | `register()` / `login()` | `generateOAuthData()` → `getAuthUrl(oAuthData, { idp })` |
| **Token exchange** | `getMemberTokensForDirectLogin(sessionToken)` | `parseFromUrl()` → `getMemberTokens(code, state, oAuthData)` |
| **Needs allow-listed redirect URI?** | No (login itself) | **Yes** — the callback URL must be allow-listed |
| **Custom sign-up fields?** | Yes (`register`'s `profile`) | No — the provider owns the identity |

A brief can use both (e.g. an email/password form **and** a "Continue with Google" button on the same page) — they share the one client and the same end state. Don't blend their **exchange** calls, though: credential login finishes with `getMemberTokensForDirectLogin(sessionToken)`, social with `getMemberTokens(code, state, oAuthData)`.

> **⛔ Enterprise SSO / custom OIDC is PARKED.** `getAuthUrl` also accepts `idp: { connectionId }` for a custom OIDC provider (e.g. Auth0 / Okta). This is **not available in this skill yet** — minting the `connectionId` needs Wix-internal IAM connection APIs that aren't self-serve. **Do not build an SSO/OIDC login**, do not invent a `connectionId`. If a brief demands enterprise SSO, treat it as unsupported for now (fail loudly / note it as pending), and offer Google/Facebook or a credential form instead.

> **Works on any headless project.** Both mechanisms authenticate against the same Wix auth service and **work on managed and self-managed projects** — do not branch on project type. What *does* vary is the **frontend axis** (Astro vs non-Astro), covered in its own section below.

> **⚠️ The `{ idp }` option is typed-but-doc-thin.** The public `getAuthUrl` reference article shows only `getAuthUrl(oauthData)` — but the shipped `@wix/sdk` types define `getAuthUrl(oauthData, opts?: { prompt?: 'login' | 'none'; responseMode?: 'fragment' | 'web_message' | 'query'; idp?: IdentityProvider })`, with `IdentityProvider = 'google' | 'facebook' | { connectionId: string }`. It's a supported, typed API (verified against the SDK types and a working reference site) — the docs just under-document it. Don't be thrown by its absence from the article.

Pinned docs (read before wiring — `curl` the `.md` directly):
- Custom (direct-credential) login via the JS SDK: <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/members/custom-login-page/custom-login/custom-login-using-the-js-sdk.md>
- The callback exchange social login reuses (`generateOAuthData`/`getAuthUrl`/`parseFromUrl`/`getMemberTokens`): <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/members/wix-login-page/wix-managed-login-using-the-js-sdk.md>
- `OAuthStrategy` reference (`register`/`login`/`processVerification`/`getMemberTokensForDirectLogin`/`generateOAuthData`/`getAuthUrl`/`parseFromUrl`/`getMemberTokens`/`sendPasswordResetEmail`, the `StateMachine` + `IdentityProfile` objects): <https://dev.wix.com/docs/sdk/core-modules/sdk/oauth-strategy.md>
- Current member (SDK): <https://dev.wix.com/docs/sdk/frontend-modules/members/current-member/introduction> (open with `?apiView=SDK`)

---

## Preconditions

- **`clientId` only, never the secret.** Both mechanisms use the same **public** OAuth client id as the visitor client (`non-astro.md` N6). No `client_secret` in the frontend, ever.
- **The visitor session is automatic.** The client mints an anonymous visitor token on first use; you do **not** hand-mint a visitor token first.
- **Profile data still needs the Members Area app.** Reading the member back (`getCurrentMember`) and **defining `customFields`** need the **Wix Members Area app** installed (`SETUP.md`) — see the identity-vs-profile split below.
- **(A) direct-credential — no redirect / no allow-listed callback for login itself.** `register`/`login` are **direct API calls** — the visitor never leaves your page, so there is **no `redirectUri` to allow-list** for the login round-trip. (Two side flows *do* redirect and need an allow-listed URI: `sendPasswordResetEmail(email, redirectUri)` and `logout(originalUrl)`'s `logoutUrl`.)
- **(B) social — one prerequisite: the callback URI must be allow-listed.** `getAuthUrl` redirects out to Google/Facebook and back to your **callback page**; that URL must **exactly match** an allowed authorization redirect URI on the OAuth app. Not auto-registered on a non-Astro deploy — register it post-deploy via the API (`managed/DEPLOYMENT.md` → "Social login (Google/Facebook) on a non-Astro frontend"). The OAuth-app id to PATCH is `wix.config.json`'s **`appId`** (== the app id == public `clientId`; **not** `siteId`). **⚠️ By-id `GET`/`PATCH` can 404 `"appId was not found"` transiently for minutes post-release — that's an eventual-consistency race, not a bad id; retry with backoff (`QueryOAuthApps` resolves sooner).** Missing/unregistered callback → *"Invalid redirect URI."* Once the callback is allow-listed, the `getAuthUrl({ idp })` direct-to-provider flow completes end-to-end (verified live — Google + Facebook).

---

## Identity vs. profile — two layers, don't conflate them

- **Identity / auth** — sign up, log in, log out, "is this caller a member?". Native to the headless OAuth app. **No app install needed** — every login mechanism here runs on this layer alone.
- **Member profile / Members Area** — reading name / photo / roles, an editable my-account page, **and any custom field definitions**. Served by the **Wix Members Area app**, which **must be installed** (`SETUP.md`). `@wix/members` `getCurrentMember()` returns data only once that app is present.

If `getCurrentMember()` is empty on a site where `loggedIn()` is `true`, suspect the **Members Area app isn't installed** — not a code bug.

---

## (A) Direct-credential — build a form, call the SDK, handle the state machine

Reuse the one visitor client `non-astro.md` builds (`createClient({ modules: { members }, auth: OAuthStrategy({ clientId }) })`) — don't make a second client.

```js
// Sign up — register() takes a `profile` for custom fields (this is why you'd pick direct-credential)
const res = await client.auth.register({
  email, password,
  profile: {                       // all optional; include what the brief's sign-up form collects
    firstName, lastName,
    nickname,                      // ≈ username
    addresses: [{ address: { /* … */ } }],
    // customFields: { <fieldName>: <value> }   // ⚠️ see note below — needs field defs
  },
});

// Log in — same StateMachine shape, no profile
// const res = await client.auth.login({ email, password });

// Handle the result (both register and login return this)
switch (res.loginState) {
  case 'SUCCESS': {
    const tokens = await client.auth.getMemberTokensForDirectLogin(res.data.sessionToken);
    client.auth.setTokens(tokens);   // subsequent SDK calls now run as the member
    persistTokens(tokens);           // see persistence below
    break;                           // now render the member UI / navigate
  }
  case 'EMAIL_VERIFICATION_REQUIRED': {
    // Wix has emailed a 6-digit code. Collect it in your UI, then:
    const v = await client.auth.processVerification({ verificationCode });
    if (v.loginState === 'SUCCESS') {
      const tokens = await client.auth.getMemberTokensForDirectLogin(v.data.sessionToken);
      client.auth.setTokens(tokens); persistTokens(tokens);
    }
    break;
  }
  case 'OWNER_APPROVAL_REQUIRED':
    // Membership is pending owner approval — show a "pending" notice; they can log in once approved.
    break;
  case 'FAILURE':
    // Surface a message keyed off res.errorCode:
    //   invalidEmail | invalidPassword | emailAlreadyExists | resetPassword
    //   | missingCaptchaToken | invalidCaptchaToken
    // 'resetPassword' → call sendPasswordResetEmail (below), don't retry login.
    break;
}
```

- **`loggedIn()` gates everything.** `client.auth.loggedIn()` → `false` = anonymous, `true` = member. Render the account UI only when `true`; otherwise show your login form. (Same gate for both mechanisms.)
- **Password reset**: `await client.auth.sendPasswordResetEmail(email, redirectUri)` — `redirectUri` **must be an allow-listed** authorization redirect URI; Wix hosts the reset page and returns the member to it.

### The `loginState` state machine — handle every branch (don't assume SUCCESS)

`register()` / `login()` / `processVerification()` all return a `StateMachine` (`{ loginState, data: { sessionToken }, errorCode, error }`). The trap is coding only the happy path:

- **`SUCCESS`** — exchange `data.sessionToken` for tokens (above). Only here do you get a session.
- **`EMAIL_VERIFICATION_REQUIRED`** — fires when a brand-new registrant's email **already exists as a contact**, or when **email verification is enabled** in the site's Member Settings. You must build the code-entry step (`processVerification`) or login silently dead-ends. With default settings + a fresh email, you'll usually get `SUCCESS` straight away — but code the branch anyway; it's site-setting-dependent, not code-dependent.
- **`OWNER_APPROVAL_REQUIRED`** — signup policy is manual-approval; show "pending", don't treat as an error.
- **`FAILURE`** — branch on `errorCode` (`invalidEmail` / `invalidPassword` / `emailAlreadyExists` / `resetPassword` / captcha codes). `emailAlreadyExists` on register = route them to log in; `resetPassword` = send a reset email.

**Signup security (email verification, owner approval, reCAPTCHA) is dashboard-governed, not code.** These are Site-Member-Settings toggles — document them as host-configurable, don't try to set them from a headless run. There is **no headless TOTP/SMS 2FA**; the security layers are password + email verification + reCAPTCHA. If reCAPTCHA is enabled in settings, pass `captchaTokens` to `register`/`login` (`OAuthStrategy` exposes `captchaVisibleSiteKey`/`captchaInvisibleSiteKey`).

### Custom sign-up fields — the whole reason to pick direct-credential

`register`'s `profile` (`IdentityProfile`) accepts `firstName`, `lastName`, `nickname` (≈ username), `picture`, `phones`, `addresses`, `labels`, `language`, `privacyStatus`, and **`customFields`** (an arbitrary `name → value` map). So "username + email + full name + address + password" maps straight onto `profile`.

- **⚠️ Standard fields work as-is; arbitrary `customFields` need field definitions.** `firstName`/`lastName`/`nickname`/`addresses`/`phones` are accepted directly. But keys inside `customFields` must first be **defined** via the Members Custom Fields API (which needs the **Members Area app**) — an undefined custom field is silently dropped. If the brief's extra fields are the standard ones, you need no field defs; only truly custom keys do.
- Social login **cannot** collect any of these — that's the capability direct-credential uniquely unlocks, and the reason to take on the extra code.

---

## (B) Social login (Google / Facebook) — your buttons, the provider's screen

You render your own branded buttons; each redirects to Google/Facebook and returns through a callback page that finishes the exchange. `IdentityProvider` here is just the string literal `'google'` or `'facebook'`.

### Kick-off (the page with the buttons)

```js
// A data-idp-driven button set keeps both providers on one code path:
//   <button data-idp="google">Continue with Google</button>
//   <button data-idp="facebook">Continue with Facebook</button>
async function signIn(idp /* 'google' | 'facebook' */) {
  // callbackUri MUST exactly match an allowed redirect URI on the OAuth app.
  const callbackUri = new URL('/callback', window.location.origin).href;
  const here = window.location.href.split(/[?#]/)[0];          // where to return the member afterwards
  const oAuthData = client.auth.generateOAuthData(callbackUri, here);
  localStorage.setItem('wixOAuthData', JSON.stringify(oAuthData)); // needed on the callback page
  const { authUrl } = await client.auth.getAuthUrl(oAuthData, { idp });
  window.location.href = authUrl;                             // leaves your site → provider
}
```

### Callback page (`/callback`) — finish the exchange

The provider returns to your callback URL with `#code=` and `#state=` in the fragment. This page reads back the stored `oAuthData` and completes the exchange:

```js
const returned = client.auth.parseFromUrl();
if (returned.error) throw new Error(returned.errorDescription || returned.error);

const oAuthData = JSON.parse(localStorage.getItem('wixOAuthData'));
localStorage.removeItem('wixOAuthData');
const tokens = await client.auth.getMemberTokens(returned.code, returned.state, oAuthData);
client.auth.setTokens(tokens);
persistTokens(tokens);                       // localStorage; a reload re-hydrates from it
window.location.replace(oAuthData.originalUri || '/');
```

- **Note the different exchange call.** Social uses `getMemberTokens(code, state, oAuthData)` — **not** `getMemberTokensForDirectLogin(sessionToken)`. Mixing them up is the classic error when a page has both a credential form and a social button.
- **`prompt: 'login'`** (second option to `getAuthUrl`) forces the provider to re-authenticate even if a session exists (useful for "switch account"); omit it for the default behaviour.
- The callback page spans a separate load, so the stored `oAuthData` travels via `localStorage` — see persistence below.

> **✅ Social login completes end-to-end once `/callback` is allow-listed.** After building this, register the callback URI on the OAuth app (`managed/DEPLOYMENT.md` → "Social login (Google/Facebook) on a non-Astro frontend") — that's the **one** prerequisite, and there is no additional platform gate to clear. The `getAuthUrl({ idp })` direct-to-provider flow then works (verified live — Google + Facebook). The callback allow-listing is auto-handled on Astro and is a post-deploy API `PATCH` on a non-Astro frontend. Direct-credential (A) needs no callback registration at all, so it's marginally simpler when the brief doesn't specifically call for social — but social is a fully supported, working path.

---

## Frontend axis — non-Astro (browser client) and Astro (client island + `wixSession` cookie)

Both mechanisms are **client-driven `OAuthStrategy`** calls. **They MUST run in the browser** — `register`/`login`/`getMemberTokensForDirectLogin` reach `window` (the SDK's iframe/postMessage token exchange, `@wix/sdk/.../iframeUtils`), so running them in a **server route throws `ReferenceError: window is not defined` (500)**. Don't put the auth calls in `src/pages/api/*.ts`.

- **Non-Astro (Vite/React/Vue SPA, static HTML)** — the natural, proven path. Build the client once (`non-astro.md` §1), run the calls above in the browser, persist tokens in `localStorage`. Everything in this recipe applies directly.
- **Astro (verified 2026-07-13 on `@wix/astro` 2.63.0)** — custom login **works**, but it runs **outside** auto-auth, in a **hydrated client island** (a `<script>` / framework island), **never in SSR frontmatter or a backend route** (public `clientId` is `undefined` at SSR → 500; the auth calls need `window` → 500). The pattern that verified end-to-end:
  1. In the island, build your own `createClient({ auth: OAuthStrategy({ clientId: WIX_CLIENT_ID }) })` — `WIX_CLIENT_ID` is a **client-readable** env var (`import { WIX_CLIENT_ID } from 'astro:env/client'`; the integration provisions it).
  2. Run `register`/`login` (or `getAuthUrl({ idp })` for social) → `getMemberTokensForDirectLogin(sessionToken)` → member `tokens`.
  3. **Propagate to auto-auth by writing the `wixSession` cookie** in the shape the `@wix/astro` middleware reads: `{ clientId: WIX_CLIENT_ID, tokens }` (it rejects the cookie unless `clientId === WIX_CLIENT_ID`). Simplest robust way: POST the tokens to a tiny `src/pages/api/*.ts` route that calls `cookies.set('wixSession', { clientId: WIX_CLIENT_ID, tokens }, { path: '/', secure: true })` (identical to the integration's own `saveSessionTokensToCookie`) — this hands cookie encoding to Astro. Then navigate.
  4. Now **ambient server-side `getCurrentMember()` runs as the member** (verified). Gate pages in SSR frontmatter as usual.
  - Do **not** use Astro's built-in `/api/auth/login` route — it redirects to the removed Wix login page. `@wix/astro` also ships a `components/login.astro` element in some versions, but it's undocumented and version-dependent (and its cookie write is out of sync in at least one version) — prefer the explicit island pattern above.

---

## Token persistence & renewal — treat member tokens like visitor tokens

Member tokens are the **same token set** the visitor session machinery already handles; login just swaps them in — identically for both mechanisms.

- **Persist** the token set (localStorage or a cookie) after `setTokens` so a reload stays logged in. On boot, if you have a stored set, `client.auth.setTokens(stored)` before first render — or pass `tokens` into `OAuthStrategy({ clientId, tokens })` at client creation.
- **Renew** with `client.auth.renewToken(refreshToken)` (or the SDK's automatic renewal when you re-hydrate via `setTokens`). A member session expiring is normal — refresh, don't force a re-login unless the refresh token is gone.
- **Logout** is a redirect (both mechanisms): `const { logoutUrl } = await client.auth.logout(window.location.href); clearPersistedTokens(); window.location.href = logoutUrl;`. On logout, **clear** the persisted set so the next boot is a clean anonymous visitor. If `logout()` throws `FAILED_TO_EXTRACT_SESSION` (token's session already dead), just clear locally and reload as a visitor.
- **One client per document, session carried via `localStorage`.** Within a page, keep **one shared client instance** — creating a new client per component drops the session (a documented pitfall). The social flow inherently spans two documents (initiator + callback); the session travels through `localStorage` (`wixOAuthData` for the exchange, then the persisted token set).

---

## Read the current member — `@wix/members`, not the dev-preview package

```js
import { members } from '@wix/members';
const { member } = await client.members.getCurrentMember({ fieldsets: ['FULL'] });
// member.profile?.nickname, member.profile?.photo, member.loginEmail, member.contactId, member.roles
```

- **⚠️ The SDK export is `getCurrentMember`, NOT `getMyMember`.** The REST method is named *Get My Member* and the SDK docs page may show `GetMyMember`, but `@wix/members` exports it as **`client.members.getCurrentMember`** — calling `getMyMember(...)` throws `is not a function` at runtime. Silent trap: a logged-out smoke test never reaches the call.
- **⚠️ Use `@wix/members`**, not the Developer-Preview `@wix/site-members`.
- The **photo** is a `wix:image://` identifier — resolve with `media.getScaledToFillImageUrl` (`non-astro.md` N7); never hand-build the CDN URL.
- **Another member by id → PUBLIC fieldset only**; a **private** profile returns nothing to a member/visitor identity (relevant to any "look up author by id" lookup, e.g. blog comments).

---

## pricing-plans is a HARD dependency on members

If the site has pricing-plans (membership / subscription / paid tiers), **login is required, not optional**. Ordering a plan (`orders.createOnlineOrder(planId)`) orders it **for a logged-in member**; `orders.memberListOrders()` and "my subscription" reads return **nothing** for an anonymous visitor. So the plans grid is public, but the **subscribe** button and the **my-subscription** surface both need the login flow above; a logged-in member calling `orders.createOnlineOrder` needs **no `onBehalf`**. Everywhere else (stores "my orders", bookings "my bookings", events "my registrations"), login is a *soft* add-on — the purchase/RSVP/book action runs fine as an anonymous visitor; only the account view of it needs a member.

---

## ⚠️ Do NOT `auth.elevate()` — wrong axis (and unavailable on a SPA)

**Login** is the **identity** axis (anonymous → a specific member). **`auth.elevate()`** is the **permission** axis (→ app/admin scope). A member reading **their own** data (own profile, own orders/bookings/subscriptions, plan-gated or member-scoped content) is authorized under the **member token, no elevation** — reaching for elevate to "make member data work" is the wrong axis. A pure SPA has no server, so there is no `auth.elevate` at all (`non-astro.md` N5) — and member features don't need it.

---

## Conclusion
Correct member auth in this skill:
- is always a **custom, in-app login you build** — the Wix-hosted login-page redirect is removed; no `/api/auth/login` route, no `how-to-code-members-{astro,non-astro}` recipe;
- works on **any** headless project (managed or self-managed) — **no project-type branch**;
- picks one (or both) of **two mechanisms**: **(A) direct-credential** (`register`/`login` → `getMemberTokensForDirectLogin`, no redirect, custom fields) and **(B) social** (`getAuthUrl(oAuthData, { idp: 'google' | 'facebook' })` → callback exchange `parseFromUrl` → `getMemberTokens`) — and does **not** blend their token-exchange calls;
- treats **enterprise SSO / custom OIDC (`idp: { connectionId }`) as PARKED** — not built, no fabricated `connectionId`;
- for (A), **handles the full `loginState` machine** (SUCCESS / EMAIL_VERIFICATION_REQUIRED / OWNER_APPROVAL_REQUIRED / FAILURE+`errorCode`), not just SUCCESS, and collects custom fields via `register`'s `profile`;
- for (B), **allow-lists the callback URI** via the API (post-deploy; PATCH the OAuth app by its `id` == `wix.config.json` `appId` == `clientId`, retrying the transient post-release 404) — the one prerequisite; the `getAuthUrl({ idp })` flow then completes end-to-end (verified live — Google + Facebook);
- runs cleanly on **non-Astro** (browser client); on **Astro** the auth calls run in a **hydrated client island** (never a backend route or SSR frontmatter — they need `window`), then write the `wixSession` cookie so ambient `getCurrentMember()` sees the member (verified);
- treats signup security (verification / approval / reCAPTCHA) as **dashboard-governed** and states MFA is unsupported headless;
- **persists and renews** member tokens like visitor tokens — one client per document, session carried via `localStorage`;
- reads the member via **`@wix/members` `getCurrentMember`** (not the dev-preview package);
- treats **login as required** whenever pricing-plans is present, and as a soft add-on for the other verticals' "my …" surfaces;
- does **no `auth.elevate`** for own-data reads;
- needs the **Wix Members Area app** only for profile *data* and custom-field definitions — pure "logged-in vs not" gating runs on the identity layer with no install.
