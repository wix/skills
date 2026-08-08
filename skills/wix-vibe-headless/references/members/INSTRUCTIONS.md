# Wix Members — ready-made custom-login client

The members client is **shipped as real files**, not snippets to regenerate. It's a complete
**custom login** — email+password sign-up/sign-in, "Continue with Google/Facebook" (and custom SSO),
a member session, an account area, and route gating — styled with your app's design tokens (base44's
`src/index.css` — the shadcn palette the design phase already set). Copy it into the app and wire the
routes — you generate almost none of the auth code (the OAuth state machine, PKCE, the hidden-iframe
token exchange, and the social `/callback` all ship and are correct).

**Custom login only.** The member types credentials in **your own form on your own page** (or clicks
your own social button) — they are **never redirected to a Wix-hosted login page**. Talks to Wix
directly over the public `WIX_CLIENT_ID`; login swaps the token set on the one shared client, so
**every later `wixApiRequest` runs as the member** (their cart, orders, plans, "my …" reads). Never
mock a logged-in member; never mint a second client after login.

## Prerequisites
- The site's **Wix OAuth app** (headless) is the auth target — members **self-register**, so there is
  **nothing to seed** (see **Seeding** below); the client renders the shipped logged-out state until a
  member signs in.
- The **Members Area app** installed *only if* you need member **profile** data (name, photo, roles,
  custom fields). Pure "logged-in vs. not" gating needs no app — see **Identity vs. profile** below.
- The public headless **`WIX_CLIENT_ID`** from your prompt (buyer-facing, safe to hardcode/commit).
- **OAuth-app allow-listing — the #1 gotcha, a manual owner-only step you can't do from client code.**
  Two *different* fields gate the two mechanisms:

  | Mechanism | What must be allow-listed | OAuth-app field | On `localhost:4321`? |
  | :-- | :-- | :-- | :-- |
  | **credential** (your form) | your app **origin** (the hidden iframe `postMessage`s the code back) | `allowedRedirectDomains` | ✅ allowed by default |
  | **social / SSO** | the **exact `/callback` URL** (full-page redirect target) | `allowedRedirectUris` | ❌ **must be added** |

  `localhost:4321` is Wix's default-allowed dev **origin**, so **credential login works there with zero
  setup**; social **still fails** until you add `http://localhost:4321/callback` to `allowedRedirectUris`.
  Any non-default origin (deployed domain, other port) needs both the origin and `<origin>/callback`.
  **Symptoms:** unregistered origin → credential login hangs then throws `MemberAuthError('timeout')`
  (+ a console *"postMessage… target origin does not match"*); unregistered callback → the Wix
  authorize page shows *"Invalid redirect URI"* before returning, so the client can't catch it.

  > **⚠️ AGENT: surface this proactively.** As soon as a run uses social/SSO (or deploys credential
  > login to a non-`4321` origin), **tell the user the exact URIs to add and where** (deep link under
  > **Point the user to their dashboard**), and note that **social login stays dead until they do it**.

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole members UI client + REST scaffolds into
`src/` (imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your map,
so you don't need to open them:**

| file | what it is |
|---|---|
| `context/MemberContext.jsx` | `useMember()` provider: current member, `loggedIn`, `refresh()`, `logout()` |
| `hooks/useLoginForm.js` | credential state machine (login/register/verify, error mapping) — logic only |
| `components/LoginForm.jsx` | email+password form UI (sign-in/sign-up tabs, verify-code + pending phases) |
| `components/SocialButtons.jsx` | "Continue with Google/Facebook" buttons (kick off the redirect) |
| `components/MemberMenu.jsx` | header account control — "Log in" vs. member name + log-out (like a cart button) |
| `components/RequireAuth.jsx` | route gate: renders children for a member, else redirects to `/login` |
| `components/WixManageBanner.jsx` | dev-only manage banner — drop it into your Layout (STEP 4) |
| `pages/Login.jsx`, `pages/Account.jsx` | the shipped login + account routes (`/login`, `/account`) |
| `pages/Callback.jsx` | social/SSO return route — mount at **exactly** `/callback` |
| `rest/wix-config.js` | **you set the ids here** (STEP 2) |
| `rest/wix-client.js` + `rest/wix-members-auth.js` | REST transport + the auth helper (copy verbatim) |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table says what each is and
every shape you need is in the snippets below. Read a shipped file's source **only** on a real
fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the end).
(Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/members/app/` → `src/`.)

> **⚠️ Copy `wix-members-auth.js` verbatim — do NOT rewrite its internals.** The OAuth wire shapes are
> exact and unforgiving: the `createRedirectSession` body needs the `auth.authRequest` wrapper, flat
> PKCE fields, and `responseType`/`scope` — "simplifying" it returns **400** and login dies. Extend by
> *calling* the exports, never by editing them. Its full JSDoc (state machine, `profile`, errors) is at
> the top of the file — read that, not the whole body, if you need the contract.

## STEP 2 — Credentials
Write `src/rest/wix-config.js` with your `WIX_CLIENT_ID` and `WIX_METASITE_ID` from the prompt — the
one place both ids live.

## STEP 3 — Theme (nothing to style on the shipped components)
The shipped components carry **no palette of their own** — they render from base44's design tokens
in `src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`, `--muted`,
`--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`, `text-foreground`,
`bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`, `font-display`). Those tokens
are **already set to the brand by the design phase**, so the shipped auth surfaces are themed with
zero work here. To adjust the palette, edit `index.css` (`:root` **and** `.dark`) — the base44 way;
**never add a parallel theme file (e.g. a `theme.css`) or restyle the shipped JSX.** Build the
Home/Header you add (STEP 4) from the **same** base44 tokens/classes so it matches automatically. A
dark brand is just base44's dark palette in `index.css` — no per-component work.

## STEP 4 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`, the **Base44 builder
account**) — edit it in, don't replace it. The Wix member session is separate and ships under its own
name, **`MemberProvider`/`useMember`**, so the two never collide (do NOT rename it to `useAuth`).
- Wrap the routed tree in `<MemberProvider>` (from `@/context/MemberContext`).
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Login`/`Account`/`Callback` — so you **never edit the shipped pages to add
  a header/footer** (they render inside `<Outlet/>` as-is).
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, dev-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's measured height so it clears the chrome and self-corrects when the
  banner is dismissed.
- Routes under the Layout: `/login` → `Login`, `/callback` → `Callback` (both shipped, as-is), and
  `/account` → `Account` **wrapped in `<RequireAuth>`** so a visitor is bounced to `/login`. **You add
  `/` → your own Home** page. Gate your own member-only routes ("my orders", "my plans") the same way.

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { MemberProvider } from "@/context/MemberContext";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, dev-only · default export, no props
import RequireAuth from "@/components/RequireAuth";           // shipped route gate
import Login from "@/pages/Login";                     // shipped · default export, no props
import Account from "@/pages/Account";                 // shipped · default export, no props
import Callback from "@/pages/Callback";               // shipped · default export, no props
import Home from "@/pages/Home";       // YOU build
import Header from "@/components/Header";   // YOU build — plain in-flow markup, NOT position:fixed
import Footer from "@/components/Footer";   // YOU build

function Layout() {
  const topRef = useRef(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {                                  // measure the fixed region → pad content below it
    const ro = new ResizeObserver(() => setOffset(topRef.current?.offsetHeight ?? 0));
    if (topRef.current) ro.observe(topRef.current);
    return () => ro.disconnect();
  }, []);
  return (<>
    <div ref={topRef} style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50 }}>
      <WixManageBanner />                    {/* null in prod / when dismissed */}
      <Header />                             {/* your brand header, in-flow inside this fixed block */}
    </div>
    <div style={{ paddingTop: offset }}>     {/* clears the chrome; shrinks when the banner is dismissed */}
      <Outlet />                             {/* shipped Login/Account/Callback render here, untouched */}
      <Footer />
    </div>
  </>);
}

<MemberProvider>
  <Routes>
    <Route element={<Layout />}>                                          {/* chrome wraps all */}
      <Route path="/" element={<Home />} />                               {/* yours */}
      <Route path="/login" element={<Login />} />                         {/* shipped, as-is */}
      <Route path="/callback" element={<Callback />} />                   {/* shipped — must be /callback */}
      <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />  {/* gated, shipped */}
    </Route>
  </Routes>
</MemberProvider>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** (mount `<MemberMenu/>` in it) and a **`Footer`** — the
two you drop into the `Layout` (STEP 4) so they wrap every route — plus the overall brand story,
styled from the same base44 tokens/classes. The nav's account control is a `<MemberMenu/>` (shows
"Log in" for a visitor, the member's name + log-out once signed in — render it as-is, don't wrap it in
your own auth text button):

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import MemberMenu from "@/components/MemberMenu";

// Responsive header: choose ONE branch with a state flag, so <MemberMenu/> mounts once.
// Do NOT render a desktop nav AND a mobile nav toggled by `hidden md:flex` / `md:hidden`:
// these navs are inline-styled, and an inline `display` beats a Tailwind class, so `hidden`
// never applies — BOTH branches render and you get two menus. One branch = one menu.
export function Header() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);            // keep it reactive to viewport changes
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {/* brand/logo */}
      {mobile
        ? <YourMenu />                                       // your hamburger + <MemberMenu/> here
        : <div style={{ display: "flex", gap: 24 }}><Link to="/">Home</Link><MemberMenu /></div>}
    </nav>
  );
}
```
Everything visual reads base44's design tokens (`index.css`), so your home/nav match the shipped pages automatically.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev preview
can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a fresh
full navigate/reload of the preview and re-check — don't keep rewriting correct code against a stale
render.

## Using the client from your own UI (session, gating, "my …" reads)

```jsx
import { useMember } from "@/context/MemberContext";

// useMember() gives:
// { member, loggedIn, loading, refresh(), logout(returnTo?) }
// - member is null for a visitor OR when the Members Area app isn't installed (loggedIn still true).
// - login/register happen in the shipped LoginForm; call refresh() after your own login call.

function Greeting() {
  const { loggedIn, member, loading } = useMember();
  if (loading) return null;
  return loggedIn ? <span>Hi, {member?.profile?.nickname || "member"}</span> : <a href="/login">Log in</a>;
}

// A member-only read runs as the member on the SAME shared client — no extra auth, no `elevate`:
import { wixApiRequest } from "@/rest/wix-client";
const { orders } = await wixApiRequest("/ecom/v1/orders/query", { body: { query: {} } }); // member's own
```

## Extending the client — the auth helper's exports (copy as-is, do NOT re-derive)
Building auth UI beyond the shipped pages? Call these exports (from `@/rest/wix-members-auth`) — the
same ones the shipped hook/pages use:

```js
// (A) Credential — handle EVERY branch, not just SUCCESS. register/login/verifyEmail → { state, ... }:
import { login, register, verifyEmail, MemberAuthError } from "@/rest/wix-members-auth";
try {
  const res = await login(email, password);
  if (res.state === "SUCCESS") { /* logged in; res.member (or null w/o Members Area app) */ }
  else if (res.state === "REQUIRE_EMAIL_VERIFICATION") { /* 6-digit code emailed; verifyEmail(code, res.stateToken) */ }
  else if (res.state === "REQUIRE_OWNER_APPROVAL") { /* show a pending notice — not an error */ }
} catch (e) {
  if (e instanceof MemberAuthError) show(e.message); else throw e;   // .code: invalidCredentials, emailAlreadyExists, …
}
// Custom sign-up fields → register's 3rd arg `profile` ({ firstName, lastName, nickname, addresses, … }).
// Arbitrary customFields keys must be defined in the Members Area app first, or they're silently dropped.

// (B) Social / SSO — button + the shipped /callback page:
import { startSocialLogin, IDP } from "@/rest/wix-members-auth";
const callbackUri = new URL("/callback", window.location.origin).href;   // must be allow-listed
startSocialLogin(IDP.GOOGLE, callbackUri, window.location.pathname);      // custom SSO: pass a connectionId as idp
```

## Identity vs. profile — don't conflate them
- **Identity / auth** — sign up, log in, log out, "is this caller a member?". Native to the headless
  OAuth app. **No app install needed** — every login mechanism here runs on this layer alone.
- **Member profile / Members Area** — name / photo / roles, an account page, custom-field definitions.
  Served by the **Members Area app**, which must be installed. If `getCurrentMember()`/`useMember().member`
  is `null` while `loggedIn` is `true`, suspect the app isn't installed — **not a code bug**.

Fallback only — when you hit an error or need something not shown here (password reset, custom SSO
connection ids, a profile field these snippets don't have): read the relevant shipped file under
`src/rest/`, or look it up via the **`wix-docs`** skill.

## Hard rules
- Set `WIX_CLIENT_ID` (STEP 2) — not the placeholder.
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file.
- **Custom login only** — the member logs in on **your** UI; never redirect them to a Wix-hosted login page.
- **One shared client** — login swaps the token set on `wix-client.js`; reuse it for everything so the
  member identity carries across the app. Never mint a second client or re-mint anonymously after login.
- Copy `wix-members-auth.js` verbatim; extend by *calling* its exports, never by editing them.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 4) — never edit the shipped `Login`/`Account`/`Callback` to add chrome; the fixed top region owns positioning (`<WixManageBanner/>` above a plain in-flow `<Header/>`).
- **Never fake a member** — no mock logged-in state, invented profile, or roles. Render the real member or the real logged-out state.
- **Fail loudly** — the helper throws `MemberAuthError`; surface `.message`, don't swallow it.
- No `elevate` / admin scope, and no headless MFA/TOTP — those security layers are dashboard-governed.

## Point the user to their dashboard
Some setup only happens in the Wix dashboard — always give the user the deep links (substitute the
site's `metaSiteId` from the handoff / `ListWixSites`):
- **Allowed authorization redirect URIs** (the #1 gotcha) — `https://manage.wix.com/dashboard/{metaSiteId}/oauth-apps-settings`.
  Add the **app origin** (for credential login off `localhost:4321`) and the **exact `/callback` URL**
  (for social/SSO) — character-for-character matching your `startSocialLogin` `callbackUri`.
- **Members Area app** (profile data + custom fields) — `https://manage.wix.com/dashboard/{metaSiteId}/member-permissions`
- **Signup security** (email verification, owner approval, reCAPTCHA) — `Dashboard → Settings → Login & Security`
- **Custom SSO connection** (to obtain a `connectionId`) — the project's IAM / SSO settings in the Business Manager.

## Seeding
**Nothing to seed** — members self-register; there is no build-time member to create. See
`seed/SEED.md` (separate from this client build; the members work is entirely frontend wiring).

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] Brand palette lives in `index.css` (`:root`/`.dark`); no parallel theme file; shipped components/pages not restyled or rewritten.
- [ ] Opened the vertical's data route(s) (not just the home page) — `/login` and `/account` — and confirmed the shipped components render themed (surface, text, brand) with images.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all routes; shipped `Login`/`Account`/`Callback` untouched; content clears the fixed chrome; `<MemberProvider>` wraps the tree; `<MemberMenu/>` in the header.
- [ ] Sign-up: `register()` reaches `SUCCESS` (or `REQUIRE_EMAIL_VERIFICATION` handled via the code entry).
- [ ] Log-in: `login()` reaches `SUCCESS`; wrong password shows `invalidCredentials`, not a crash.
- [ ] After login `useMember().loggedIn` is `true`; `/account` renders the member (or the identity-only fallback with the Members Area app not installed — documented, not a bug). `/account` bounces a visitor to `/login`.
- [ ] Session survives reload (same client); logout clears it and the next load is a clean anonymous visitor.
- [ ] Social: the button redirects to the provider and `/callback` logs the member in (callback URL allow-listed), or is flagged as pending host setup.
- [ ] No mocked member state, profile, or roles anywhere.
- [ ] Told the user about any required dashboard setup (allowed redirect URIs, Members Area app) with deep links.
