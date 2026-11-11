# Members: the calls of a build through the Wix tools

For steps 3 to 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
installs the app, and what the pages import.

## Step 3: install the app

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`.

```javascript
async function run() {
  await wix.request({ scope: 'site', method: 'POST',
    url: 'https://www.wixapis.com/apps-installer-service/v1/app-instance/install',
    body: { tenant: { tenantType: 'SITE', id: siteId }, appInstance: { appDefId: '14cc59bc-f0b7-15b8-e1c7-89ce41d0e0c9', enabled: true } } });
  return { installed: true };
}
```

## Step 4: nothing to create

Members register on the site. Do not create a member.

## Step 5: what the pages import

- The session, as functions in `/js/wix/member-store.js`: `subscribeMember(fn)`,
  `getMemberState()`, and the actions `login(email, password)`,
  `register(email, password, { firstName, lastName })`, `verifyEmail(code)`, `logout(returnTo)`.
- The read: `fetchCurrentMember()` in `/js/wix/members.js`. It is null for a visitor.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the check

A visitor has no member to read. Count this solution as `0 members, by design` in the status of
step 6, and say that the owner can test the sign-up on the live site.
