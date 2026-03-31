# Going Live Checklist

## 1. Finding Your Headless Site URL

- `npx @wix/cli preview` prints a unique preview URL in terminal output — look for a URL containing `.wix.dev` or similar in the command output
- `npx @wix/cli release` prints the published site URL, preview URL, and dashboard link
- **After deploying, always surface the URL to the user** — it's their primary way to access the site
- No CLI command to retrieve URLs after deployment — if the terminal output is lost, find URLs in the Wix dashboard
- Dashboard: manage.wix.com > your site > Settings > Domains

## 2. Premium Plan (Required for Payments)

- Wix-hosted checkout requires a premium plan
- Without it: checkout shows "we aren't accepting payments"
- Steps: Wix dashboard > Upgrade / Pricing > select plan with eCommerce

## 3. Payment Methods (Required for Checkout)

- Even with premium, payment methods must be configured
- Steps: Wix dashboard > Settings > Accept Payments > connect provider (Stripe/PayPal/etc.)

## 4. Custom Domain (Optional)

- Default: Wix-managed URL from `npx @wix/cli release`
- Custom: Wix dashboard > Settings > Domains > add domain + DNS config > auto SSL

## Checklist Summary Table

| Step | Required For | Where |
|------|-------------|-------|
| Find deployed URL | All projects | CLI output or Wix dashboard > Settings > Domains |
| Premium plan | Accepting payments | Wix dashboard > Upgrade |
| Payment methods | Processing checkout | Wix dashboard > Settings > Accept Payments |
| Custom domain | Branded URL (optional) | Wix dashboard > Settings > Domains |
