---
name: "How to Code Members (Astro)"
description: The frontend contract for member sign-up / log-in / log-out and member-gated surfaces on a Wix-managed **Astro** frontend — the built-in `/api/auth/login` + `/api/auth/logout` routes that `@wix/astro` ships, the `returnUrl` param, gating a page by resolving the member in SSR / a backend route, reading the current member with `@wix/members` `getCurrentMember`, and the two rules that keep this path from breaking: **no `OAuthStrategy`/no client** (that 500s under auto-auth) and **no `auth.elevate`** for a member reading their own data. Specifies the *how* for the Astro axis only — read `how-to-code-members-non-astro.md` for any non-Astro frontend.
---
**RECIPE**: How to Code Member Auth on a Wix-managed **Astro** Frontend (built-in `/api/auth/*`, `@wix/members`)

A concise contract for wiring **login / sign-up / logout and member-gated surfaces** into an Astro frontend. **This is the *how* (which routes, which module, which failure modes), not the *what*** — which pages are gated, what the account page shows, and the design come from the request you're fulfilling.

> **⚠️ AXIS GUARD — this recipe is for Astro only.** On managed-Astro authentication is ambient and login ships as built-in routes. If the frontend is **not** Astro (Vite/React/Vue SPA, static HTML, self-managed), **stop and read `how-to-code-members-non-astro.md`** — that path builds a manual `OAuthStrategy` handshake, which is the opposite of what this recipe says. Cross-contaminating them is a real failure: building an `OAuthStrategy` client on Astro **500s at SSR** (`astro.md` — "no client" is the whole point of the integration).

> **One mechanism, not three.** Sign-up, log-in and log-out are the *same* flow. The Wix login page **logs in an existing member or registers a new one** in the same step; you never build a separate "sign up" call. Log-out is the inverse of the same flow.

> **Login surface — this recipe is the Wix-hosted login page (the default).** If the brief **explicitly** asks for a **custom/branded in-app login form or custom sign-up fields** (full name / username / address / arbitrary fields), that's the *custom login page* surface — **read `how-to-code-members-custom-login.md`**. Note custom login is a client-driven `OAuthStrategy` flow with **no client** under Astro auto-auth, so on Astro it means instantiating an explicit `OAuthStrategy` client in a backend route or a client island (never in SSR frontmatter) — take it on only on real intent; otherwise the built-in routes below are the default. The choice is **intent, not project type**.

Pinned docs (read before wiring — `curl` the `.md` directly):
- Member login on Astro: <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/handle-member-login-using-wix-s-astro-integration.md>
- The integration keystone (auto-auth, "no client"): <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/about-the-astro-integration.md>
- Current member (SDK): <https://dev.wix.com/docs/sdk/frontend-modules/members/current-member/introduction> (open with `?apiView=SDK`)

---

## Identity vs. profile — two layers, don't conflate them (read this first)

The docs draw a hard line, and so must the code:

- **Identity / auth** — *"is this caller a logged-in member?"*, log in, log out. Native to the headless OAuth app. **No app install needed.** Everything in "Log in / sign up / log out" and "Gate a surface" below runs on this layer alone.
- **Member profile / Members Area** — reading the member's name / photo / roles / badges, an editable my-account page. Served by the **Wix Members Area app**, which **must be installed** on the site (see `SETUP.md`). `@wix/members` `getCurrentMember()` returns member data only once that app is present.

So a paywall that only needs "logged-in vs not" runs on identity alone; anything that **displays or edits member data** needs the Members Area app installed. If `getCurrentMember()` returns empty/errors on a site where login clearly worked, suspect the **Members Area app isn't installed** — not a code bug.

---

## Log in / sign up / log out — built-in routes, zero wiring

`@wix/astro` ships the endpoints; you only render links/actions. **Do not build a login page or an OAuth handshake** — that's the non-Astro path.

```astro
<!-- log in OR sign up — same route, redirects to the Wix login page -->
<a href="/api/auth/login">Log in / Sign up</a>

<!-- land the member somewhere specific afterward -->
<a href="/api/auth/login?returnUrl=/account">Log in</a>
```

Logout is a **POST** to `/api/auth/logout` (optionally with `?returnUrl=`):

```astro
<form method="POST" action="/api/auth/logout"><button>Log out</button></form>
```

- **`returnUrl` must be an allowed redirect URI.** When the project is created with that URL it's auto-added; an un-allow-listed `returnUrl` fails the redirect. Default to a relative path already known-good (the login page auto-allows the project's own origin paths).
- After login the member identity **rides on every subsequent SDK call automatically** — no client, no token handling. That's auto-auth (`astro.md`).

---

## Gate a surface — resolve identity in SSR or a backend route

Gating is just *"do I have a member session?"*, decided **server-side** (SSR frontmatter or a `src/pages/api/*.ts` route), then bounce anonymous visitors to the built-in login route. This is the exact shape already used for blog comments (`SDK_HANDOFF.md` §5).

```astro
---
// src/pages/account.astro — gate the page in SSR frontmatter
import { members } from '@wix/members';
let me = null;
try {
  const res = await members.getCurrentMember({ fieldsets: ['FULL'] });
  me = res.member ?? null;
} catch { /* not a member / not installed — treat as anonymous */ }

if (!me) return Astro.redirect('/api/auth/login?returnUrl=/account');
---
<h1>Welcome, {me.profile?.nickname ?? me.loginEmail}</h1>
```

- **Guard the SSR call in `try/catch`** — an unguarded throw truncates the response mid-stream (white screen; `astro.md` A3). An anonymous visitor is a normal state, not an error: catch → treat as logged-out → redirect to login.
- **Don't render account/gated UI as a client island that checks auth in the browser.** Resolve identity server-side and gate the route; render only what a member should see. (Same reasoning as the blog-comment API-endpoint path — avoid the browser-auth detour.)
- For an **action** that only *some* callers may take (post a comment, place a member order), don't gate the whole page: render the control always, and on submit POST to a `src/pages/api/*.ts` endpoint that resolves the session and, if the caller isn't a member, redirects to `/api/auth/login?returnUrl=…`.

---

## Read the current member — `@wix/members`, not the dev-preview package

```astro
import { members } from '@wix/members';
const { member } = await members.getCurrentMember({ fieldsets: ['FULL'] });
// member.profile?.nickname, member.profile?.photo, member.loginEmail, member.contactId, member.roles
```

- **⚠️ The SDK export is `getCurrentMember`, NOT `getMyMember`.** The REST method is named *Get My Member* and the SDK docs page may show `GetMyMember`, but `@wix/members` exports it as **`members.getCurrentMember`** — calling `members.getMyMember(...)` throws `is not a function` at runtime. This bites because a logged-out smoke test never reaches the call; it only fails once a real member loads the page.
- **⚠️ Use `@wix/members` (`members.getCurrentMember` / `getMember` / `updateMember`).** It needs only **visitor/member auth** and is production-ready. **Do NOT reach for `@wix/site-members`** (`wixSiteMembers`, frontend "Current Member" `getMember`/`getRoles`/`makeProfilePublic`) — it's in **Developer Preview** ("not intended for production"). Use it only if a profile-privacy toggle is *specifically* requested.
- The member's **photo** field is a `wix:image://` identifier — resolve it with `media.getScaledToFillImageUrl` like any other Wix image (`astro.md` A6); never hand-build the CDN URL.
- **Reading another member by id returns only their PUBLIC fieldset**, and a **private** profile returns nothing to a visitor/member identity. This is why the blog-comment author lookup (`SDK_HANDOFF.md` §5) quietly assumes the author's profile is public — the same caveat applies to any "look up a member by id" here.

---

## ⚠️ Do NOT `auth.elevate()` for member features (the most likely wrong turn)

Member login and elevation are **different axes**:

- **Login** moves you along the **identity** axis: anonymous visitor → a specific member.
- **`auth.elevate()`** moves you along the **permission** axis: caller → *app/admin* scope.

A logged-in member reading **their own** data — own orders, own bookings, own subscriptions, plan-gated content, their profile — is authorized for it under the **member token, with no elevation**. Reaching for `auth.elevate()` to "make member data work" is the classic mistake: it's the wrong axis, and it doesn't grant a member access to their own data (they already have it).

`auth.elevate()` is only for **site-wide/admin** reads (everyone's orders, listing all members). On Astro that goes in a **backend route** (`src/pages/api/*.ts` wrapping `auth.elevate()`, `astro.md` §2) — never inline in a page. If you're gating content by the member's own plan, that's a member-token read; listing *all* plans/orders as admin is the elevate read. Keep them separate.

---

## pricing-plans is a HARD dependency on members

If the site has pricing-plans (membership / subscription / paid tiers), **login is required, not optional**. Ordering a plan (`orders.createOnlineOrder(planId)`) orders it **for a logged-in member**; if none is logged in the Wix flow forces sign-up. `orders.memberListOrders()` and "my subscription" reads return **nothing** for an anonymous visitor.

So: browsing the plans grid is public, but the **subscribe** button and the **my-subscription** surface both need the login mechanism above. A logged-in member calling `orders.createOnlineOrder` needs **no `onBehalf`** — the order is created on their behalf from the member session. (Everywhere else — stores "my orders", bookings "my bookings", events "my registrations" — member login is a *soft* add-on: the purchase/RSVP/book action itself runs fine as an anonymous visitor; only the account view of it needs a member.)

---

## Conclusion
Correct member auth on an Astro frontend:
- uses the **built-in `/api/auth/login`** (login *and* sign-up) and **POST `/api/auth/logout`** routes with an allow-listed `returnUrl` — the login handshake **never** builds an `OAuthStrategy` client, and one must never be built in **SSR frontmatter** (the public-env `clientId` is `undefined` at server render → 500). (The one exception is the custom-login surface — `how-to-code-members-custom-login.md` — which builds an explicit client in a backend route or client island, never in SSR frontmatter.)
- gates surfaces **server-side** (SSR frontmatter or a `src/pages/api/*.ts` route), guarded in `try/catch`, bouncing anonymous visitors to `/api/auth/login?returnUrl=…`;
- reads the current member via **`@wix/members` `getCurrentMember`** (not the dev-preview `@wix/site-members`), resolving the photo `wix:image://` URI and expecting only PUBLIC fields for other members;
- does **no `auth.elevate`** for a member reading their own data (elevation is a different, admin-only axis that lives in a backend route);
- treats **login as required** whenever pricing-plans is present (subscribe + my-subscription), and as a soft add-on for the "my …" surfaces of the other verticals;
- needs the **Wix Members Area app installed** only for profile *data* (name/photo/roles) — pure "logged-in vs not" gating runs on the identity layer with no install.
