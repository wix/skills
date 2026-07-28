---
name: "Create Site from Template"
description: Creates new Wix sites from templates using account-level APIs. Covers template search, site creation, headless business provisioning, and publishing.
---
# Create Site from Template

This recipe guides you through creating a new Wix site from a template, including template selection and optional publishing.

## Prerequisites

- Wix account with site creation permissions
- Account-level API access

## Required APIs

- **Templates Search API**: `GET https://www.wix.com/_api/template-cms-view-service/view/v2/templates/search`
- **Create Site API**: `POST https://www.wixapis.com/msm/v1/meta-site/create-from-template`
- **Publish Site API**: `POST https://www.wixapis.com/site-publisher/v1/site/publish`

---

## Step 1: Understand User Requirements

Before searching templates, gather information:

1. **Ask the user** to describe the site they want in a few sentences
2. **Ask if they want** Wix Editor or Wix Studio
3. **Identify main apps** needed (Stores, Bookings, Blog, etc.)

### Quick Start (Skip Template Search)

If user wants an empty/blank site:
- **Wix Studio blank**: `fe86a14e-ef67-49b4-a409-d086f3abaa1a`
- **Wix Editor blank**: `b55bdf43-95e0-4cef-b9bb-92dcc7af2742`

Skip to Step 3 with these template IDs.

---

## Step 2: Search for Templates

**Endpoint**: `GET https://www.wix.com/_api/template-cms-view-service/view/v2/templates/search`

**Query Parameters**:
| Parameter | Description | Values |
|-----------|-------------|--------|
| `language` | Always use | `en` |
| `limit` | Results per page | `24` |
| `offset` | Pagination offset | Start at `0`, increment by 24 |
| `bookType` | Editor type | `studio` or `main-v2` |
| `query` | Search keywords | `yoga+studio`, `ecommerce`, etc. |

**Example Request**:
```bash
curl -X GET \
  'https://www.wix.com/_api/template-cms-view-service/view/v2/templates/search?language=en&limit=24&offset=0&bookType=studio&query=yoga+studio' \
  -H 'Authorization: <AUTH>'
```

**Response** includes for each template:
- `metaSiteId` - Template ID for creation
- `templateSlug` - For preview URL
- Template name and description
- Color scheme

### Present Templates to User

For each relevant template, show:
- Template name
- Description (without "Click Edit" text)
- "Good for" description
- Color scheme
- Preview link: `https://www.wix.com/website-template/view/html/{templateSlug}`

---

## Step 3: Create the Site

**Endpoint**: `POST https://www.wixapis.com/msm/v1/meta-site/create-from-template`

**Request Body**:
```json
{
  "originTemplateId": "<TEMPLATE_METASITE_ID>",
  "siteName": "my-new-site"
}
```

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/msm/v1/meta-site/create-from-template' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "originTemplateId": "<TEMPLATE_ID>",
    "siteName": "my-new-site"
  }'
```

### Site Name Requirements

The `siteName` must follow these rules:
- 4-20 characters
- Only lowercase letters, numbers, hyphens, underscores
- Pattern: `[a-z0-9_-]{4,20}`
- Must be unique

If `siteName` is not provided, one is generated automatically.

**Response** includes the new site's `metaSiteId`.

### IMPORTANT NOTES:
- This API creates regular Wix sites. Do NOT use it for headless sites (even with a `namespace` field) — see [Headless Sites](#headless-sites) below

---

## Step 4: Publish the Site (Optional)

**Ask the user** if they want to publish their site before proceeding.

**Endpoint**: `POST https://www.wixapis.com/site-publisher/v1/site/publish`

This is a **site-level API** - use the site ID from the creation response.

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/site-publisher/v1/site/publish' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### IMPORTANT NOTES:
- NEVER publish without asking the user first
- This makes the site publicly accessible

---

## Headless Sites

Headless sites are NOT created from templates. One account-level call creates the site, installs the requested Wix Business Solution apps, and creates and configures the site's OAuth client:

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

To provision headless onto an existing site, pass `"existingMetasite": {}` instead of `newMetasite` (site-level call in the context of that site).

---

## Common Template IDs

For quick access without searching:

| Type | Template ID |
|------|-------------|
| Blank (Studio) | `fe86a14e-ef67-49b4-a409-d086f3abaa1a` |
| Blank (Editor) | `b55bdf43-95e0-4cef-b9bb-92dcc7af2742` |
| Store | `b783f9f9-4f4d-4139-9659-cc95a51b9ee5` |
| Bookings/Services | `17b2bf9e-8661-4c92-973c-67502b415e58` |
| Beauty | `0281d415-0682-42ac-b35e-49b349f19332` |

---

## Next Steps

After creating the site:
- Install required apps using [Install Wix Apps](../app-installation/install-wix-apps.md)
- Configure site settings
- Add content (products, services, blog posts, etc.)
