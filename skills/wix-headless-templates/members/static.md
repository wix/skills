# Members on a static site

The pages are HTML files at the root of the site. They import the members layer from `/js/wix/`:
the authentication calls, the current-member read, and one store that holds the session for the
whole site. Nothing on the screen ships; every element is yours, in the design of the site. This
file shows how to drive the layer. The skeletons show the calls and the fields and leave the
markup to you.

## The layer

`/js/wix/auth.js`: `loginMember`, `registerMember`, `verifyMemberEmail`, `logoutMember`,
`loggedInHint()`; the pages reach these through the member store. `/js/wix/members.js`:
`fetchCurrentMember()`, null for a visitor, else the profile: `id`, `loginEmail`, `displayName`
(the nickname, else first and last name, else the local part of the email), `firstName`,
`lastName`, `nickname`, `photoUrl` (an https URL, "" when none), `contactId`, `memberSince`
("YYYY-MM-DD", "" when unknown).

One store, `/js/wix/member-store.js`, one session for the whole site. `subscribeMember(fn)`
starts the session read on its first call; `getMemberState()` reads it. The state: `member`,
`loggedIn`, `loading`, `error`. The actions: `login(email, password)`, `register(email, password,
{ firstName, lastName })`, `verifyEmail(code)`, `logout(returnTo)`, `refreshMember()`. `login`,
`register` and `verifyEmail` resolve to a result with `state`: "SUCCESS",
"EMAIL_VERIFICATION_REQUIRED", "OWNER_APPROVAL_REQUIRED" or "FAILURE"; a failure carries
`errorCode` ("invalidPassword", "invalidEmail", "emailAlreadyExists", "resetPassword",
"missingCaptchaToken", "invalidCaptchaToken") and Wix's message in `error`. A wrong password is a
result, never a throw.

How the session works: the login runs with the visitor token and exchanges the result into member
tokens, which replace the visitor token in `localStorage`. Every later call runs as the member and
the refresh keeps the member; never mint a token in a page. The exchange completes in a hidden
iframe on the page's own origin, so the origin must be one of the OAuth app's allowed domains.
The Wix-hosted origin already is; a custom domain is added in the dashboard's Headless Settings.
On any other origin the login resolves nothing and rejects with a timeout message. `logout`
navigates to Wix and returns to the URL you pass, resolved against the page.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store before writing a page on it.

## The pattern

One store for the site: subscribe a render function, render once from `getMemberState()`. The
store calls the listener on every change and not on subscribe, so the first render is yours.
Controls call the store's actions; delegate from the surface's root and read what to do from
the element, so a re-render of the markup keeps the listeners.

```js
import { subscribeMember, getMemberState, logout } from "/js/wix/member-store.js";

function render(s) {
  // read s.loading, s.loggedIn, s.member; write your markup into the page
}
subscribeMember(render);
render(getMemberState());
root.addEventListener("click", function (e) {
  if (e.target.closest("[data-logout]")) logout(location.pathname).catch(function () {});
});
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The header control

On every page, from the state: `loading` renders a placeholder that takes the control's space;
`loggedIn` false renders a link to `login.html?returnTo=` + the current path; `loggedIn` true
renders the member (`member.displayName`, or `member.firstName`, with `member.photoUrl` when
set) linking to `account.html`, and a logout control calling `logout(path)`. The placeholder is
what stops a member seeing the visitor's link for a moment.

```js
function renderSession(s) {
  if (s.loading) { sessionEl.innerHTML = '<span aria-hidden="true"></span>'; return; }
  if (!s.loggedIn) {
    sessionEl.innerHTML = '<a href="/login.html?returnTo=' + encodeURIComponent(location.pathname) + '">Log in</a>';
    return;
  }
  var m = s.member || {};
  var name = m.displayName || m.firstName || "My account";
  sessionEl.innerHTML = '<a href="/account.html">' + (m.photoUrl ? '<img src="' + m.photoUrl + '" alt="">' : "")
    + esc(name) + '</a> <button type="button" data-logout>Log out</button>';
}
```

## The login page

`login.html` holds sign in and sign up on one page, with `?returnTo=` honoured after success
when it is a same-site path (starts with "/" and not with "//"; anything else goes to "/").
A member who opens the page goes straight to that path. Three forms, one visible at a time, and
one notice:

- Sign in: email and password, `login(email, password)`.
- Sign up: first name, last name, email, password, `register(email, password, { firstName,
  lastName })`.
- Verification: one code field, `verifyEmail(code)`; shown when a result's `state` is
  "EMAIL_VERIFICATION_REQUIRED".
- Approval notice: shown when a result's `state` is "OWNER_APPROVAL_REQUIRED".

The result decides the next render: "SUCCESS" navigates to the return path; the two pending
states swap the visible form or notice; "FAILURE" shows `error` next to the form that sent it.
Disable the submit while the call is in flight. A throw (the network, the origin) renders like a
failure with its message. Every form's submit is the one primary action on the page.

```js
import { subscribeMember, getMemberState, login, register, verifyEmail } from "/js/wix/member-store.js";

var returnTo = new URLSearchParams(location.search).get("returnTo") || "/";
var safeReturn = returnTo.charAt(0) === "/" && returnTo.charAt(1) !== "/" ? returnTo : "/";
function show(result, form) {
  if (result.state === "SUCCESS") { location.assign(safeReturn); return; }
  if (result.state === "EMAIL_VERIFICATION_REQUIRED") { showOnly(verifyForm); return; }
  if (result.state === "OWNER_APPROVAL_REQUIRED") { showOnly(approvalEl); return; }
  errorOf(form).textContent = result.error || "That did not work. Check the details and try again.";
}
function submit(form, action) {
  if (!form.reportValidity()) return;
  var button = form.querySelector("button[type=submit]");
  button.disabled = true;
  action(form.elements).then(function (r) { show(r, form); })
    .catch(function (e) { show({ state: "FAILURE", error: e && e.message ? e.message : String(e) }, form); })
    .then(function () { button.disabled = false; });
}
loginForm.addEventListener("submit", function (e) {
  e.preventDefault();
  submit(loginForm, function (f) { return login(f.email.value.trim(), f.password.value); });
});
subscribeMember(function (s) { if (!s.loading && s.loggedIn) location.replace(safeReturn); });
if (!getMemberState().loading && getMemberState().loggedIn) location.replace(safeReturn);
```

The sign-up form binds the same way with `register`, and the verification form with
`verifyEmail`; `showOnly` hides the other forms and the notice, `errorOf` finds the form's own
message element. Render the forms once; a result changes which one is visible and the message,
never the inputs.

## The account page and a gated page

`account.html` is gated in the page, from the same state: `loading` renders a placeholder;
`loggedIn` false renders a link to `login.html?returnTo=/account.html`; `loggedIn` true with
`member` renders the profile (`displayName`, `loginEmail`, `memberSince`, the photo when
`photoUrl` is set); `loggedIn` true with `member` null renders one honest line, "Profile details
are unavailable", which means the Members Area app is not installed (the seed installs it). Any
page the brief gates follows the same shape with its own content, kept out of the page until the
member state allows it. Gated pages carry no SEO; there is nothing to index.

```js
import { subscribeMember, getMemberState } from "/js/wix/member-store.js";

function renderGate(s) {
  if (s.loading) { gateEl.innerHTML = '<p aria-hidden="true"></p>'; return; }
  if (!s.loggedIn) {
    gateEl.innerHTML = '<p><a href="/login.html?returnTo=' + encodeURIComponent(location.pathname) + '">Log in</a></p>';
    return;
  }
  if (!s.member) { gateEl.textContent = "Profile details are unavailable."; return; }
  var m = s.member;
  gateEl.innerHTML = (m.photoUrl ? '<img src="' + m.photoUrl + '" alt="">' : "")
    + "<h1>" + esc(m.displayName) + "</h1><p>" + esc(m.loginEmail) + "</p><p>" + esc(m.memberSince) + "</p>";
}
subscribeMember(renderGate);
renderGate(getMemberState());
```

`esc` escapes `&`, `<`, `>` and `"` in anything that came from the site.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/login.html`, `/account.html`, and the pages the brief gates. A link to a folder gives the
visitor a 404 page. Public pages stay public; browsing never needs a login. Write the pages'
scripts as files of their own and keep each file small; a page's code travels as text in the
upload call.

## Rules

- The member types credentials into your form on your site; the exchange runs in the layer.
  Never call the authentication API or the OAuth endpoints from a page, never rewrite the
  exchange.
- Session state only through the member store; no copy of `loggedIn` kept by a page, no identity
  inferred from the page's own state.
- Every state renders: a failed login shows `error` next to the form; verification and owner
  approval are states; `loading` is a placeholder, never the logged-out view.
- Identity and profile are two things: `loggedIn` needs no app, `member` needs the Members Area
  app. A member with `member` null gets the honest line.
- Render form fields once; a render touches the visible form, the button and the error, not the
  inputs.
- Gate only what the brief gates.
- Live data or an honest empty state; never an invented member, name or count; no Wix ids or
  technical words in visible text.
- The session persists on its own in `localStorage`; never store credentials.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

## The owner's links

The dashboard URL from the provisioning step. Members are managed under Contacts, Site Members.
The signup policy (email verification, owner approval, reCAPTCHA) is set under Settings, Member
signup, and decides which state a sign-up ends in. A custom domain is added to the OAuth app's
allowed domains under Headless Settings before the login works on it.

## Seeding

Per `seed/SEED.md` and `seed/seed-members.mjs`, run in the script's order with its waits. It
installs the Wix Members Area app, the profile layer, and nothing else: members register
themselves at runtime, never at build time.
