---
name: "Rich Content Recipes"
description: "Ricos rich content — hand-author the richContent/nodes JSON that Wix Blog posts, Stores descriptions, Events and CMS rich-text fields expect, and convert between Ricos and HTML, Markdown or plain text. Use whenever a body of text needs formatting, or the words Ricos, richContent, nodes tree, or rich text appear."
---

# Rich Content Recipes

Any API field that takes formatted text wants a Ricos document, not a string or HTML — passing plain text is the single most common failure across blog, stores, events and CMS. Use **Author Ricos Rich Content** to write or read that JSON directly; use **Ricos Converter Service** when content already exists as HTML, Markdown or plain text and needs converting, or when a document should be validated before it is sent.

## Recipes

### [Ricos Converter Service](https://dev.wix.com/docs/api-reference/assets/rich-content/skills/ricos-converter-service)
Use when content exists as HTML, Markdown or plain text and needs converting to or from Ricos, or when a document should be validated.

### [Author Ricos Rich Content](https://dev.wix.com/docs/api-reference/assets/rich-content/skills/author-ricos-rich-content)
Use when writing Ricos JSON by hand for a post, description, event or CMS field, or when reading an existing rich-content tree.
