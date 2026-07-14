
# Wix Members — custom login (client-only REST)

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and this
> vertical's `references/members/wix-members-auth.js`. Copy **both** into your app's `src/rest/` side by
> side — the helper does `import { … } from "./wix-client.js"`, so they must land in the same folder.

Adds real **member accounts** to a client-only headless front end: sign up, log in, log out, and
member-gated surfaces — all from the browser over the public `WIX_CLIENT_ID`, no SDK, no backend.

**This is *custom* login: the front owns its login UI.** The member types credentials in **your own
form on your own page** (or clicks your own social button) — they are **never redirected to a
Wix-hosted login page**. This is the REST equivalent of the SDK `OAuthStrategy` recipe; the older
"redirect the user to a Wix login page" flow is deliberately **not** used here.

## When to use
- User wants members to **sign up / log in** on a page they built (email+password, "Continue with
  Google/Facebook", or custom SSO), with the login UI living in their own app.
- User wants **member-gated** content, an **account / profile** page, or a "my orders / my bookings /
  my plans" view (those reads need a logged-in member).
- **Pricing-plans is present.** Buying/reading a member's plans is members-only — pair this vertical
  with `pricing-plans` so the member can log in *before* the subscribe / "my subscription" surface.

## Two mechanisms — pick by the brief (a page may use both)

| | **(A) Direct-credential** | **(B) Social / SSO** |
| :-- | :-- | :-- |
| **Use when** | your own email+password form, or custom sign-up fields | "Sign in with Google / Facebook", or enterprise SSO |
| **User leaves your page?** | **No** — silent iframe token exchange | **Yes** — full-page redirect to the provider, back to your `/callback` |
| **Kick-off** | `register()` / `login()` | `startSocialLogin(idp, callbackUri)` |
| **Finish** | automatic on `SUCCESS` | `completeSocialLogin()` on the `/callback` page |
| **Custom sign-up fields?** | Yes (`register`'s `profile`) | No — the provider owns the identity |
| **Needs an allow-listed origin/URI?** | **Yes** — your app **origin** (postMessage target) | **Yes** — your `/callback` **URL** |

Both converge on the **same end state**: member tokens written onto the shared client, so **every
later `wixApiRequest` runs as the member** (login just swaps the token set on the client you already
have). Don't blend their exchange calls — the helper handles each internally.

## Prerequisites
1. A Wix site with the **Members Area app installed** if you need member *profile* data (name, photo,
   roles) or custom field definitions. Pure "logged-in vs. not" gating needs no app — see the
   identity-vs-profile split below.
2. The site's public headless **`WIX_CLIENT_ID`** (from the handoff prompt), pasted into
   `src/rest/wix-client.js`. Public, buyer-facing credential — safe to hardcode/commit.
3. **OAuth-app allow-listing — the #1 gotcha. Two *different* fields gate the two mechanisms:**

   | Mechanism | What must be allow-listed | OAuth-app field | On `localhost:4321`? |
   | :-- | :-- | :-- | :-- |
   | **(A) direct-credential** | your app **origin** (the hidden iframe `postMessage`s the code back to it) | `allowedRedirectDomains` | ✅ allowed by default |
   | **(B) social / SSO** | the **exact `/callback` URL** (full-page redirect target) | `allowedRedirectUris` | ❌ **must be added** |

   - `localhost:4321` is Wix's default-allowed dev **origin**, so **credential login works there with zero
     setup**. But social **still fails on `localhost:4321`** until you add `http://localhost:4321/callback`
     to `allowedRedirectUris` — the default covers the origin, not the callback URI. (These are genuinely
     two separate fields; matching Oz's SDK `wix-headless` `managed/DEPLOYMENT.md`.)
   - **Any non-default origin** — your deployed domain (e.g. a Base44 URL), a different localhost port —
     must be registered too: the origin (for A) and the `<origin>/callback` (for B).
   - **Symptoms:** (A) unregistered origin → login hangs, then `MemberAuthError('timeout')` + a console
     *"Failed to execute 'postMessage'… target origin … does not match"*. (B) unregistered callback →
     the Wix authorize page shows *"Invalid redirect URI. Please add an allowed URI to your OAuth App"*
     **before** returning — so the client can't catch it; you must register it up front.
   - Google & Facebook are enabled by default; **custom SSO** also needs an IDP connection created in
     the Business Manager, whose **connection id** you pass as `idp` (see "Custom SSO" below).

   > **⚠️ AGENT: this is a manual, owner-only step you cannot do from client-only code — surface it
   > proactively.** As soon as a run uses social/SSO (or deploys credential login to a non-`4321`
   > origin), **tell the user** the exact URIs to add and where, and note that **social login stays
   > dead until they do it** (a client-only front has no account token to register it via the API).
   > See "Point the user to their dashboard" below for the deep link and the exact values.

## The API (copy as-is; do not re-derive it)
Copy `wix-client.js` + `wix-members-auth.js` into `src/rest/` and set `WIX_CLIENT_ID`. Exports of
`wix-members-auth.js`:
- **Direct-credential:** `register(email, password, profile?)`, `login(email, password)`,
  `verifyEmail(code, stateToken)`, `sendPasswordResetEmail(email, redirectUri)`
- **Social / SSO:** `startSocialLogin(idp, callbackUri, returnTo?)`, `completeSocialLogin()`, `IDP`
- **Session:** `isLoggedIn()`, `getCurrentMember()`, `logout(returnTo?)`
- **Errors:** `MemberAuthError` (`.code` + `.message`)

The full state-machine, `profile`, and error semantics are documented as JSDoc at the top of
`wix-members-auth.js`. **Read it before wiring the UI.**

## How to wire it (UI is the project's choice — the skill ships the REST layer only)

### (A) Credential form + the state machine — handle every branch (not just SUCCESS)
`register()` / `login()` / `verifyEmail()` resolve to `{ state, member?, stateToken? }`:
- **`"SUCCESS"`** → logged in; `member` is populated (or `null` if the Members Area app isn't
  installed). Render the account UI / navigate.
- **`"REQUIRE_EMAIL_VERIFICATION"`** → a 6-digit code was emailed. Collect it and call
  `verifyEmail(code, stateToken)`. (Fires when a new registrant's email already exists as a contact,
  or when email verification is enabled in Member Settings.)
- **`"REQUIRE_OWNER_APPROVAL"`** → show a "pending approval" notice; not an error.

Hard failures **throw** a `MemberAuthError` — catch it and show `err.message` (`.code` is stable:
`invalidCredentials`, `emailAlreadyExists`, …). `emailAlreadyExists` on register → route to log in.

```js
import { login, register, verifyEmail, isLoggedIn, getCurrentMember, logout, MemberAuthError } from "./rest/wix-members-auth.js";
try {
  const res = await login(email, password);
  if (res.state === "SUCCESS") showAccount(res.member);
  else if (res.state === "REQUIRE_EMAIL_VERIFICATION") promptForCode(res.stateToken);
  else if (res.state === "REQUIRE_OWNER_APPROVAL") showPending();
} catch (e) {
  if (e instanceof MemberAuthError) showError(e.message); else throw e;
}
```

Custom sign-up fields go in `register`'s `profile` (`{ firstName, lastName, nickname, addresses, … }`).
Standard fields work as-is; arbitrary `customFields` keys must first be defined in the Members Area
app or they're silently dropped.

### (B) Social / SSO — your button + a `/callback` route
```js
// on your login page:
import { startSocialLogin, IDP } from "./rest/wix-members-auth.js";
const callbackUri = new URL("/callback", window.location.origin).href; // must be allow-listed
onGoogleClick   = () => startSocialLogin(IDP.GOOGLE,   callbackUri, window.location.pathname);
onFacebookClick = () => startSocialLogin(IDP.FACEBOOK, callbackUri, window.location.pathname);

// on the /callback page (a route/page at exactly that path):
import { completeSocialLogin } from "./rest/wix-members-auth.js";
const { member, returnTo } = await completeSocialLogin();
window.location.replace(returnTo || "/");
```
**Custom SSO:** identical call — pass your connection id as `idp` instead of `IDP.GOOGLE`:
`startSocialLogin("<connectionId>", callbackUri)`. The connection id comes from an IDP connection you
create in the Business Manager (dashboard link below).

### Session, account area, logout
- **Gate UI** on `isLoggedIn()`. Read the member with `await getCurrentMember()` (name / photo / roles
  / custom fields) — returns `null` for a visitor or when the Members Area app isn't installed.
- **Logout:** `await logout()` — clears local tokens and redirects through the Wix logout URL; the
  client is a clean anonymous visitor afterward.
- **Persistence is automatic.** Member tokens live in the same `localStorage` the visitor token used,
  so a reload stays logged in and tokens auto-refresh via `wix-client.js` — do **not** add your own.

## Identity vs. profile — don't conflate them
- **Identity / auth** — sign up, log in, log out, "is this caller a member?". Native to the headless
  OAuth app. **No app install needed** — every login mechanism here runs on this layer alone.
- **Member profile / Members Area** — name / photo / roles, an account page, and custom-field
  definitions. Served by the **Members Area app**, which must be installed. If `getCurrentMember()`
  returns `null` while `isLoggedIn()` is `true`, suspect the app isn't installed — not a code bug.

## Hard rules (do not violate)
- ✅ **Custom login only.** The member logs in on **your** UI; never redirect them to a Wix-hosted
  login page, and never use a Wix login-page redirect for member auth.
- ✅ **One shared client.** Member login swaps the token set on `wix-client.js` — reuse the same
  transport for everything so the member identity (and their cart) carries across the app. Never mint
  a second client or re-mint anonymously after login (it drops the member).
- ❌ **Don't blend the two exchanges.** Credential login finishes via the hidden iframe; social
  finishes via `/callback`. The helper keeps them separate — don't cross-wire.
- ❌ **Never fake a member.** No mock "logged-in" state, no invented profile, roles, or member counts.
  Render the real member or the logged-out state.
- ✅ **Fail loudly.** The helper throws `MemberAuthError` on bad credentials, state mismatch, timeout,
  and token-exchange failure — surface them; don't swallow.
- ⛔ **No `elevate` / admin scope.** A member reading their **own** data (profile, own orders /
  bookings / plans) is authorized by the member token alone. There is no admin elevation on a
  client-only front, and own-data reads don't need it.
- ⛔ **MFA / TOTP is not available headless.** The security layers are password + email verification +
  reCAPTCHA, all **dashboard-governed** — document them as host-configurable, don't set them from code.

## Beyond the snippets
The helper covers sign-up / login / social / SSO / logout / current-member. For a genuine gap, extend
with `wixApiRequest` — but confirm the endpoint, method, and body in the API reference first (or via
the co-installed **`wix-docs`** skill). Never guess.
- Custom login (JS SDK, concepts mirror the REST calls): https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/members/custom-login-page/custom-login/custom-login-using-the-js-sdk.md
- External / social login (REST): https://dev.wix.com/docs/rest/business-management/headless-authentication/redirects/create-redirect-session
- Retrieve Tokens (REST): https://dev.wix.com/docs/rest/business-management/headless-authentication/authentication/retrieve-tokens
- Members API (read/update profile, query members): https://dev.wix.com/docs/api-reference/members/members/members-v1/introduction

## Point the user to their dashboard
Some setup only happens in the Wix dashboard — always give the user the deep links:
- **Members Area app** (for profile data + custom fields) — `https://manage.wix.com/dashboard/{metaSiteId}/member-permissions`
- **Signup security** (email verification, owner approval, reCAPTCHA) — `Dashboard → Settings → Login & Security` / member signup settings
- **Allowed authorization redirect URIs** — the OAuth-app / **Headless Settings** for the project:
  `https://manage.wix.com/dashboard/{metaSiteId}/oauth-apps-settings`. Add:
  - the **app origin** (e.g. `https://myapp.example.com`) — needed for direct-credential login from a
    non-default origin (`localhost:4321` is pre-allowed);
  - the **exact `/callback` URL** (e.g. `https://myapp.example.com/callback`) — required for social/SSO;
  - also add password-reset / logout return URLs if you use them.
  Tell the user these exact values; the callback URL must match your `startSocialLogin` `callbackUri`
  character-for-character.
- **Custom SSO connection** (to obtain a `connectionId`) — created under the project's IAM / SSO
  settings in the Business Manager.

Substitute the site's `metaSiteId` (from the handoff / `ListWixSites`).

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Sign-up: `register()` returns `SUCCESS` (or `REQUIRE_EMAIL_VERIFICATION` handled via `verifyEmail`)
- [ ] Log-in: `login()` reaches `SUCCESS`; wrong password shows `invalidCredentials`, not a crash
- [ ] After login `isLoggedIn()` is `true` and `getCurrentMember()` returns the member (or `null` with
      the Members Area app not installed — documented, not a bug)
- [ ] A member-scoped read (e.g. pricing-plans "my plans") now returns the member's data via the same client
- [ ] Social: the button redirects to the provider and `/callback` logs the member in (callback URL
      allow-listed); custom SSO works with its `connectionId` (or is flagged as pending host setup)
- [ ] Logout clears the session and the next load is a clean anonymous visitor
- [ ] No mocked member state, profile, or roles anywhere
- [ ] Told the user about any required dashboard setup (Members Area app, allowed redirect URIs) with deep links
