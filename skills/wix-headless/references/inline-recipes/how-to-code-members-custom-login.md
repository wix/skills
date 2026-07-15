---
name: "How to Code Members (custom login page)"
description: The frontend contract for a **custom, branded login/sign-up page** — you build the UI and drive Wix's auth service directly with the `OAuthStrategy` SDK (`register` / `login` / `processVerification` / `getMemberTokensForDirectLogin` / `setTokens` / `sendPasswordResetEmail` / `logout`), instead of redirecting to the Wix-hosted login page. This is the surface to use **only when the brief asks for a custom/in-app login form or custom sign-up fields** (name, address, username, arbitrary fields); otherwise use the Wix login page (`how-to-code-members-*.md`). Covers the `loginState` state machine (SUCCESS / EMAIL_VERIFICATION_REQUIRED / OWNER_APPROVAL_REQUIRED / FAILURE), custom `profile` fields at sign-up, token persistence, reading the member with `@wix/members`, and the no-`auth.elevate` rule. Works on **any** headless project (managed or self-managed) — the choice is intent, not project type.
---
**RECIPE**: How to Code a **Custom Login Page** (branded in-app auth, `OAuthStrategy` `register`/`login`, `@wix/members`)

A concise contract for building your **own** login / sign-up / logout UI and driving Wix's authentication service directly — instead of bouncing the visitor to the Wix-hosted login page. **This is the *how* (which SDK calls, which states, which failure modes), not the *what*** — the form design, which pages are gated, and what the account page shows come from the request you're fulfilling.

> **⚠️ WHEN TO USE THIS RECIPE — intent, not project type.** Reach for custom login **only when the brief explicitly asks for it**: a **branded / in-app login form** (the visitor never leaves your UI) *or* **custom sign-up fields** (full name, username/nickname, address, arbitrary fields). If the brief just says "let members log in / sign up / have an account" with no mention of a custom form or extra fields, **use the Wix login page instead** — `how-to-code-members-astro.md` (Astro) or `how-to-code-members-non-astro.md` (non-Astro). The Wix login page needs zero UI and is the deterministic default; custom login is more code and more failure modes, so take it on only on real intent.

> **Works on any headless project.** The Wix docs frame custom login pages as "self-managed only," but that's positioning, not a technical lockout — the `register`/`login` SDK methods (and their `Register V2`/`Login V2` IAM endpoints) authenticate against the same Wix auth service and **work on managed projects too**. So **do not branch on project type** — if the intent is custom login, build it; the flow below is identical on managed and self-managed.

> **One client, one flow — sign-up and log-in are the same machine.** Both `register()` and `login()` return the **same** `StateMachine` shape and both end at `getMemberTokensForDirectLogin` → `setTokens`. Member tokens are the **same shape** as visitor tokens (`role: member`); logging in just swaps the token set on the visitor client you already have.

> **⚠️ This is a client-driven (`OAuthStrategy`) flow — it is the non-Astro shape.** `register`/`login` live on `client.auth`, i.e. the manual visitor client `non-astro.md` builds. Astro's auto-auth ships **no client** to call them on. So: on a **non-Astro** frontend (SPA / static), this is the natural path. On **Astro**, custom login means stepping *outside* auto-auth — instantiate an explicit `OAuthStrategy` client (in a backend route or a client island) to run these calls; do **not** expect the built-in `/api/auth/*` routes to do custom login (they only drive the Wix login page). If the brief is Astro *and* doesn't demand a custom form, prefer the Wix login page (`how-to-code-members-astro.md`).

Pinned docs (read before wiring — `curl` the `.md` directly):
- Custom login via the JS SDK: <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/members/custom-login-page/custom-login/custom-login-using-the-js-sdk.md>
- `OAuthStrategy` reference (`register`/`login`/`processVerification`/`getMemberTokensForDirectLogin`/`sendPasswordResetEmail`, the `StateMachine` + `IdentityProfile` objects): <https://dev.wix.com/docs/sdk/core-modules/sdk/oauth-strategy.md>
- Current member (SDK): <https://dev.wix.com/docs/sdk/frontend-modules/members/current-member/introduction> (open with `?apiView=SDK`)

---

## Preconditions

- **`clientId` only, never the secret.** Custom login uses the same **public** OAuth client id as the visitor client (`non-astro.md` N6). No `client_secret` in the frontend, ever.
- **No redirect / no allow-listed callback for login itself.** Unlike the Wix login page, `register`/`login` are **direct API calls** — the visitor never leaves your page, so there is **no `redirectUri` to allow-list** for the login round-trip. (Two side flows *do* redirect and need an allow-listed URI: `sendPasswordResetEmail(email, redirectUri)` and `logout(originalUrl)`'s `logoutUrl`. Allow-list those URLs on the OAuth app if you wire password reset / logout return.)
- **The visitor session is automatic.** The client mints an anonymous visitor token on first use, and `register`/`login` run under it — you do **not** hand-mint a visitor token first. (That manual step only exists in the raw-REST version of this flow.)
- **Profile data still needs the Members Area app.** Reading the member back (`getCurrentMember`) and **defining `customFields`** need the **Wix Members Area app** installed (`SETUP.md`) — see the identity-vs-profile split below.

---

## Identity vs. profile — two layers, don't conflate them

- **Identity / auth** — sign up, log in, log out, "is this caller a member?". Native to the headless OAuth app. **No app install needed** — the whole `register`/`login`/`loggedIn()` flow below runs on this layer alone.
- **Member profile / Members Area** — reading name / photo / roles, an editable my-account page, **and any custom field definitions**. Served by the **Wix Members Area app**, which **must be installed** (`SETUP.md`). `@wix/members` `getCurrentMember()` returns data only once that app is present.

If `getCurrentMember()` is empty on a site where `loggedIn()` is `true`, suspect the **Members Area app isn't installed** — not a code bug.

---

## The flow — build a form, call the SDK, handle the state machine

Reuse the one visitor client `non-astro.md` builds (`createClient({ modules: { members }, auth: OAuthStrategy({ clientId }) })`) — don't make a second client.

```js
// Sign up — register() takes a `profile` for custom fields (this is why you'd pick custom login)
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

- **`loggedIn()` gates everything.** `client.auth.loggedIn()` → `false` = anonymous, `true` = member. Render the account UI only when `true`; otherwise show your login form.
- **Logout** is a redirect (same as the Wix-login path): `const { logoutUrl } = await client.auth.logout(window.location.href); clearPersistedTokens(); window.location.href = logoutUrl;`
- **Password reset**: `await client.auth.sendPasswordResetEmail(email, redirectUri)` — `redirectUri` **must be an allow-listed** authorization redirect URI; Wix hosts the reset page and returns the member to it.

---

## The `loginState` state machine — handle every branch (don't assume SUCCESS)

`register()` / `login()` / `processVerification()` all return a `StateMachine` (`{ loginState, data: { sessionToken }, errorCode, error }`). The trap is coding only the happy path:

- **`SUCCESS`** — exchange `data.sessionToken` for tokens (above). Only here do you get a session.
- **`EMAIL_VERIFICATION_REQUIRED`** — fires when a brand-new registrant's email **already exists as a contact**, or when **email verification is enabled** in the site's Member Settings. You must build the code-entry step (`processVerification`) or login silently dead-ends. With default settings + a fresh email, you'll usually get `SUCCESS` straight away — but code the branch anyway; it's site-setting-dependent, not code-dependent.
- **`OWNER_APPROVAL_REQUIRED`** — signup policy is manual-approval; show "pending", don't treat as an error.
- **`FAILURE`** — branch on `errorCode` (`invalidEmail` / `invalidPassword` / `emailAlreadyExists` / `resetPassword` / captcha codes). `emailAlreadyExists` on register = route them to log in; `resetPassword` = send a reset email.

**Signup security (email verification, owner approval, reCAPTCHA) is dashboard-governed, not code.** These are Site-Member-Settings toggles — document them as host-configurable, don't try to set them from a headless run. There is **no headless TOTP/SMS 2FA**; the security layers are password + email verification + reCAPTCHA. If reCAPTCHA is enabled in settings, pass `captchaTokens` to `register`/`login` (`OAuthStrategy` exposes `captchaVisibleSiteKey`/`captchaInvisibleSiteKey`).

---

## Custom sign-up fields — the whole reason to pick this surface

`register`'s `profile` (`IdentityProfile`) accepts `firstName`, `lastName`, `nickname` (≈ username), `picture`, `phones`, `addresses`, `labels`, `language`, `privacyStatus`, and **`customFields`** (an arbitrary `name → value` map). So "username + email + full name + address + password" maps straight onto `profile`.

- **⚠️ Standard fields work as-is; arbitrary `customFields` need field definitions.** `firstName`/`lastName`/`nickname`/`addresses`/`phones` are accepted directly. But keys inside `customFields` must first be **defined** via the Members Custom Fields API (which needs the **Members Area app**) — an undefined custom field is silently dropped. If the brief's extra fields are the standard ones, you need no field defs; only truly custom keys do.
- The Wix login page **cannot** collect any of these — that's the capability custom login uniquely unlocks, and the reason to take on the extra code.

---

## Token persistence & renewal — treat member tokens like visitor tokens

Member tokens are the **same token set** the visitor session machinery already handles; login just swaps them in.

- **Persist** the token set (localStorage or a cookie) after `setTokens` so a reload stays logged in. On boot, if you have a stored set, `client.auth.setTokens(stored)` before first render — or pass `tokens` into `OAuthStrategy({ clientId, tokens })` at client creation.
- **Renew** with `client.auth.renewToken(refreshToken)` (or the SDK's automatic renewal when you re-hydrate via `setTokens`). A member session expiring is normal — refresh, don't force a re-login unless the refresh token is gone.
- On logout, **clear** the persisted set so the next boot is a clean anonymous visitor.
- **Keep one shared client instance** — creating a new client per component drops the session (a documented custom-login pitfall).

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

---

## ⚠️ Do NOT `auth.elevate()` — wrong axis (and unavailable on a SPA)

**Login** is the **identity** axis (anonymous → a specific member). **`auth.elevate()`** is the **permission** axis (→ app/admin scope). A member reading **their own** data (own profile, own orders/bookings/subscriptions, plan-gated or member-scoped content) is authorized under the **member token, no elevation** — reaching for elevate to "make member data work" is the wrong axis. A pure SPA has no server, so there is no `auth.elevate` at all (`non-astro.md` N5) — and member features don't need it.

---

## Conclusion
Correct custom-login auth:
- is taken on **only when the brief asks for a branded/in-app login form or custom sign-up fields** — otherwise the Wix login page (`how-to-code-members-{astro,non-astro}.md`) is the default;
- works on **any** headless project (managed or self-managed) — **no project-type branch**;
- reuses the **one visitor `OAuthStrategy` client** and drives `register` / `login` / `processVerification` → `getMemberTokensForDirectLogin` → `setTokens`, with `logout` and `loggedIn()`;
- **handles the full `loginState` machine** (SUCCESS / EMAIL_VERIFICATION_REQUIRED / OWNER_APPROVAL_REQUIRED / FAILURE+`errorCode`), not just SUCCESS;
- collects custom fields via `register`'s `profile` — standard fields directly, arbitrary `customFields` only after defining them (needs the Members Area app);
- treats signup security (verification / approval / reCAPTCHA) as **dashboard-governed**, sets none from the run, and states MFA is unsupported headless;
- **persists and renews** member tokens like visitor tokens, on **one shared client**;
- reads the member via **`@wix/members` `getCurrentMember`** (not the dev-preview package);
- does **no `auth.elevate`** for own-data reads;
- needs the **Wix Members Area app** only for profile *data* and custom-field definitions — pure "logged-in vs not" gating runs on the identity layer with no install.
