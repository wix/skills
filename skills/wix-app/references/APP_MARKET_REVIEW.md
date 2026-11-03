# Wix App Market Review

Use this reference to prepare a Wix CLI app for App Market submission, audit review feedback, or check whether an app is likely to pass review. Be evidence-based: mark each relevant requirement `Confirmed`, `Not applicable`, or `Needs confirmation`. It covers code-facing requirements; dashboard, pricing-page, company-profile and listing-copy checks need evidence from the user.

## Review Workflow

1. Identify the app surfaces first: billing model, auth and password use, cookies, extension types, live-site and dashboard surfaces, Wix business-solution dependencies, webhooks.
2. Start with a report-only pass: confirmed gaps, why they matter, and the docs page for each.
3. Mark a requirement missing only when code, config, user statements, runtime behavior or explicit absence supports it; otherwise `Needs confirmation`.
4. Flag secrets or config leakage only when the exposure is in a tracked file, the current diff or a build artifact.
5. For any gap the user asks you to fix, implement the fix through the relevant `wix-app` extension reference, then run validation.

## Requirements

The requirement text, with its numbers, is in these docs pages. Check each finding against its page and map it to the IDs below:

- [App Market Guidelines](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines).
- [Security and Privacy Best Practice](https://dev.wix.com/docs/build-apps/launch-your-app/legal-and-security/security-and-privacy-best-practice).
- [Identify and Manage App Users](https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/identify-and-manage-app-users).
- [App Instance Installed](https://dev.wix.com/docs/api-reference/app-management/app-instance/app-instance-installed).
- [Common Reasons for App Rejection](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/common-reasons-for-app-rejection).

Rules that need a code or config check:

- **Identity (#115, #116, #118, #122):** identify users and bill per `instanceId`, never by cookie or session. Site duplication creates a new `instanceId`: link it to the original via `originInstanceId` and copy applicable settings and content.
- **Signed instance (#76):** reject a signed `instance` whose `signDate` is older than one day and require a refresh.
- **Webhooks (#113, #114):** App Instance Installed and Removed are recommended for provisioning and cleanup; App Installation Created also fires on the first install. Any implemented webhook returns HTTP 200.
- **Setup (#107, #108):** a settings surface exists (an Embedded Script app needs a dashboard page); no localhost URLs in configuration.
- **Stores (#130):** support Catalog V1 and V3, see [STORES_VERSIONING.md](STORES_VERSIONING.md).
- **Billing evidence (#25, #125):** App Billing and App Plans charge site owners; Pricing Plans SDK usage is not evidence of either.

## Expected Output

Group findings as blockers (likely decline reasons), should-fix, nice-to-have, and needs-confirmation. For each: `Applicability`, `Evidence`, `Impact`, `Recommended fix`, `Verification`, `Confidence`. Do not upgrade `recommended`, `if applicable` or surface-specific guidance into a universal requirement.

---

## Technical Review Taxonomy

Use these IDs for traceability when mapping findings to review feedback.

| # | Requirement | Area |
| --- | --- | --- |
| 25 | Apps collecting money must implement Wix Billing unless an exception is granted. | Billing |
| 29 | Do not use custom mechanisms to unlock content. | Billing |
| 30 | Do not link to purchase mechanisms other than Wix Billing. | Billing |
| 31 | Credits purchased through in-app purchase must not expire. | Billing |
| 33 | Test the checkout flow for each plan. | Billing |
| 35 | No direct user downgrade through the pricing page. | Billing |
| 37 | Display realistic demo data on first install. | UX |
| 39 | Use Wix popup/modal patterns for in-product flows; OAuth and documented upgrade CTAs are exceptions. | UX |
| 44 | Plugin extension content must relate to the host app's core functionality. | Functionality |
| 45 | Avoid disruptive behavior and browser-native `alert()`/`confirm()` boxes. | UX |
| 46 | Do not show ads to site owners except unobtrusive cross-promotion of your own apps. | Advertising |
| 47 | Do not show ads to site visitors unless that is the app purpose and permits exist. | Advertising |
| 48 | Meet startup and load-time expectations. | Performance |
| 49 | Clear known bugs and console errors before submission. | Quality |
| 50 | Multiple website components on the same site must have separate settings. | Multi-instance |
| 51 | Site copy should copy applicable app content/settings, not reset to default state. | Multi-instance |
| 52 | Live-site extensions must be responsive across screen sizes and devices. | Responsive |
| 53 | Website components must be accessible to visitors with disabilities. | Accessibility |
| 54 | Dashboard app surfaces must support the required desktop layout. | Dashboard |
| 55 | Widget components must not render `<h1>` tags. | SEO |
| 56 | Optimize SEO-meaningful content per industry best practices. | SEO |
| 57 | Include accessibility customization such as alt text where applicable. | Accessibility |
| 58 | Use UTF-8 encoding for multilingual text support. | Localization |
| 59 | Test supported desktop browsers. | Browser support |
| 60 | Test live-site extensions on supported mobile browsers. | Browser support |
| 61 | Test live-site extensions on supported tablet browsers. | Browser support |
| 62 | Never request more permissions than required. | Permissions |
| 63 | Store salted password hashes instead of raw passwords. | Security |
| 64 | Protect against CSRF, XSS, and other security vulnerabilities. | Security |
| 65 | Serve the app over HTTPS with a valid certificate. | Security |
| 66 | Do not force login or personal information unless core to the app. | Security |
| 67 | Let users revoke connected social credentials in the app. | Security |
| 68 | Secure and verify each user's identity through the instance. | Identity |
| 69 | Encrypt sensitive data and do not store it in cookies. | Security |
| 72 | Keep app secret key and OAuth tokens secure. | Security |
| 73 | Apps collecting financial data must comply with PCI-DSS and PA-DSS. | Security |
| 74 | Verify signed instance signature server-side. | Security |
| 76 | Validate `signDate` for signed-instance-backed edit/save actions. | Security |
| 77 | All dashboard, editor, and live-site endpoints must support HTTPS. | Security |
| 78 | Prevent XSS in input fields such as comments, forms, search, and titles. | Security |
| 79 | Use secure password hashing. | Security |
| 80 | Add a unique random salt/nonce to each stored password. | Security |
| 81 | Password reset must use an expiring email link, not a raw password. | Security |
| 92 | Comply with site visitor consent policies. | Privacy |
| 97 | Implement cookie consent behavior per visitor preferences. | Privacy |
| 107 | Provide a settings/setup UI. | Setup |
| 108 | Do not use localhost URLs in app configuration. | Setup |
| 111 | Request only minimum necessary permissions. | Permissions |
| 112 | Remove permissions already included in added scopes. | Permissions |
| 113 | App Installed and App Removed webhooks are recommended for lifecycle handling. | Webhooks |
| 114 | Implemented webhooks must return HTTP 200 on successful receipt. | Webhooks |
| 115 | Identify users by `instanceId`, not session/cookies. | Identity |
| 116 | Separate billing for each site. | Billing |
| 117 | Support multi-site account switching or one-account-per-site flows. | Identity |
| 118 | Auto-login when the user reopens the app through Manage Apps. | Identity |
| 119 | Forgotten-password flow must send reset links and avoid raw passwords. | Security |
| 120 | Check required Wix apps and notify the user if missing. | Setup |
| 121 | Review prompts are recommended only; keep them non-blocking if implemented. | UX |
| 122 | Handle site duplication through `originInstanceId`. | Multi-instance |
| 123 | External pricing page is broken or used instead of Wix internal billing. | Billing |
| 125 | Premium features require a clear upgrade path; do not infer app billing from Business Solutions Pricing Plans API usage. | Billing |
| 130 | Apps using Wix Stores catalog data must support Catalog V1 and Catalog V3 — see [STORES_VERSIONING.md](STORES_VERSIONING.md). | Stores |
| 132 | App installation process fails or results in errors. | Installation |
| 133 | Login/session issues occur during or after installation. | Identity |
| 151 | Custom element has quality issues such as pixelated images or missing descriptions. | Component quality |
| 152 | Embedded script has syntax errors, missing parameters, or the wrong type. | Embedded script |
| 154 | Component configuration has a general issue. | Components |
| 158 | Custom element extension is missing settings or does not appear in the editor. | Extensions |
| 159 | Dashboard modal extension purpose is unclear or unnecessary. | Extensions |
| 160 | Dashboard page extension is blank, broken, or violates Wix guidelines. | Extensions |
| 161 | Embedded script is not loading, syncing, or configured correctly. | Extensions |
| 162 | External URL does not open in a new tab or references a non-Wix platform. | Extensions |
| 163 | Required service plugin for a dropshipping app is missing. | Service plugin |
| 166 | Widget extension image or configuration is incorrect. | Extensions |
| 167 | Extension configuration has a general issue. | Extensions |
| 168 | Automations email template contains incorrect text or is active too early. | Automations |
| 169 | App does not follow UX best practices such as defaults or validation warnings. | UX |
| 170 | App behavior is confusing in editor preview compared with the published site. | UX |
