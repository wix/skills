# Members — playbook

The account machinery ships as files — the custom credential login (sign in, sign up, email
verification, owner approval, logout), the session store, the current-member read, typed
end-to-end. Members sign up and sign in **on your site**, never on a Wix-hosted login page: the
shipped client exchanges a credential login into member tokens, and on managed Astro writes them
into the `wixSession` cookie so the next server render and every island run as that member.
**The presentation doesn't ship — you build it** on the shipped hook/DTOs: the login page around
the shipped form, the account page, the header control, and whatever the brief gates behind a
login. You never write auth code; you never skip designing the surfaces.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro` and `styles/global.css`.
Files you **create**: your home page, any gated page the brief asks for, and your own account
surface if the reference one doesn't fit the brand.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it, `WIX_MEMBERS_CLIENT_ID` included — nothing to set by hand) |
| `wix/media.ts` | `imgAttrs(url, sizes)` / `imgSrc()` — the member photo is already an https URL in the DTO |
| `wix/members/types.ts` | the DTO (`CurrentMember`) — contract inlined below |
| `wix/members/client.ts` | the one explicit `OAuthStrategy` client the credential flow needs; on Astro it stores member tokens in the `wixSession` cookie so ambient SDK calls run as the member |
| `wix/members/auth.ts` | `loginMember`, `registerMember`, `verifyMemberEmail`, `logoutMember`, `loggedInHint` — the transport; what a response means (the four states, the error-code names) is in `auth-core.ts` beside it (shared with the REST layer) |
| `wix/members/members.ts` | `fetchCurrentMember` — the transport; the DTO mapper is in `members-core.ts` beside it (shared with the REST layer) |
| `wix/members/member-store.ts` | the session state machine, framework-free: one per visitor (a module singleton — it spans Astro islands, which a React context can't); `getMemberState`/`subscribeMember`, `login`, `register`, `verifyEmail`, `logout`, `refreshMember`, `hydrateMember`; the hook below binds it to React, every other stack uses it directly |
| `hooks/members/useMember.ts` | React binding of `member-store.ts`: session state + the credential actions — contract below |
| `components/members/LoginForm.tsx` | the credential form — sign in / sign up toggle, the verification-code step, the pending-approval notice, the inline error, `returnTo` — **wire as-is** on your login page |
| `components/members/MemberMenu.tsx` | header control reference on the tokens: skeleton while loading, "Log in" for a visitor, name/avatar + "Log out" for a member — wire as-is or design your own on `useMember` |
| `components/members/RequireAuth.tsx` | the gate for member-only surfaces: waits for the first session read, then children for a member, a login prompt with `returnTo` for a visitor — **wire as-is** around gated content |
| `components/members/AccountView.tsx` | account surface reference: profile card + log out; design your own on `useMember` when the brand asks |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — same token family as the official Wix templates). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | the site chrome — **yours to brand**: header, footer, nav. Keep the `<slot name="seo-tags" />`, the global.css import, and one `<MemberMenu client:only="react" />` in the header (if another vertical's layout won, mount `MemberMenu` in that header instead) |
| `pages/login.astro` · `pages/account.astro` | the login and account routes — thin shells mounting `LoginForm` and `RequireAuth` + `AccountView` `client:only="react"`; brand the chrome around them, keep the mounts |

## What you build — this is the design job, not optional polish

You implement the surfaces yourself, styled with Tailwind utilities on the `@theme` tokens,
designed to fit the brief (a members-only club and a course platform should not get the same
account area):

1. **The login page** — the chrome around the shipped `LoginForm` (`pages/login.astro`): heading,
   what membership gives, the brand. The form's four states already render; you own the page.
2. **The account page** — `pages/account.astro` mounts `RequireAuth` around `AccountView`; keep the
   gate, and replace `AccountView` with your own surface on `useMember` when the brief wants more
   than the profile card (orders, bookings, saved items — each from its own vertical's data layer).
3. **The header control** — the shipped `MemberMenu` or your own on `useMember`: it is the one
   surface every page shows, so it carries the brand.
4. **Gated content** the brief asks for — a page inside `RequireAuth`, or a member-only section on a
   public page rendered from `loggedIn`.
5. **The home page** — on `SiteLayout`, with the way in (log in / join) visible.

Plus the **theme** (edit the `@theme` block in `styles/global.css` — one edit) and the **chrome**
(header/footer in `SiteLayout.astro`, one edit pass).

### What a complete members site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins when it asks for something
else. Then, by default:

- **Header:** a skeleton while the session read settles, "Log in" for a visitor, the member's
  name or avatar plus "Log out" for a member — never a flash of "Log in" for someone who is in.
- **Login page:** sign in and sign up on one page; email verification and owner approval rendered
  as states (a code field, a "pending approval" notice), a failed login as an inline message next
  to the form; `?returnTo=` honoured after success (the shipped form does all of this).
- **Account page:** gated — a visitor sees the login prompt in place, a member their real profile
  (`displayName`, `loginEmail`, `memberSince`, photo when there is one); a logged-in member with
  `member === null` gets the one honest line ("profile details unavailable") — the Members Area app
  isn't installed, which the seed does.
- **Logout:** returns to the page that offered it, or the home page.
- **Copy:** nothing the owner didn't supply — no invented perks, member counts, or testimonials;
  no Wix IDs or technical words in visible text.

### The contracts your components consume (everything you need — don't read the source)

```ts
// CurrentMember — display-ready:
// { id, loginEmail /* "" when hidden */, displayName /* nickname → "first last" → email local part → "Member" */,
//   firstName, lastName, nickname, photoUrl /* https or "" */, contactId /* the key for member-owned content */,
//   memberSince /* "YYYY-MM-DD" or "" */ }

// useMember({ initialMember? /* SSR-resolved member or null; omit to resolve client-side */ }) →
// { member: CurrentMember|null, loggedIn, loading /* true until the first session read settles — skeletons, not the logged-out state */,
//   error /* last failed operation's message; a new operation clears it */,
//   login(email, password), register(email, password, { firstName?, lastName? }?), verifyEmail(code),
//   logout(returnTo?) /* navigates away */, refresh() }
// loggedIn can be true with member === null: the caller is a member but the site has no Members Area app (profile layer).
// Several islands on one page share one session — the store is a module singleton.

// login / register / verifyEmail resolve to LoginResult:
// { state: "SUCCESS" | "EMAIL_VERIFICATION_REQUIRED" | "OWNER_APPROVAL_REQUIRED" | "FAILURE",
//   errorCode? /* invalidPassword | invalidEmail | emailAlreadyExists | resetPassword | missingCaptchaToken | invalidCaptchaToken */,
//   error? /* Wix's message — render it */ }
// SUCCESS has already refreshed the session: member and loggedIn are set when the promise resolves.
// EMAIL_VERIFICATION_REQUIRED → show a code field and call verifyEmail(code); the state token is kept for you.
// OWNER_APPROVAL_REQUIRED → a pending notice; the member logs in once the owner approves (dashboard).
// Which of the three a sign-up ends in is the site's signup policy (dashboard), not your code.
```

### The pages — the shipped shells and a gated page

Hooks first, branches after (an early return above a hook changes hook order between renders and
React throws). Session-reading islands mount `client:only="react"` — they read browser state and
must not server-render; a `client:load` gate would flash the logged-out state.

```astro
---
// src/pages/login.astro — ships; brand the chrome, keep the mount.
import SiteLayout from "../layouts/SiteLayout.astro";
import LoginForm from "../components/members/LoginForm";
---
<SiteLayout title="Log in">
  <section class="mx-auto max-w-md">  {/* one narrow column: the form is the page */}
    <h1 class="mb-6 text-2xl font-semibold">Welcome</h1>
    <LoginForm client:only="react" />
  </section>
</SiteLayout>
```

```astro
---
// src/pages/account.astro — ships; the gate stays, the surface inside is yours to replace.
import SiteLayout from "../layouts/SiteLayout.astro";
import AccountView from "../components/members/AccountView";
import RequireAuth from "../components/members/RequireAuth";
---
<SiteLayout title="My account">
  <h1 class="mb-8 text-2xl font-semibold tracking-tight">My account</h1>
  <RequireAuth client:only="react"><AccountView /></RequireAuth>
</SiteLayout>
```

```tsx
// src/components/members/MembersOnly.tsx — YOU create it when the brief gates content: a view over
// useMember inside RequireAuth. The gate decides; the view renders the member's things.
import RequireAuth from "./RequireAuth";
import { useMember } from "../../hooks/members/useMember";

function Inner() {
  const { member } = useMember();
  return <section>{/* your gated content; member?.displayName, member?.contactId for member-owned lookups */}</section>;
}
export default function MembersOnly() {
  return <RequireAuth><Inner /></RequireAuth>;
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state machine
behind the hook does arrive — `wix/members/member-store.ts` — so you never rewrite it: `subscribe`,
render from `getMemberState()`, call its actions; `MemberState` is the render contract. What you
write is the rendering — the form, the gate, the header control — and for that read these first;
they are tested code for exactly that behaviour, and rewriting them from the prose above is where
the bugs come from:

1. `components/members/LoginForm.tsx` — the four states as working code: the sign-in/sign-up
   toggle, the name fields only on sign-up, the verification-code step, the pending notice, the
   inline error, the button disabled while busy, `returnTo` after success (only a same-site path).
2. `components/members/RequireAuth.tsx` — wait for `loading` to settle before deciding (deciding
   early bounces a member on first paint); the visitor's prompt links to the login page with the
   current path as `returnTo`.
3. `components/members/MemberMenu.tsx` — the three renders (skeleton, "Log in", name/avatar +
   "Log out") and the avatar fallback (first letter of `displayName`).

All under `references/members/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass), keeping one
   `<MemberMenu client:only="react" />` in the header.
2. Keep `/login` and `/account` as shipped — the only login surface is `/login`; never link to
   `/api/auth/login`, build an OAuth callback page, or redirect to a Wix login page. Brand the
   chrome around the mounts; replace `AccountView` with your own surface on `useMember` when the
   brief wants more.
3. Gated content: `RequireAuth` around it, `client:only="react"`.
4. Write `pages/index.astro` (home) on `SiteLayout`.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs members --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts`,
`config.ts` (deploy wrote the public client id into both `WIX_CLIENT_ID` and
`WIX_MEMBERS_CLIENT_ID`), `media.ts`, and `wix/members/` — `client.ts`, `auth.ts`, `members.ts`,
`types.ts`, the `*-core.ts` rules, and `member-store.ts`. None of it is React. The hook and the
components don't ship on this stack; the store replaces the hook, and you write the components in
your framework to the contracts on this page:

- bind the store with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribeMember`; Svelte: `readable(getMemberState(), (set) => subscribeMember(() => set(getMemberState())))`;
  Solid: a signal set in `subscribeMember`). One store for the whole app (module-level); the first
  subscriber triggers the session read. State in, actions out — exactly `useMember`'s contract;
- your login form, gate, and header control to the defaults above — `LoginForm.tsx`,
  `RequireAuth.tsx`, `MemberMenu.tsx` are readable as behaviour specs.

Routes `/login`, `/account` (gated in the component, not the router — the session is browser
state); dev server on 4321; a static build goes through `npx @wix/cli@latest release` with
`site.outputDirectory` pointing at the build folder, an SSR build is hosted by you.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs members --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM,
the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` — pages,
styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project root
(config, seed output) is never the upload. Same function names and DTOs as the table above, so the
contracts on this page hold unchanged: `loginMember`, `registerMember`, `verifyMemberEmail`,
`logoutMember`, `loggedInHint` from `./js/wix/auth.js`; `fetchCurrentMember` from
`./js/wix/members.js`. The state machine ships too: `./js/wix/member-store.js`
(`subscribeMember` — the first subscriber triggers the session read — `getMemberState`, `login`,
`register`, `verifyEmail`, `logout`, `refreshMember`). No components ship — you write the rendering
in plain JS: one render function per surface that reads `getMemberState()`, called from
`subscribeMember`, with the form's submit calling the store's actions and rendering the
`LoginResult` state it resolves to. Pages are `login.html` (`?returnTo=` a same-site path) and
`account.html`, gated in the page: `loading` → a skeleton, anonymous → a link to
`login.html?returnTo=account.html`, a member → the profile. The header control is the same store
on every page.

How the session works here: the login runs over the IAM authentication API with the visitor token
and exchanges the result into member tokens, which replace the visitor token in `localStorage`
(`role: "member"`) — every later call runs as the member and the refresh keeps the member; never
mint per page. The exchange completes in a hidden iframe on the page's own origin, so **the page's
origin must be one of the OAuth app's allowed domains** (`localhost:4321` and the Wix-hosted origin
already are; a custom domain is added in the dashboard's Headless Settings) — otherwise the login
resolves nothing and times out with "Login timed out". Logout navigates to Wix and returns to the
URL you pass (`logout("account.html")` resolves against the page). Gated pages carry no SEO — there
is nothing to index. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs members --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. This vertical has no public reads — everything is the
visitor's own state — so the whole flow runs **in the browser** from `./js/wix/` exactly as the
static wiring above: the login form, the gate, the header control on `member-store.js`; the
browser owns the member token, so the server handles no per-visitor tokens, and a member-only page
is a page whose content renders once `getMemberState().loggedIn` is true. Add your public https
origin to the OAuth app's allowed domains before the login can complete (the iframe exchange) and
before logout can return.

If the server itself must know the member (server-rendered member-only pages, member-owned data
joined server-side), port `js/wix/auth.ts` and `auth-core.ts`: the same three calls — login with a
visitor token, the redirect session, `POST /oauth2/token` with `grantType: "authorization_code"` —
and the no-DOM branch of the exchange (fetch the authorize page, read `code` and `state` from it) is
the server's path; or use the docs' full-page variant (`responseMode: "query"` plus a `redirectUri`
on the allowed list). Then `client.ts`'s header applies: one token set per visitor in the visitor's
session, never one process-wide token, and `GET /members/v1/members/my?fieldsets=FULL` with that
token on each request (`members.ts` + `members-core.ts` as the port).

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite config
plugins — deploy already added the dep). Write route wrappers in the project's router: `/login` →
a page mounting `LoginForm` (pass `onSuccess` to navigate with your router, or let it use
`?returnTo=`); `/account` → `RequireAuth` around your account surface; gated routes → the same.
Mount `MemberMenu` in the header (pass `LinkComponent` for router links). Deploy wrote the public
client id into `wix/config.ts` (`WIX_CLIENT_ID` and `WIX_MEMBERS_CLIENT_ID`); nothing else to
configure.

## Hard rules

- **No Wix-hosted login flow** — no `/api/auth/login`, no OAuth callback page, no callback URI for
  credential login. Password-reset emails and logout are the only redirect surfaces, and both
  return to a URL you pass.
- **Auth only through the shipped exports** — `useMember` / the store's actions; never call the
  IAM API or the OAuth client yourself, never rewrite the exchange. Extend by adding a function in
  `wix/members/` for what they don't cover (API contracts: the `wix-docs` skill).
- **One explicit members client** (`wix/members/client.ts`) — never instantiate another, never one
  per component.
- **Session state only through the store** — no React context, no copy of `loggedIn` in component
  state, no identity inferred from local UI state.
- **Every state is rendered**: a failed login shows `error` next to the form; verification and
  owner approval are states, not errors; `loading` is a skeleton, never the logged-out UI.
- **Identity vs profile**: `loggedIn` needs no app install; `member` (profile data) needs the Wix
  Members Area app — the seed installs it. A member with `member === null` gets the honest line,
  not a fake profile.
- **Gate only what the brief gates.** Public pages stay public; browsing never needs a login.
- Don't use `auth.elevate()` for a member reading their own records — the member token is the
  right identity.
- **Live data or an honest empty state** — never mock a member, a name, or a member count.
- **The token is the session** — it persists on its own (cookie on Astro, `localStorage`
  elsewhere); never mint per page, never store credentials.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. Where they don't (`lib`, `static`, a port): style with whatever your stack does well, on one
  token set of your own; the rule that survives is the token set, not Tailwind.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Point the user to their dashboard

Give the owner the dashboard link — **the deploy step's JSON output already printed it**
(`dashboardUrl`); copy, don't re-derive. Members are managed under Contacts → Site Members there,
and the signup policy — email verification, owner approval, reCAPTCHA — is set under Settings →
Member signup; it decides which state a sign-up ends in.

## Seeding

Per `seed/SEED.md` — `seed-members.mjs`, run from the project root. It installs the Wix Members
Area app (the profile layer) and nothing else: members self-register at runtime, never at build
time. Independent of the frontend work.
