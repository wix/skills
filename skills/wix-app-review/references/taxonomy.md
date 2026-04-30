# Wix App Market — Technical Review Taxonomy

Technically reviewable decline reasons covered by the current phased version of
the skill. Manual App Dashboard, Dev Center, and listing-copy checks are
intentionally excluded from this file. Each item is tagged:
- 🔵 **Code / Technical** — must be implemented in code
- 🟣 **Process / Info** — informational about the review process

---

## Payment & Pricing

| # | Requirement | Type | Review |
|---|---|---|---|
| 25 | All apps collecting money must implement Wix Billing System (unless exception granted) | 🔵 Code / Technical | Manual |
| 29 | Don't use own mechanisms to unlock content (license keys, QR codes, etc.) | 🔵 Code / Technical | Manual |
| 30 | No buttons/links directing to purchasing mechanisms other than Wix Billing | 🔵 Code / Technical | Manual |
| 31 | Credits purchased via in-app purchase must not expire | 🔵 Code / Technical | Manual |
| 33 | Test entire checkout flow for each plan | 🔵 Code / Technical | Manual |
| 35 | No user downgrades through pricing page (cancel + repurchase required) | 🔵 Code / Technical | Manual |
| 123 | External pricing page is broken or used instead of Wix internal billing | 🔵 Code / Technical | Manual |
| 125 | If the app has premium features, there must be a clear upgrade link/flow; do not infer app billing decisions from Business Solutions Pricing Plans SDK usage | 🔵 Code / Technical | Manual |

## App Experience – Design

| # | Requirement | Type | Review |
|---|---|---|---|
| 37 | Display demo data (not Lorem ipsum) when app is first added to a site | 🔵 Code / Technical | Manual |
| 39 | Use Wix popup/modal for in-product flows instead of browser-native popups; OAuth and documented Wix pricing-page upgrade CTAs are exceptions | 🔵 Code / Technical | Manual |

## App Experience – Functionality

| # | Requirement | Type | Review |
|---|---|---|---|
| 44 | Plugin extension content must relate to host app's core functionality | 🔵 Code / Technical | Manual |
| 130 | If the app supports Wix Catalog, it must support both Catalog V1 and Catalog V3 | 🔵 Code / Technical | Manual |
| 132 | App installation process fails or results in errors | 🔵 Code / Technical | Manual |
| 133 | Login / session issues during or after installation | 🔵 Code / Technical | Manual |

## App Experience – Advertising

| # | Requirement | Type | Review |
|---|---|---|---|
| 45 | No distracting/annoying behavior; no JavaScript alert/confirmation boxes | 🔵 Code / Technical | Manual |
| 46 | No ads displayed to site owners (except unobtrusive cross-promotion of your own apps) | 🔵 Code / Technical | Manual |
| 47 | No ads shown to site visitors (unless ad display is the app's purpose with proper permits) | 🔵 Code / Technical | Manual |

## Technical – Performance

| # | Requirement | Type | Review |
|---|---|---|---|
| 48 | Fast startup (400ms or faster) and load times | 🔵 Code / Technical | Manual |
| 49 | QA app before submission; errors and bugs cause rejection | 🔵 Code / Technical | Manual |

## Technical – Multi-Instance

| # | Requirement | Type | Review |
|---|---|---|---|
| 50 | Differentiate between multiple website components on same site with separate settings | 🔵 Code / Technical | Manual |
| 51 | Site copy must copy app content and settings (not default version) | 🔵 Code / Technical | Manual |

## Technical – Responsive

| # | Requirement | Type | Review |
|---|---|---|---|
| 52 | App must be responsive and optimized for all screen sizes and devices | 🔵 Code / Technical | Manual |
| 53 | Website components must be accessible to all visitors including those with disabilities | 🔵 Code / Technical | Manual |
| 54 | Dashboard app must be full screen (min 1200px width) and responsive | 🔵 Code / Technical | Manual |

## Technical – SEO

| # | Requirement | Type | Review |
|---|---|---|---|
| 55 | Widget components must not use `<h1>` tags in HTML | 🔵 Code / Technical | Manual |
| 56 | Optimize SEO-meaningful content per industry best practices | 🔵 Code / Technical | Manual |

## Technical – Frontend/Backend

| # | Requirement | Type | Review |
|---|---|---|---|
| 57 | Include accessibility customization in settings panel (e.g., alt-text for images) | 🔵 Code / Technical | Manual |
| 58 | UTF-8 encode app for multi-language text support | 🔵 Code / Technical | Manual |

## Technical – Browser Support

| # | Requirement | Type | Review |
|---|---|---|---|
| 59 | Test on Chrome 115+, Safari 16.4+, Edge 115+, Firefox 116+ (See latest Wix Supported Browsers - https://support.wix.com/en/article/supported-devices-browsers-and-operating-systems) | 🔵 Code / Technical | Manual |
| 60 | For live site extensions, test on mobile: Chrome Android, Chrome iPhone, Safari iPhone 7+ (See latest Wix Support Browsers - https://support.wix.com/en/article/supported-devices-browsers-and-operating-systems) | 🔵 Code / Technical | Manual |
| 61 | For live site extensions, test on tablet/iPad: Chrome and Safari | 🔵 Code / Technical | Manual |

## Security

| # | Requirement | Type | Review |
|---|---|---|---|
| 62 | Never request more permissions than required for app functionality | 🔵 Code / Technical | Manual |
| 63 | Use stored salted password hashes (per OWASP), not actual passwords | 🔵 Code / Technical | Manual |
| 64 | Protect against CSRF, XSS, and other security vulnerabilities | 🔵 Code / Technical | Manual |
| 65 | App must be served over HTTPS with valid SSL certificate | 🔵 Code / Technical | Manual + Automated |
| 66 | Don't force login or request personal info unless core to functionality | 🔵 Code / Technical | Manual |
| 67 | Users must be able to revoke social media credentials within the app | 🔵 Code / Technical | Manual |
| 68 | Secure and verify each user's identity (Instance ID) | 🔵 Code / Technical | Manual |
| 69 | All sensitive data must be encrypted and not stored in cookies | 🔵 Code / Technical | Manual |
| 72 | Keep app secret key and OAuth tokens secure | 🔵 Code / Technical | Manual |
| 73 | Apps collecting financial data must comply with PCI-DSS and PA-DSS | 🔵 Code / Technical | Manual |
| 74 | Verify signed instance signature matches on server side | 🔵 Code / Technical | Manual |
| 76 | Validate signDate for signed-instance-backed edit/save actions – require refresh if the signature is older than one day | 🔵 Code / Technical | Manual |
| 77 | All endpoints must support HTTPS (Dashboard, Editor, live sites) | 🔵 Code / Technical | Manual |
| 78 | Prevent XSS in all input fields (comments, forms, search, titles, etc.) | 🔵 Code / Technical | Manual |
| 79 | Use secure password hashing (SHA-256 or bcrypt) – no raw password storage | 🔵 Code / Technical | Manual |
| 80 | Add unique random salt/nonce to each stored password | 🔵 Code / Technical | Manual |
| 81 | Password reset via email link (not raw password), expiring in 1–2 hours | 🔵 Code / Technical | Manual |

## Legal / Privacy

| # | Requirement | Type | Review |
|---|---|---|---|
| 92 | Comply with site visitor consent policies (cookies) | 🔵 Code / Technical | Manual |
| 97 | Implement cookie consent workflow per visitor preferences | 🔵 Code / Technical | Manual |

## Setup, Permissions & Webhooks

| # | Requirement | Type | Review |
|---|---|---|---|
| 107 | App must provide a settings/setup UI (dashboard page, widget, or other relevant surface; Embedded Script apps require a dashboard page) | 🔵 Code / Technical | Automated + Manual |
| 108 | URLs must not be on localhost | 🔵 Code / Technical | Automated |
| 111 | Request only minimum necessary permissions | 🔵 Code / Technical | Manual |
| 112 | Remove permissions already included in added scopes | 🔵 Code / Technical | Manual |
| 113 | App Installed and App Removed webhooks are recommended for lifecycle handling, not a hard requirement | 🔵 Code / Technical | Manual |
| 114 | If a webhook is implemented, it must return HTTP 200 on successful receipt | 🔵 Code / Technical | Automated |

## App Behavior

| # | Requirement | Type | Review |
|---|---|---|---|
| 115 | Identify users by instanceId (not session/cookies) across multiple sites | 🔵 Code / Technical | Manual |
| 116 | Separate billing for each site | 🔵 Code / Technical | Manual |
| 117 | Support multi-site account switching or one-account-per-site flow | 🔵 Code / Technical | Manual |
| 118 | Auto-login flow when user reopens app via Manage Apps (based on instanceId) | 🔵 Code / Technical | Manual |
| 119 | Forgotten password flow must work correctly (email reset link, no plaintext passwords) | 🔵 Code / Technical | Manual |
| 120 | Check required Wix apps (Stores, Bookings) via Get App Instance API and notify user if missing | 🔵 Code / Technical | Manual |
| 121 | Review modal in app flow is recommended, not required | 🔵 Code / Technical | Manual |
| 122 | Handle site duplication (originInstanceId) by treating it as a new instance linked to the original install and copying applicable settings/content | 🔵 Code / Technical | Manual |

## Components

*Individual component-level issues — custom elements, embedded scripts, and widgets.*

| # | Requirement | Type | Review |
|---|---|---|---|
| 151 | Custom element has quality issues (pixelated images, missing descriptions) | 🔵 Code / Technical | Manual |
| 152 | Embedded script has syntax errors, missing parameters, or wrong type | 🔵 Code / Technical | Manual |
| 154 | Component configuration issue (general) | 🔵 Code / Technical | Manual |

## Extensions

*Extension-type-specific issues — each extension type has its own common failure modes.*

| # | Requirement | Type | Review |
|---|---|---|---|
| 158 | Custom element extension is missing settings or not appearing in editor | 🔵 Code / Technical | Manual |
| 159 | Dashboard modal extension purpose is unclear or unnecessary | 🔵 Code / Technical | Manual |
| 160 | Dashboard page extension is blank, broken, or violates Wix guidelines | 🔵 Code / Technical | Manual |
| 161 | Embedded script is not loading, not syncing, or incorrectly configured | 🔵 Code / Technical | Manual |
| 162 | External URL does not open in a new tab or references a non-Wix platform | 🔵 Code / Technical | Manual |
| 163 | Service plugin required for dropshipping apps is missing | 🔵 Code / Technical | Manual |
| 166 | Widget extension image or configuration is incorrect | 🔵 Code / Technical | Manual |
| 167 | Extension configuration issue (general) | 🔵 Code / Technical | Manual |

## Automations

| # | Requirement | Type | Review |
|---|---|---|---|
| 168 | Automations email template contains incorrect text or is set to active prematurely | 🔵 Code / Technical | Manual |

## UX Remarks

| # | Requirement | Type | Review |
|---|---|---|---|
| 169 | App does not follow UX best practices (missing defaults or validation warnings) | 🔵 Code / Technical | Manual |
| 170 | App behavior is confusing in editor preview vs. published site | 🔵 Code / Technical | Manual |
