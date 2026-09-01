---
name: "Create Headless Site"
description: Creates a Wix Headless site (headless business) with one account-level API call — site, Wix Business Solution apps, and a configured OAuth client.
---
# Create Headless Site

Headless sites are not created from templates. One account-level call creates the site, installs the requested Wix Business Solution apps, and creates and configures the site's OAuth client.

> Do NOT use the [Create Site from Template](create-site-from-template.md) API for headless sites — it only tags the site's namespace and skips the headless setup entirely.

## Prerequisites

- Wix account with site creation permissions
- Account-level API access

## Provision a Headless Business

**Endpoint**: `POST https://www.wixapis.com/headless-business-setup/v1/headless-business/provision`

**Request Body**:
```json
{
  "newMetasite": {
    "namingStrategy": { "metaSiteName": "My Headless Business" },
    "seedOptions": [
      { "businessSolution": "STORES", "clearTemplateContent": true, "seedDemoContent": false }
    ]
  },
  "synchronousSteps": ["SET_METASITE_NAME", "CONFIGURE_HEADLESS_APP"]
}
```

- `namingStrategy` — exactly one of: `metaSiteName` (exact display name), `llmPromptBasedName: {}` (name derived from the top-level `prompt` field), or `defaultName: {}`
- `seedOptions` — Wix Business Solution apps to install at creation: `STORES`, `BLOG`, `BOOKINGS`, `EVENTS`, `PORTFOLIO`, `PRICING_PLANS`. Each entry takes `clearTemplateContent` (remove sample content) and `seedDemoContent` (seed demo content). Empty installs none
- `synchronousSteps` — steps to complete before the call returns: `SET_METASITE_NAME`, `CONFIGURE_HEADLESS_APP`, `SEED_CONTENT`. Omitted steps run asynchronously. Include `CONFIGURE_HEADLESS_APP` when the OAuth client must be usable immediately

**Response**:
```json
{ "metaSiteId": "<SITE_ID>", "appId": "<OAUTH_CLIENT_ID>" }
```

`appId` is the site's OAuth client ID — do NOT create a separate OAuth app.

## Existing Sites

To provision headless onto an existing site, pass `"existingMetasite": {}` instead of `newMetasite`. This is a site-level call in the context of that site.

## Next Steps

After creating the site:
- Install additional apps using [Install Wix Apps](../app-installation/install-wix-apps.md)
- Add content (products, services, blog posts, etc.)
- Use the `appId` as the `client_id` to mint visitor tokens and make buyer-facing API calls — see [Manage OAuth Apps](manage-oauth-apps.md)
