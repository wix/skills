---
name: "Create Site from Template"
description: Creates new Wix sites from known template IDs using the Projects API. Covers supported template selection, site creation, headless project setup, OAuth app creation, and publishing.
---
# Create Site from Template

This recipe guides you through creating a new Wix site from a known template ID with the public Projects API, including supported template selection and optional publishing.

## Prerequisites

- Wix account with site creation permissions
- Account-level API access

## Required APIs

- **Create Project API**: `POST https://www.wixapis.com/funnel/projects/v1/create`
- **Publish Site API**: `POST https://www.wixapis.com/site-publisher/v1/site/publish`

---

## Step 1: Understand User Requirements

Before choosing a template source, gather information:

1. **Ask the user** to describe the site they want in a few sentences
2. **Ask if they want** Wix Editor or Wix Studio
3. **Identify main apps** needed (Stores, Bookings, Blog, etc.)

### Quick Start (Skip Template Search)

If user wants an empty/blank site:
- Use `type: "WIX"` and omit `templateId`; the Projects API defaults to a blank template.

Skip to Step 3.

---

## Step 2: Choose a Supported Template Source

Wix MCP cannot search the Wix template catalog from this recipe.

Do **not** call `GET https://www.wix.com/_api/template-cms-view-service/view/v2/templates/search` from `CallWixSiteAPI` or `ExecuteWixAPI`. That catalog URL is an internal `www.wix.com` endpoint and is blocked by the Wix MCP execution host policy (`403 Forbidden: requests to www.wix.com not allowed`).

Use one of these supported paths instead:

1. **Known template ID**: If the user already has a template GUID from an approved source, use it as `templateId` in Step 3.
2. **Published template ID list**: Read the [Site Template IDs](https://dev.wix.com/docs/api-reference/account-level/sites/projects/site-template-ids) article and choose a listed template that fits the user's request.
3. **Designed template browsing**: If the user wants a visual/designed template and no listed ID fits, ask them to browse the Wix Template gallery manually, or provide an approved template ID. Do not claim you can fetch or search the catalog from Wix MCP.

A template preview URL such as `https://www.wix.com/website-template/view/html/{templateSlug}` is useful for the user to identify a design, but the Projects API request needs the actual template GUID. Do not pass a preview slug as `templateId`.

---

## Step 3: Create the Site

**Endpoint**: `POST https://www.wixapis.com/funnel/projects/v1/create`

**Request Body**:
```json
{
  "type": "WIX",
  "name": "My New Site",
  "templateId": "<TEMPLATE_ID>"
}
```

Omit `templateId` to create a blank Wix site.

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/funnel/projects/v1/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -H 'wix-account-id: <ACCOUNT_ID>' \
  -d '{
    "type": "WIX",
    "name": "My New Site",
    "templateId": "<TEMPLATE_ID>"
  }'
```

### Project Name Requirements

The `name` is the project name displayed in the project dashboard.

If `name` is not provided, Wix may generate one automatically.

### For Headless Sites

Use `"type": "HEADLESS"` instead of `"WIX"`:

```json
{
  "type": "HEADLESS",
  "name": "My Headless Backend"
}
```

**Response** includes `project.metaSiteId`, `project.siteId`, and `project.templateId`.

### IMPORTANT NOTES:
- Only mention headless if user specifically requests it
- If user doesn't ask for headless, do NOT include the `namespace` field

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

## Step 5: For Headless Sites - Create OAuth App

If the site was created as headless, you MUST create an OAuth app for authentication.

See [Create OAuth App](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/create-oauth-app) documentation.

This is a site-level call in the context of the newly created site.

---

## Common Template IDs

These examples come from the [Site Template IDs](https://dev.wix.com/docs/api-reference/account-level/sites/projects/site-template-ids) article.

| Type | Template ID | Style |
|------|-------------|-------|
| AI tech company | `a8c8f960-abe7-41d5-be33-ccba1bb56aa4` | Modern |
| Cyber security company | `c117d77c-c545-40f2-8a70-4b16fcd7d0ec` | Dark |
| Law firm | `7375da5f-e9e0-4fb5-af3b-d28ddb7531f1` | Minimalist |
| City tours | `ec94402c-e1ab-42ec-8573-0848940c660a` | Illustrative |
| Hair salon | `950aacb3-5c15-48e6-b85d-95c2ab8d7ecf` | Minimalist |
| Electronics store | `9b6ae83a-02a6-4c47-8816-bade636b412e` | Minimalist |
| Online beauty store | `21948e45-bd20-49e9-8479-c96827af41c9` | Modern |

---

## Next Steps

After creating the site:
- Install required apps using [Install Wix Apps](../app-installation/install-wix-apps.md)
- Configure site settings
- Add content (products, services, blog posts, etc.)
