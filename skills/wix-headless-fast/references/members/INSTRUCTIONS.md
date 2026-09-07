# Members — custom in-app login

The Members vertical ships a **custom credential login**, not the Wix-hosted
login-page redirect. Members sign up and sign in on `/login` with email and
password; the shipped client exchanges a direct-login session into member
tokens into the managed `wixSession` cookie. That makes the member identity
available to both the custom client and Astro's ambient SDK calls after the
next navigation. Do not replace the auth implementation or add a second client.

## Shipped files

| File                                                                      | Purpose                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `wix/members/client.ts`                                                   | Explicit `OAuthStrategy` client that syncs direct-login tokens to Astro. |
| `wix/members/auth.ts`                                                     | Direct `register`, `login`, verification, and logout state machine.      |
| `wix/members/member-store.ts` + `hooks/members/useMember.ts`              | Module-scoped session state shared by Astro islands.                     |
| `components/members/LoginForm.tsx`                                        | Branded in-app sign-in/sign-up and verification UI.                      |
| `components/members/MemberMenu.tsx`, `RequireAuth.tsx`, `AccountView.tsx` | Header control, client gate, and account surface references.             |
| `pages/login.astro`, `pages/account.astro`                                | Custom-login and gated-account routes.                                   |

## Wire it

1. Keep `<MemberMenu client:only="react" />` in the winning site header.
2. Keep the shipped `/login` route. It is the only login surface; never link to
   `/api/auth/login`, build an OAuth callback page, or redirect to Wix login.
3. Keep `/account` client-gated with `<RequireAuth>`. A visitor sees a link to
   `/login`; a member sees their actual profile.
4. Build your own visual chrome around these shipped components using the site
   tokens. Do not mock a signed-in member or infer identity from local UI state.

## Direct-login contract

- `login(email, password)` and `register(email, password, profile)` return all
  Wix states: `SUCCESS`, `EMAIL_VERIFICATION_REQUIRED`,
  `OWNER_APPROVAL_REQUIRED`, or `FAILURE`. The shipped form handles each one.
- A successful state calls `getMemberTokensForDirectLogin` then `setTokens` on
  the same client. It writes Astro's `wixSession` cookie, so the next page
  request and browser islands run later SDK calls as that member.
- No login redirect URI is required for credential login. Password-reset and
  logout return URLs remain the only optional redirect surfaces.
- The public OAuth client ID is written as `WIX_MEMBERS_CLIENT_ID` by deploy,
  even for managed Astro. It is public; never add an OAuth secret to the app.
- Identity needs no Members Area app. Profile data and custom profile fields do;
  the member seed installs the Members Area app.

## Rules

- No Wix-hosted login flow, `/api/auth/login`, OAuth callback, or callback URI
  requirement for credential login.
- Keep one explicit custom-members client. Do not instantiate one per component.
- Do not use `auth.elevate()` for a member reading their own records.
- Surface login failure and the verification/approval states; never silently
  fall back to anonymous UI.

## Verify

- [ ] `/login` renders an in-app email/password sign-in and sign-up form.
- [ ] A successful sign-in changes the header and unlocks `/account` without a
      Wix-hosted login redirect.
- [ ] Email verification and owner approval are rendered as states, not errors.
- [ ] Reload preserves the member session; the next server render also sees it;
      logout clears it.
- [ ] No mocked member data, redirect-based login, or extra auth client exists.
