# Technical Implementation Guide

Implementation details and official Wix doc links for the technically
reviewable requirements covered by this version of the skill. Manual App
Dashboard, Dev Center, and listing-copy configuration is intentionally out of
scope here. Numbers in parentheses reference the taxonomy item (#).

---

## 1. Payment & Billing

All apps that collect money **must** route payments through Wix Billing unless a
formal written exception has been granted by Wix.

Important: do not confuse Wix Business Solutions Pricing Plans with app billing
for the app itself. The Pricing Plans SDK/APIs are for Wix users selling plans
to their own customers, while App Billing/App Plans are the relevant surfaces
for charging site owners for your app.

- [About the App Billing APIs](https://dev.wix.com/docs/api-reference/app-management/app-billing/introduction)
- [About the Pricing Plans APIs](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/introduction)

| Requirement | Notes | Doc |
|---|---|---|
| Implement Wix Billing (#25) | Use Billing API for subscriptions unless Wix explicitly approved the app as Partner Billed; approved Partner Billed apps use External Billing Events | [App Billing APIs](https://dev.wix.com/docs/api-reference/app-management/app-billing/introduction) |
| No custom license keys / QR codes (#29) | Content gating must go through Wix Billing only | [Billing API](https://dev.wix.com/docs/api-reference/app-management/app-billing/billing/introduction) |
| No external purchase buttons/links (#30) | Remove any UI directing to non-Wix checkout | [Billing API](https://dev.wix.com/docs/api-reference/app-management/app-billing/billing/introduction) |
| Credits must not expire (#31) | Implement permanent credit balance logic | [Billing API](https://dev.wix.com/docs/api-reference/app-management/app-billing/billing/introduction) |
| Test checkout flow per plan (#33) | Verify purchase, upgrade, cancellation UX | [Billing API: Sample Flows](https://dev.wix.com/docs/api-reference/app-management/app-billing/billing/sample-flows) |
| Upgrade path for premium features (#125) | If the app has premium features, provide a clear in-product upgrade link/CTA. Do not treat Business Solutions Pricing Plans SDK usage as equivalent evidence for app billing decisions. Wix's documented pricing-page upgrade entry point opens in a new tab and should not be flagged as a popup-rule violation. | [Identify and Manage App Users](https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/identify-and-manage-app-users) |
| No downgrade via pricing page (#35) | Users must cancel then repurchase — no direct downgrade path | [Billing API](https://dev.wix.com/docs/api-reference/app-management/app-billing/billing/introduction) |
| Use Custom Charges plugin for usage-based/one-time billing | Billing API handles subscriptions; use Custom Charges for everything else | [Custom Charges Service Plugin](https://dev.wix.com/docs/api-reference/app-management/app-billing/custom-charges-service-plugin/introduction) |

**Partner Billed Apps** (self-processed payments — Stripe, PayPal, etc. — only for apps with written approval from Wix):

| Requirement | Notes | Doc |
|---|---|---|
| Report all charges/refunds via External Billing Events | Required for approved Partner Billed apps for revenue tracking and quarterly reports | [External Billing Events API](https://dev.wix.com/docs/api-reference/app-management/app-billing/external-billing-events/introduction) |
| Submit quarterly billing reports to Wix | Ongoing obligation for approved Partner Billed apps | [Report Revenue for Partner Billed Apps](https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/report-revenue-for-partner-billed-apps) |


---

## 2. App Instance & Identity

The `instanceId` is the unique identifier for an app installation on a specific
site. Use it for all user identification and billing — never cookies or sessions.
Site duplication creates a new `instanceId`; use `originInstanceId` to relate it
back to the original install when carrying settings forward.

| Requirement | Notes | Doc |
|---|---|---|
| Identify by `instanceId` (#115) | Each site installation gets a unique ID | [App Instance API](https://dev.wix.com/docs/api-reference/app-management/app-instance/introduction) |
| Separate billing per `instanceId` (#116) | One account must not share a plan across sites | [App Instance API](https://dev.wix.com/docs/api-reference/app-management/app-instance/introduction) |
| Auto-login via `instanceId` (#118) | Restore session using `instanceId` from query params | [Get App Instance](https://dev.wix.com/docs/api-reference/app-management/app-instance/get-app-instance) |
| Check required Wix apps (#120) | Verify dependencies via Get App Instance; show a prompt if missing | [Get App Instance](https://dev.wix.com/docs/api-reference/app-management/app-instance/get-app-instance) |
| Catalog compatibility (#130) | If the app supports Wix Catalog, it must support both Catalog V1 and Catalog V3 — not just V1 | [Catalog Versioning API](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/introduction) |
| Handle site duplication (#122) | On `originInstanceId`, treat the copied site as a new install linked to the older one and copy applicable settings/content for a smoother flow | [App Instance API](https://dev.wix.com/docs/api-reference/app-management/app-instance/introduction) |
| Multi-site account switching (#117) | Support one account across sites or one account per site | [App Instance API](https://dev.wix.com/docs/api-reference/app-management/app-instance/introduction) |
| Multi-instance settings (#50) | Same widget appearing multiple times on a site must have independent settings each | [App Instance API](https://dev.wix.com/docs/api-reference/app-management/app-instance/introduction) |
| Site copy carries settings (#51) | When a site is duplicated, copy visual/component settings and other relevant app data from the original instance — not the default state | [App Instance API](https://dev.wix.com/docs/api-reference/app-management/app-instance/introduction) |

---

## 3. Webhooks

| Requirement | Notes | Doc |
|---|---|---|
| App Installed webhook (#113, recommended) | Useful when you provision account state on install; if implemented, return HTTP 200 | [App Instance Installed](https://dev.wix.com/docs/api-reference/app-management/app-instance/app-instance-installed) |
| App Removed webhook (#113, recommended) | Useful when you clean up or archive data on uninstall; if implemented, return HTTP 200 | [App Instance Removed](https://dev.wix.com/docs/api-reference/app-management/app-instance/app-instance-removed) |
| Return 200 (#114) | Hard requirement for any implemented webhook; non-200 responses trigger retries and may block review | [App Instance Installed](https://dev.wix.com/docs/api-reference/app-management/app-instance/app-instance-installed) |

**Recommended additional webhook:**

| Webhook | When it fires | Doc |
|---|---|---|
| Paid Plan Purchased | User buys a paid plan for your app | [Paid Plan Purchased](https://dev.wix.com/docs/api-reference/app-management/app-instance/paid-plan-purchased) |

---

## 4. Setup & Access

| Requirement | Notes | Doc |
|---|---|---|
| Settings/setup UI exists (#107) | The app must expose some usable setup/settings UI, such as a dashboard page, widget, or other relevant surface; Embedded Script apps need a dashboard page | [About Extensions](https://dev.wix.com/docs/build-apps/develop-your-app/extensions/about-extensions) |
| No localhost URLs (#108) | App configuration URLs must be publicly reachable and must not point to localhost | [Add Self-hosted Dashboard Page Extensions](https://dev.wix.com/docs/build-apps/develop-your-app/frameworks/self-hosting/supported-extensions/dashboard-extensions/add-self-hosted-dashboard-page-extensions) |

---

## 5. Permissions & Scopes

Request the minimum scopes your app actually uses. Review the declared permissions
list and remove any that are redundant with broader scopes already requested.

→ [App Permissions API](https://dev.wix.com/docs/api-reference/app-management/app-permissions/introduction)

---

## 6. Security

### Instance Signature Verification

For flows that rely on the signed `instance` query parameter, verify it
server-side before trusting user/site context. This is especially important for
settings/internal dashboard save actions and other state-changing requests that
reuse the signed instance.

| Requirement | Implementation | Doc |
|---|---|---|
| Verify HMAC signature (#74) | Decode the JWT `instance` param and verify with your app's secret key | [App Instance API](https://dev.wix.com/docs/api-reference/app-management/app-instance/introduction) |
| Validate `signDate` (#76) | For signed-instance-backed edit/save actions, reject signatures older than 1 day and ask the user to refresh before continuing | [Security and Privacy Best Practice](https://dev.wix.com/docs/build-apps/launch-your-app/legal-and-security/security-and-privacy-best-practice) |

### General Security

| Requirement | Notes | Doc |
|---|---|---|
| HTTPS everywhere (#65, #77) | All URLs — dashboard, editor, live site — must be HTTPS with no HTTP fallback | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| CSRF + XSS protection (#64, #78) | Sanitize every user input field — search, comments, forms, titles. Simple regex HTML tag stripping is only partial mitigation; use context-appropriate sanitization/encoding, and a maintained sanitizer when HTML input must be supported. | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Salted password hashes (#63, #79, #80) | SHA-256 or bcrypt + unique random salt per password — no plaintext storage | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Password reset via expiring email (#81) | Link expires in 1–2 hours; never send raw passwords | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Encrypt sensitive data (#69) | No sensitive fields in cookies; encrypt at rest in the database | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| No forced login (#66) | First-run experience must not require signup to explore | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Revoke social credentials (#67) | In-app option to revoke connected social accounts | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| PCI-DSS / PA-DSS (#73) | Required if app handles card data directly | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |

---

## 7. App Behavior

| Requirement | Notes | Doc |
|---|---|---|
| Wix popup/modal only (#39) | Use Wix popup/modal for in-product flows instead of browser-native popups. Do not treat documented exceptions such as OAuth or Wix pricing-page upgrade CTAs as violations of this rule. | [Guidelines for Self-Hosted Dashboard Extensions](https://dev.wix.com/docs/build-apps/develop-your-app/frameworks/self-hosting/supported-extensions/dashboard-extensions/guidelines-for-self-hosted-dashboard-extensions) |
| No `alert()`/`confirm()` (#45) | Use Wix modal components or another Wix-appropriate feedback surface instead. If you remove a browser-native alert, replace it with visible inline status, loader, toast, or modal feedback appropriate to the surface. | [UX / UI Best Practices](https://dev.wix.com/docs/build-apps/develop-your-app/design/ux-and-ui-best-practices) |
| No ads to site owners (#46) | Cross-promotion of your own apps is allowed if unobtrusive | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| No ads to visitors (#47) | Unless the app's purpose is ad delivery with proper permits | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Plugin content matches host (#44) | Injected content must be relevant to the host app's core purpose | [Site Plugins API](https://dev.wix.com/docs/api-reference/app-management/site-plugins/introduction) |
| Demo data on first install (#37) | Show realistic fictional content — not Lorem Ipsum | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Review modal (#121) | Recommended only; if implemented, keep it non-blocking and do not force or incentivize reviews | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Forgotten password flow (#119) | Email reset link with expiry; no plaintext passwords sent | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Cookie consent (#92, #97) | Activate/deactivate cookies dynamically per visitor consent choice | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |

---

## 8. Performance

App must load within 400ms (#48). Run a performance audit before submission — known
bugs or console errors cause automatic rejection (#49).

→ [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines)

---

## 9. Responsive Design & Accessibility

| Requirement | Notes | Doc |
|---|---|---|
| Responsive on all screen sizes (#52) | Relevant for live site extensions; dashboard-only surfaces do not require mobile/tablet support | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| WCAG accessibility (#53) | All website components must meet accessibility standards | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Dashboard min-width 1200px (#54) | Applies to dashboard surfaces on desktop | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| Alt-text in settings panel (#57) | Include an alt-text input for any user-facing images | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |
| UTF-8 encoding (#58) | Required for international character sets | [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines) |

---

## 10. SEO

No `<h1>` tags inside widget components (#55) — there is only one `<h1>` allowed
per page and the host page owns it. Optimize all SEO-meaningful content per
industry best practices (#56).

→ [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines)
