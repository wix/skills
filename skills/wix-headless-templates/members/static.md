# Members on a static site

The pages are HTML files at the root of the site. They import the members modules from
`/js/wix/` and render what the modules return. This file is the whole playbook for that path: the
modules, the header control, the login page, the account page, a gated page, routes, rules, the
owner's links and the seed.

## The modules

`/js/wix/auth.js`: `loginMember`, `registerMember`, `verifyMemberEmail`, `logoutMember`,
`loggedInHint()`; the pages call these through the member store. `/js/wix/members.js`:
`fetchCurrentMember()`, the profile: `id`, `loginEmail`, `displayName`, `firstName`, `lastName`,
`nickname`, `photoUrl` (an https URL, empty when none), `contactId`, `memberSince`.

One store holds the session for the whole site, `/js/wix/member-store.js`: `subscribeMember(fn)`
(the first subscriber starts the session read), `getMemberState()` with `member`, `loggedIn`,
`loading`, `error`; the actions `login(email, password)`, `register(email, password, { firstName,
lastName })`, `verifyEmail(code)`, `logout(returnTo)`, `refreshMember()`. `login`, `register` and
`verifyEmail` resolve to a result with `state`: `SUCCESS`, `EMAIL_VERIFICATION_REQUIRED`,
`OWNER_APPROVAL_REQUIRED` or `FAILURE`, and for a failure `errorCode` (`invalidPassword`,
`invalidEmail`, `emailAlreadyExists`, `resetPassword`, `missingCaptchaToken`,
`invalidCaptchaToken`) with Wix's message in `error`. A wrong password is a result, never a throw.
A store calls a listener on every change and not when it subscribes: render once after
subscribing.

How the session works here: the login runs with the visitor token and exchanges the result into
member tokens, which replace the visitor token in `localStorage`. Every later call runs as the
member and the refresh keeps the member; never mint a token in a page. The exchange completes in a
hidden iframe on the page's own origin, so the page's origin must be one of the OAuth app's
allowed domains. The Wix-hosted origin already is; a custom domain is added in the dashboard's
Headless Settings. Otherwise the login resolves nothing and times out with "Login timed out".
Logout navigates to Wix and returns to the URL you pass, resolved against the page.

## The header control

On every page: a placeholder while `loading`, "Log in" for a visitor, the member's name or photo
with "Log out" for a member. The placeholder is what stops a member seeing "Log in" for a moment.

```html
<span id="session"></span>
```

```js
import { subscribeMember, getMemberState, logout } from "/js/wix/member-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const session = document.querySelector("#session");
session.addEventListener("click", (e) => { if (e.target.closest("[data-logout]")) logout(location.pathname).catch(() => {}); });
function renderSession(s) {
  if (s.loading) { session.innerHTML = `<span class="session-placeholder" aria-hidden="true"></span>`; return; }
  if (!s.loggedIn) { session.innerHTML = `<a href="/login.html?returnTo=${encodeURIComponent(location.pathname)}">Log in</a>`; return; }
  const name = s.member?.displayName || s.member?.firstName || "My account";
  session.innerHTML = `<a href="/account.html">${s.member?.photoUrl ? `<img class="avatar" src="${s.member.photoUrl}" alt="">` : ""}${esc(name)}</a> <button type="button" data-logout>Log out</button>`;
}
subscribeMember(renderSession);
renderSession(getMemberState());
```

## The login page

`login.html` holds sign in and sign up on one page, with `?returnTo=` a same-site path honoured
after success. Every result state renders: a failed login as a message next to the form, email
verification as a code field, owner approval as a notice. The one primary button is the form's
submit.

```html
<form id="login" class="auth" novalidate>
  <label>Email <input name="email" type="email" autocomplete="email" required></label>
  <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit" class="primary">Log in</button>
  <p class="auth-error" role="alert" hidden></p>
</form>
<form id="signup" class="auth" novalidate>
  <label>First name <input name="firstName" autocomplete="given-name"></label>
  <label>Last name <input name="lastName" autocomplete="family-name"></label>
  <label>Email <input name="email" type="email" autocomplete="email" required></label>
  <label>Password <input name="password" type="password" autocomplete="new-password" required></label>
  <button type="submit" class="primary">Sign up</button>
  <p class="auth-error" role="alert" hidden></p>
</form>
<form id="verify" class="auth" hidden novalidate>
  <p>We sent a code to your email.</p>
  <label>Verification code <input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
  <button type="submit" class="primary">Verify</button>
  <p class="auth-error" role="alert" hidden></p>
</form>
<p id="approval" hidden>Thanks. The site owner reviews new members; you will get an email once your account is approved.</p>
```

```js
import { subscribeMember, getMemberState, login, register, verifyEmail } from "/js/wix/member-store.js";

const returnTo = new URLSearchParams(location.search).get("returnTo") || "/";
const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
const forms = { login: document.querySelector("#login"), signup: document.querySelector("#signup"), verify: document.querySelector("#verify") };
const approval = document.querySelector("#approval");

function show(result, form) {
  const error = form.querySelector(".auth-error");
  error.hidden = true;
  if (result.state === "SUCCESS") { location.assign(safeReturn); return; }
  if (result.state === "EMAIL_VERIFICATION_REQUIRED") { forms.login.hidden = forms.signup.hidden = true; forms.verify.hidden = false; forms.verify.elements.code.focus(); return; }
  if (result.state === "OWNER_APPROVAL_REQUIRED") { forms.login.hidden = forms.signup.hidden = forms.verify.hidden = true; approval.hidden = false; return; }
  error.textContent = result.error || "That did not work. Check the details and try again.";
  error.hidden = false;
}
async function submit(form, action) {
  if (!form.reportValidity()) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try { show(await action(form.elements), form); }
  catch (e) { show({ state: "FAILURE", error: e instanceof Error ? e.message : String(e) }, form); }
  finally { button.disabled = false; }
}
forms.login.addEventListener("submit", (e) => { e.preventDefault(); submit(forms.login, (f) => login(f.email.value.trim(), f.password.value)); });
forms.signup.addEventListener("submit", (e) => { e.preventDefault(); submit(forms.signup, (f) => register(f.email.value.trim(), f.password.value, { firstName: f.firstName.value.trim(), lastName: f.lastName.value.trim() })); });
forms.verify.addEventListener("submit", (e) => { e.preventDefault(); submit(forms.verify, (f) => verifyEmail(f.code.value.trim())); });

// A member who opens the login page goes where they were headed.
subscribeMember((s) => { if (!s.loading && s.loggedIn) location.replace(safeReturn); });
if (!getMemberState().loading && getMemberState().loggedIn) location.replace(safeReturn);
```

## The account page and a gated page

`account.html` is gated in the page: `loading` shows a placeholder, a visitor gets a link to
`login.html?returnTo=/account.html`, a member gets the profile: `displayName`, `loginEmail`,
`memberSince`, the photo when there is one. A logged-in member whose `member` is null gets one
honest line, "Profile details are unavailable", which means the Members Area app is not
installed; the seed installs it. Any page the brief gates follows the same shape with its own
content in the template. Gated pages carry no SEO; there is nothing to index.

```html
<div id="gate"><p class="loading" aria-hidden="true"></p></div>
<template id="member-content">
  <section class="account">
    <img class="avatar" data-photo alt="" hidden>
    <h1 data-name></h1>
    <p data-email></p>
    <p>Member since <span data-since></span></p>
  </section>
</template>
```

```js
import { subscribeMember, getMemberState } from "/js/wix/member-store.js";

const gate = document.querySelector("#gate");
function renderGate(s) {
  if (s.loading) { gate.innerHTML = `<p class="loading" aria-hidden="true"></p>`; return; }
  if (!s.loggedIn) { gate.innerHTML = `<p>Please <a href="/login.html?returnTo=${encodeURIComponent(location.pathname)}">log in</a> to see your account.</p>`; return; }
  if (!s.member) { gate.innerHTML = `<p>Profile details are unavailable.</p>`; return; }
  const view = document.querySelector("#member-content").content.cloneNode(true);
  const m = s.member;
  view.querySelector("[data-name]").textContent = m.displayName;
  view.querySelector("[data-email]").textContent = m.loginEmail;
  view.querySelector("[data-since]").textContent = m.memberSince;
  const photo = view.querySelector("[data-photo]");
  if (m.photoUrl) { photo.src = m.photoUrl; photo.hidden = false; }
  gate.replaceChildren(view);
}
subscribeMember(renderGate);
renderGate(getMemberState());
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/login.html`, `/account.html`, and the pages the brief gates. A link to a folder gives the
visitor a 404 page. Public pages stay public; browsing never needs a login.

## Rules

- The member types credentials into your form on your site; the exchange runs in the modules.
  Never call the authentication API or the OAuth endpoints from a page, never rewrite the
  exchange.
- Session state only through the member store; no copy of `loggedIn` kept by a page, no identity
  inferred from the page's own state.
- Every state renders: a failed login shows `error` next to the form; verification and owner
  approval are states; `loading` is a placeholder, never the logged-out view.
- Identity and profile are two things: `loggedIn` needs no app, `member` needs the Members Area
  app. A member with `member` null gets the honest line.
- Gate only what the brief gates.
- Live data or an honest empty state; never an invented member, name or count.
- The session persists on its own in `localStorage`; never store credentials.

## The owner's links

The dashboard URL from the provisioning step. Members are managed under Contacts, Site Members.
The signup policy (email verification, owner approval, reCAPTCHA) is set under Settings, Member
signup, and decides which state a sign-up ends in. A custom domain is added to the OAuth app's
allowed domains under Headless Settings before the login works on it.

## Seeding

Per `seed/SEED.md` and `seed/seed-members.mjs`, run in the script's order with its waits. It
installs the Wix Members Area app, the profile layer, and nothing else: members register
themselves at runtime, never at build time.
