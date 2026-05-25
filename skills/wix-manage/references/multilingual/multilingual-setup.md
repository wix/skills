---
name: "Multilingual Site Setup & Content Translation"
description: The recommended way to make a Wix site multilingual — enable multilingual mode, add locales, define translation schemas, store translated content, and retrieve published translations at runtime. Covers manual and machine translation flows.
---
# Multilingual Site Setup & Content Translation

This recipe documents how to turn a single-language Wix site into a multilingual one: enabling the feature, adding languages, registering what's translatable, populating translations, and serving them to visitors.

## Overview

Setting up multilingual on a site enables:
- Multiple language versions of the same content, keyed off a primary locale
- A translation **schema** describing which fields on an entity are translatable and how (short text, long text, rich content, image)
- Per-locale **content** records that hold the actual translated values
- Visitor-facing retrieval through **published content** (only fields explicitly marked as published are served)

## Architecture at a Glance

```
Locale Settings  ──►  enables multilingual mode (on/off, URL structure)
      │
      ▼
   Locales      ──►  the actual languages on the site (en, fr, de, ...)
      │
      ▼
Translation Schema  ──►  defines which fields on an entityType are translatable
      │
      ▼
Translation Content ──►  the translated values per (schemaId, entityId, locale)
      │
      ▼ (publish)
Published Content   ──►  read-only, visitor-facing translations
```

## Prerequisites

- A Wix site with API access
- An understanding of what entity you're translating (a CMS collection, a custom app's items, page content, etc.). You'll need:
  - **Entity type** — a string identifying the kind of thing being translated (e.g. `"Products"`, `"My-Pet-Collection"`)
  - **Entity ID** — the unique ID of each instance
  - The **fields** that should be translatable

## Step 1: Enable Multilingual Mode

Multilingual must be turned on at the site level before locales can be added.

### API Endpoint

```
POST https://www.wixapis.com/locale-settings/v2/settings/mode
```

### Request

```json
{
  "multilingualModeEnabled": true
}
```

### Successful Response

```json
{
  "localeSettings": {
    "multilingualModeEnabled": true,
    "autoSwitch": true,
    "urlStructure": "SUBDIRECTORY",
    "primaryLocale": {
      "id": "en",
      "languageCode": "en",
      "primaryLocale": true,
      "flag": "USA",
      "regionalFormat": "en-US",
      "machineTranslationCode": "EN",
      "displayName": "English"
    }
  }
}
```

The site's existing language becomes the **primary locale** automatically.

## Step 2: Add Secondary Locales

Each additional language is a separate `Locale` resource.

### API Endpoint

```
POST https://www.wixapis.com/locales/v2/locale
```

### Locale Schema

| Key | Description | Required |
|-----|-------------|----------|
| `languageCode` | ISO language code (e.g. `"fr"`, `"de"`, `"es"`) | Yes |
| `regionCode` | Optional region (e.g. `"FR"`, `"CA"`) | No |
| `visibility` | `"VISIBLE"` or `"HIDDEN"` | No (default VISIBLE) |
| `flag` | Flag identifier to display in the language switcher | No |

### Example: Add French

```json
{
  "locale": {
    "languageCode": "fr",
    "visibility": "VISIBLE",
    "flag": "FRA"
  }
}
```

### Successful Response

```json
{
  "locale": {
    "id": "fr",
    "languageCode": "fr",
    "visibility": "VISIBLE",
    "primaryLocale": false,
    "flag": "FRA",
    "regionalFormat": "fr-FR",
    "machineTranslationCode": "FR",
    "displayName": "French"
  }
}
```

### List Locales on the Site

```
POST https://www.wixapis.com/locales/v2/locale/query
```

```json
{ "query": {} }
```

> **Tip:** Use `GET /v2/locales/supported` first to see which language codes Wix supports.

## Step 3: Define a Translation Schema

A **schema** tells Wix which fields on a given entity type are translatable and what type of content each holds. One schema per entity type per scope.

### API Endpoint

```
POST https://www.wixapis.com/translation-schema/v1/schemas
```

### Key fields

| Key | Description | Required |
|-----|-------------|----------|
| `key.entityType` | String identifier for the entity (e.g. `"Products"`) | Yes |
| `key.scope` | `"SITE"` or `"GLOBAL"` | Yes |
| `fields` | Map of field key → field definition | Yes |

### Supported field types

| Type | Use for |
|------|---------|
| `SHORT_TEXT` | Titles, names, labels |
| `LONG_TEXT` | Descriptions, plain paragraphs |
| `RICH_CONTENT` | Formatted text (Ricos rich content) |
| `IMAGE` | Localized images |

### Example: Schema for a "Products" entity

```json
{
  "schema": {
    "key": {
      "entityType": "Products",
      "scope": "SITE"
    },
    "fields": {
      "title": {
        "type": "SHORT_TEXT",
        "displayName": "Product Title",
        "minLength": 1,
        "maxLength": 100
      },
      "description": {
        "type": "RICH_CONTENT",
        "displayName": "Product Description"
      },
      "image": {
        "type": "IMAGE",
        "displayName": "Product Image"
      }
    }
  }
}
```

### Successful Response

```json
{
  "schema": {
    "id": "377a6a55-8c2b-47fe-99ba-b51cc63d71a3",
    "key": {
      "appId": "<your-app-id>",
      "entityType": "Products",
      "scope": "SITE"
    },
    "fields": { "...": "..." },
    "revision": "1"
  }
}
```

Keep the returned `schema.id` — it links every translation back to this definition.

## Step 4: Create Translation Content

For each (entity, locale) pair, store the translated field values. Use the bulk endpoint when you have multiple items.

### API Endpoint

```
POST https://www.wixapis.com/translation-content/v1/bulk/contents/create
```

### Content Schema

| Key | Description | Required |
|-----|-------------|----------|
| `schemaId` | ID from Step 3 | Yes |
| `entityId` | ID of the specific item being translated | Yes |
| `locale` | Target locale (e.g. `"fr"`) | Yes |
| `fields` | Map of field key → translated value | Yes |

### Example: Translate one product into French

```json
{
  "contents": [
    {
      "schemaId": "377a6a55-8c2b-47fe-99ba-b51cc63d71a3",
      "entityId": "product-001",
      "locale": "fr",
      "fields": {
        "title":       { "textValue": "T-shirt avec logo" },
        "description": { "textValue": "T-shirt en coton premium avec logo" }
      }
    }
  ],
  "returnEntity": true
}
```

### Update a Single Field (by Key)

When you only need to update a specific entity's translation, use `update-by-key` (no need to look up the content ID first):

```
PATCH https://www.wixapis.com/translation-content/v1/contents/by-key
```

```json
{
  "content": {
    "schemaId": "377a6a55-8c2b-47fe-99ba-b51cc63d71a3",
    "entityId": "product-001",
    "locale": "fr",
    "fields": {
      "title": { "textValue": "T-shirt logoté" }
    }
  }
}
```

### Request

```json
{
  "sourceLanguage": "EN",
  "targetLanguage": "FR",
  "contentToTranslate": {
    "id": "product-001-title",
    "format": "PLAIN_TEXT",
    "plainTextContent": "Logo T-Shirt"
  }
}
```

### Response

```json
{
  "translatedContent": {
    "id": "product-001-title",
    "format": "PLAIN_TEXT",
    "plainTextContent": "T-shirt avec logo"
  }
}
```

### Check Credits Before Bulk Operations

Machine translation consumes credits only for non Harmony editor. Before bulk-translating, verify there's enough budget:

```
GET https://www.wixapis.com/machine-translation/v1/credit
```

```
POST https://www.wixapis.com/machine-translation/v1/credit/is-eligible
```

For large batches, use `POST /v3/bulk-machine-translate`.

## Complete Workflow Example

### 1. Turn on multilingual mode

```json
// POST /locale-settings/v2/settings/mode
{ "multilingualModeEnabled": true }
```

### 2. Add French as a secondary locale

```json
// POST /locales/v2/locale
{ "locale": { "languageCode": "fr", "visibility": "VISIBLE", "flag": "FRA" } }
```

### 3. Register a translation schema

```json
// POST /translation-schema/v1/schemas
{
  "schema": {
    "key": { "entityType": "Products", "scope": "SITE" },
    "fields": {
      "title":       { "type": "SHORT_TEXT", "displayName": "Title" },
      "description": { "type": "RICH_CONTENT", "displayName": "Description" }
    }
  }
}
```

### 4. Machine-translate the source text

```json
// POST /machine-translation/v3/machine-translate
{
  "sourceLanguage": "EN",
  "targetLanguage": "FR",
  "contentToTranslate": {
    "id": "product-001-title",
    "format": "PLAIN_TEXT",
    "plainTextContent": "Logo T-Shirt"
  }
}
```

### 5. Save the translation

```json
// POST /translation-content/v1/bulk/contents/create
{
  "contents": [{
    "schemaId": "<id-from-step-3>",
    "entityId": "product-001",
    "locale": "fr",
    "fields": {
      "title": { "textValue": "T-shirt avec logo" }
    }
  }]
}
```

### 6. Publish, then query for visitors

After flipping `published: true` on the fields:

```json
// POST /translation-published-content/v3/published-contents/query
{
  "query": {
    "filter": {
      "schemaKey.entityType": { "$eq": "Products" },
      "locale": { "$eq": "fr" }
    }
  }
}
```

## Important Notes

### Scope: SITE vs GLOBAL

- `SITE` — schema applies only to this site. Use for site-specific entities (CMS collections, custom content).
- `GLOBAL` — schema is shared across all sites of an app. Use when you ship a multi-tenant app whose entity shape is identical everywhere.

### URL Structure

The `urlStructure` on locale settings (`SUBDIRECTORY` like `/fr/`, `SUBDOMAIN` like `fr.example.com`) determines how localized pages are served. Set once and avoid changing — it affects SEO.

### Published vs Unpublished

Translation Content has two layers:
- **Editing layer** (`/translation-content/...`) — drafts, including unpublished fields. Used by translators and dashboards.
- **Published layer** (`/translation-published-content/...`) — read-only snapshot of published fields. Used at runtime by the site.

Never read from the editing layer for visitor-facing rendering — it can leak unreviewed translations.

### Field Key Conventions

Field keys in the schema must match the keys you send in content `fields`. Keep them stable; renaming a key breaks existing translations.

### Differences from Translating Free-Form Page Content

| Feature | This recipe (Translation API) | Wix Editor Multilingual UI |
|---------|------------------------------|----------------------------|
| What's translated | Structured data on entities (CMS items, app records) | Page text, buttons, menus |
| How translations are made | API calls (programmatic) | Manual through the editor |
| Best for | Apps, dynamic content, CMS-driven sites | Static page copy |
| Machine translation | Via Machine Translate API | Built into the editor |

For static page text, the editor's multilingual panel is simpler. For programmatic content, use this API.

## Error Handling

### Common Errors

**Multilingual not enabled**
```json
{ "message": "Multilingual mode is not enabled for this site." }
```
Solution: Run Step 1 first.

**Schema key already exists**
```json
{ "message": "A schema with this entityType and scope already exists." }
```
Solution: Use `Get Schema By Key` to fetch the existing schema, then `Update Schema` rather than creating a new one.

**Locale not found**
```json
{ "message": "Locale 'fr' does not exist on this site." }
```
Solution: Add the locale via Step 2 before creating content for it.

**Field not in schema**
```json
{ "message": "Field 'subtitle' is not defined in schema <schemaId>." }
```
Solution: Either remove the field from the content payload, or update the schema to include it.

**Insufficient machine translation credits**
```json
{ "message": "Not enough credits for this translation request." }
```
Solution: Call `/v1/credit/is-eligible` before bulk operations; top up via the dashboard.

## See Also

- [Locales API](https://dev.wix.com/docs/api-reference/business-management/multilingual/locale-management/locales)
- [Locale Settings API](https://dev.wix.com/docs/api-reference/business-management/multilingual/locale-management/locale-settings)
- [Translation Schema API](https://dev.wix.com/docs/api-reference/business-management/multilingual/translation/translation-schema)
- [Translation Content API](https://dev.wix.com/docs/api-reference/business-management/multilingual/translation/translation-content)
- [Translation Published Content API](https://dev.wix.com/docs/api-reference/business-management/multilingual/translation/translation-published-content)
- [Machine Translation API](https://dev.wix.com/docs/api-reference/business-management/multilingual/machine-translation/machine-translation)
