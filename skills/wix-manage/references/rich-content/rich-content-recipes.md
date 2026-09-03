---
name: "Rich Content Recipes"
description: "Ricos rich content — hand-author the richContent/nodes JSON that Wix Blog posts, Stores descriptions, Events and CMS rich-text fields expect, and convert between Ricos and HTML, Markdown or plain text. Use whenever a body of text needs formatting, or the words Ricos, richContent, nodes tree, or rich text appear."
---

# Rich Content Recipes

Any API field that takes formatted text wants a Ricos document, not a string or HTML — passing plain text is the single most common failure across blog, stores, events and CMS. Use **Author Ricos Rich Content** to write or read that JSON directly; use **Ricos Converter Service** when content already exists as HTML, Markdown or plain text and needs converting, or when a document should be validated before it is sent.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Ricos Converter Service](https://dev.wix.com/docs/api-reference/assets/rich-content/skills/ricos-converter-service)
**Technical:** Validates and converts content between Ricos documents and
HTML/Markdown/plain text using the Ricos Documents API. Covers plugin configuration,
format conversion in both directions, and document validation.

### [Author Ricos Rich Content](https://dev.wix.com/docs/api-reference/assets/rich-content/skills/author-ricos-rich-content)
**Technical:** Authoritative recipe for hand-authoring valid Ricos rich-content JSON
(the richContent/nodes tree) used across Wix Blog posts, Stores product descriptions,
Events, and CMS rich-text fields. Use whenever a user asks to create, output, or return
Ricos, richContent, or nodes-tree JSON; retrieve and read this full recipe before API
schema search or constructing the JSON. Covers paragraphs, headings, lists, blockquotes,
dividers, tables, code blocks, images, buttons, audio, video, galleries, collapsible
lists, HTML embeds, inline decorations, and nesting rules.
