# Members — playbook

The member-auth machinery ships as files — the Wix-hosted login/sign-up flow (one flow, not
three: the login page registers a new member or logs in an existing one), logout, the shared
session store, and the current-member read, typed end-to-end and working identically on both
stacks. **The presentation is yours**: you design the header account control's placement, the
account surface, and which pages/actions are member-gated. You never write auth logic.

**Scope — the Wix-hosted login page only.** A custom/branded in-app login form, custom
sign-up fields, and social login buttons are OUT OF SCOPE for this vertical — if the brief
explicitly asks for them, route to the `wix-headless` skill
(`references/inline-recipes/how-to-code-members-custom-login.md`); don't improvise them here.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source only on a real fallback (runtime error / uncovered field),
or to read a reference component's pattern.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/members/types.ts` | the DTO (`CurrentMember`) — contract below |
| `wix/members/members.ts` | `fetchCurrentMember` — null for anonymous, never throws |
| `wix/members/auth.ts` | login/logout, both stacks — `startLogin`, `logoutMember`, `completeLogin`, `CALLBACK_PATH` |
| `wix/members/member-store.ts` | shared session state (module store — spans Astro islands) |
| `hooks/members/useMember.ts` | the session hook — contract below |
| `components/members/MemberMenu.tsx` · `AccountView.tsx` · `RequireAuth.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `components/members/LoginCallback.tsx` | react-stack `/callback` handler — mount as-is, don't redesign |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot, the global.css import, and a `<MemberMenu client:only="react">` in the header). If another vertical is also deployed, its layout won — mount MemberMenu there |
| `pages/account.astro` | the SSR-gated account page — **keep the frontmatter** (the gate), swap the island import to YOUR account component |

## What you build — the design job

1. **The header account control** — where the login/account affordance lives in your chrome,
   on `useMember` (or mount the shipped `MemberMenu` and restyle your own later).
2. **The account surface** — the member's identity presented in the brand (photo, name,
   email, member-since; the log-out affordance) — on `useMember`.
3. **The gated surfaces** — which pages or actions are members-only comes from the brief:
   Astro pages gate in SSR frontmatter (copy `account.astro`'s shape); react routes wrap in
   `RequireAuth`.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens.

### The contracts your components consume

```ts
// CurrentMember — display-ready:
// { id, loginEmail, displayName /* nickname → first+last → email local part */,
//   firstName, lastName, nickname, photoUrl /* https or "" */, contactId,
//   memberSince /* "YYYY-MM-DD" | "" */ }

// useMember({ initialMember? /* SSR-resolved member; omit to resolve client-side */ }) →
// { member: CurrentMember | null,   // null for a visitor — AND for a logged-in member
//                                   // when the Members Area app is absent (setup, not a bug)
//   loggedIn,                       // the gate signal
//   loading,                        // true until the first session read — skeletons, not logged-out UI
//   error,                          // last failed operation's message — render it
//   login(returnTo?),               // → Wix login page (login AND sign-up); navigates away
//   logout(returnTo?),              // → Wix logout flow; navigates away
//   refresh() }

// RequireAuth: { children, fallback? /* replaces the default login prompt */ }
// MemberMenu:  { accountHref? = "/account", LinkComponent? }
// AccountView: { initialMember? }
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — or mount
   `<MemberMenu client:only="react">` in the winning vertical's layout when several are
   deployed).
2. Write your account component under `src/components/members/` (a new name — don't
   overwrite the reference), swap the island import in `pages/account.astro` — **keep its
   frontmatter exactly**: the server-side gate and the `returnToUrl` param are the mechanism.
   Gate any other members-only page the same way. **Author your surfaces in as few messages
   as possible** — batch multiple Writes per message.
3. Login/logout need **zero routes from you** — `@wix/astro` ships `/api/auth/login` and
   `/api/auth/logout`; the shipped code already targets them.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/account` → your account surface wrapped in
`<RequireAuth>`; **`/callback` → the shipped `LoginCallback`, mounted at exactly that path**
(it finishes the login handshake). Gate any members-only route with `RequireAuth`.

**Post-release, once (owner-visible step — surface it, don't skip it):** the login callback
`<deployed-origin>/callback` must be added to the OAuth app's **`allowedRedirectUris`**
(exact match). `wix release` auto-registers the *origin* but not this *callback* — until it's
added, login dies at the redirect. Also: **the site must be published** before login works at
all. Setting: `https://manage.wix.com/dashboard/<siteId>/oauth-apps-settings`.

## Hard rules

- **Auth only through the shipped exports** — `useMember` / `auth.ts` own the flow (routes,
  handshake, token persistence, `returnToUrl`). Never build a login form, an OAuth handshake,
  or a logout URL by hand; never instantiate an `OAuthStrategy` client yourself (on the Astro
  stack that 500s at SSR).
- **The return param is `returnToUrl`** on the built-in routes — `returnUrl` is silently
  dropped and the member lands on `/`. The shipped code gets it right; keep it right in any
  frontmatter you write.
- **Gate server-side on Astro** (SSR frontmatter, like `account.astro`), client-side with
  `RequireAuth` only on the react stack.
- **Never fake a member** — no mock logged-in state, invented profile, or roles. Render the
  real member or the real logged-out state; gate on `loggedIn`, skeleton on `loading`.
- **No `auth.elevate()` for member features.** Login is the identity axis; elevation is the
  admin axis. A member reading their own data is already authorized under the member token.
- **Identity vs. profile:** login/gating need no app install; *displaying* member data needs
  the **Wix Members Area app** (the seed installs it). `member` null while `loggedIn` is true
  → the app is missing, not a code bug. The Astro `account.astro` gate additionally NEEDS the
  app (a logged-in member reads null without it and loops through login).
- Theme via the `@theme` tokens; no parallel theme files, no hardcoded palettes.
- Custom login forms and social buttons are out of scope (see Scope above) — don't add them
  unprompted.

## Point the user to their dashboard

Give the owner the dashboard link (`https://manage.wix.com/dashboard/<siteId>`), plus:
- **Members / permissions** (profile data, roles): `…/member-permissions`
- **Signup security** (email verification, owner approval, reCAPTCHA — dashboard-governed,
  never code): Dashboard → Settings → Login & Security
- React stack only: **oauth-apps-settings** for the `allowedRedirectUris` step above.

## Seeding

Per `seed/SEED.md` — members self-register, so the seed creates no members; it installs the
Wix Members Area app (profile data for the account page). Run it before verifying `/account`.

## Verify (before declaring done)

- [ ] Header shows the account control: "Log in" for a visitor, the member's name after login.
- [ ] Clicking log in lands on the Wix login page and back on the page the visitor started
      from (the `returnToUrl` round-trip).
- [ ] `/account` (or your gated route) bounces a visitor to login, and renders the REAL
      member — name/email/photo — after login.
- [ ] Log out returns a clean anonymous visitor; the session survives a reload while logged in.
- [ ] React stack: `/callback` mounts `LoginCallback`; the `allowedRedirectUris` step is done
      (or handed to the owner with the exact URI).
- [ ] Account/header surfaces are YOUR designs on the tokens; the wix/members + hook files
      are unedited.
- [ ] No mocked member state anywhere; seed result JSON shows the Members Area install.
- [ ] Dashboard links handed to the owner.
