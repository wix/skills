---
name: "Author Ricos Rich Content"
description: Authoritative recipe for hand-authoring valid Ricos rich-content JSON (the richContent/nodes tree) used across Wix Blog posts, Stores product descriptions, Events, and CMS rich-text fields. Use whenever a user asks to create, output, or return Ricos, richContent, or nodes-tree JSON; retrieve and read this full recipe before API schema search or constructing the JSON. Covers paragraphs, headings, lists, blockquotes, dividers, tables, code blocks, images, buttons, audio, video, galleries, collapsible lists, HTML embeds, inline decorations, and nesting rules.
---

# Author Ricos Rich Content

> **Routing rule (READ FIRST).** When hand-authoring or returning Ricos / `richContent` JSON, use **this recipe** — the shapes, nesting rules, spacer paragraphs, and plugin nodes below. Do not rely on API schema search alone; it misses those details. After this recipe loads, do not perform additional schema or documentation searches for node types covered here; compose and self-audit the JSON from this file. When the user only wants JSON output, **do not** call Ricos convert/validate APIs.

Ricos is Wix's rich-content format — a tree of typed nodes serialized as JSON. The same structure is embedded by many products: a Blog post's `draftPost.richContent`, a Store product's rich description, an Events description, and CMS rich-text fields all expect a Ricos document. This recipe is the **authoring reference for that node tree**: the valid shape of each node, how nodes nest, and how to format text. It is intentionally product-agnostic — the consuming API decides *where* the document goes; this recipe governs *what a valid document looks like*.

> A Ricos document is an object with a `nodes` array: `{ "nodes": [ /* block nodes */ ] }`. Whatever field the consuming API exposes (e.g. `richContent`), it holds this object. For validating or converting an existing document to/from HTML/Markdown, see [Ricos Converter Service](ricos-converter-service.md).

## Universal rules for every node

- **`type` is always a bare string** — `"type": "PARAGRAPH"`, never an object like `"type": { "type": "PARAGRAPH" }`. An object-valued `type` may pass a shallow validation but renders as a broken/uneditable block.
- Every node carries a `type`, an optional `id`, and (for container nodes) a `nodes` array of children. Node `id`s are optional when authoring for a create request — the API generates them; the examples below omit `id` for brevity.
- **TEXT is a leaf.** A TEXT node only ever lives inside a `PARAGRAPH`, `HEADING`, or `CODE_BLOCK`. It must **never** sit directly in the root `nodes` array or inside a `LIST_ITEM`, `BLOCKQUOTE`, or `TABLE_CELL` — those must contain a `PARAGRAPH` (or `HEADING`) that then contains the TEXT. See [Nesting rules](#nesting-rules).
- Failing to wrap TEXT correctly produces the parse error **"Expected a paragraph node but found TEXT"**.
- **Block nodes do not get automatic vertical gap when rendered** — insert empty `PARAGRAPH` spacer nodes between sibling blocks when you need breathing room. See [Vertical spacing between blocks](#vertical-spacing-between-blocks).

## Required plugin shape checklist

Use this checklist while composing and again before returning JSON. Treat every path below as required for the described request:

- **Button CTA:** emit a root-level `BUTTON`, never a `PARAGRAPH` with an inline `LINK`. Include `buttonData.type: "LINK"`, `buttonData.text`, `buttonData.link.url`, `buttonData.link.target`, and `buttonData.containerData`.
- **Hosted audio:** emit `{ "type": "AUDIO", "nodes": [], "audioData": { ... } }`. The empty `nodes` array is on the AUDIO node beside `audioData` — never inside `audioData`. Include `audioData.containerData.alignment`, `width`, and `textWrap`, plus `audioData.audio.src.id`.
- **Video with thumbnail:** place `videoData.video.src` and `videoData.video.duration` inside `video`; place `videoData.thumbnail` beside `video`, with `src.id`, `width`, and `height`.
- **Gallery:** emit one root-level `GALLERY`. Put images in `galleryData.items`, not as child IMAGE nodes. Every item uses `image.media` with `src`, `width`, and `height`; include `galleryData.options.layout.type` and `numberOfColumns`.
- **Collapsible FAQ:** use `COLLAPSIBLE_LIST → COLLAPSIBLE_ITEM → COLLAPSIBLE_ITEM_TITLE | COLLAPSIBLE_ITEM_BODY → PARAGRAPH → TEXT`. Every PARAGRAPH includes `paragraphData`, and every item includes both title and body.
- **HTML embed:** emit a root-level `HTML` with `htmlData.source`, either `url` or `html`, and `htmlData.containerData.width`, `height`, and `alignment`.

## Vertical spacing between blocks

The renderer does **not** add margin between stacked block nodes. Adjacent paragraphs, headings, images, videos, tables, collapsible lists, buttons, galleries, and other blocks will sit flush against each other unless you separate them explicitly.

**Use an empty `PARAGRAPH` as a spacer** — a paragraph with no `nodes` (no TEXT children):

```json
{ "type": "PARAGRAPH" }
```

Place spacer paragraphs at the root `nodes` level (or inside a `CARD` page) wherever layout needs vertical rhythm:

- **After headings** — before the following body copy or media block.
- **Between paragraphs** — when two text blocks should not run together visually.
- **After block plugins** — images, videos, audio, galleries, tables, collapsible lists, HTML embeds, buttons, dividers, and lists often need a spacer before the **next distinct section** (not between every adjacent block in a minimal snippet the user enumerated).
- **After blockquotes** — only when the following block is a separate section; skip the spacer when the user asked for a blockquote immediately followed by a specific paragraph in one compact output.
- **Before major sections** — optional extra spacer when transitioning from one content group to another.

When the user requests **only** specific nodes in one JSON output (e.g. "a blockquote and then a paragraph"), include exactly those nodes — do not add spacer paragraphs they did not ask for.

Do **not** rely on `\n` inside `textData.text` for spacing — that does not create a real line break between blocks. Do **not** expect `paragraphData` margins or `containerData` alone to separate unrelated sibling nodes; the empty paragraph is the supported spacing mechanism.

**Example — spacer after an image and before a table:**

```json
{
  "nodes": [
    { "type": "IMAGE", "imageData": { /* … */ } },
    { "type": "PARAGRAPH" },
    { "type": "TABLE", "nodes": [ /* … */ ], "tableData": { /* … */ } },
    { "type": "PARAGRAPH" },
    { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Next section.", "decorations": [] } } ], "paragraphData": {} }
  ]
}
```

## Block node shapes

**PARAGRAPH** — the base text container. An empty paragraph — `{ "type": "PARAGRAPH" }` — is the **vertical spacer** between block nodes (the renderer adds no gap on its own). See [Vertical spacing between blocks](#vertical-spacing-between-blocks). `paragraphData.textStyle.textAlignment` accepts `AUTO`·`LEFT`·`CENTER`·`RIGHT`·`JUSTIFY`:

```json
{
  "type": "PARAGRAPH",
  "nodes": [
    { "type": "TEXT", "textData": { "text": "Body copy.", "decorations": [] } }
  ],
  "paragraphData": { "textStyle": { "textAlignment": "AUTO" } }
}
```

**HEADING** — same TEXT-in-container shape as PARAGRAPH, with the level (1–6) in `headingData`:

```json
{
  "type": "HEADING",
  "nodes": [
    { "type": "TEXT", "textData": { "text": "Section Title", "decorations": [] } }
  ],
  "headingData": { "level": 2, "textStyle": { "textAlignment": "AUTO" } }
}
```

**BULLETED_LIST / ORDERED_LIST** — nesting is `LIST → LIST_ITEM → PARAGRAPH → TEXT`. Ordered lists use `orderedListData` in place of `bulletedListData`:

```json
{
  "type": "BULLETED_LIST",
  "nodes": [
    {
      "type": "LIST_ITEM",
      "nodes": [
        {
          "type": "PARAGRAPH",
          "nodes": [
            { "type": "TEXT", "textData": { "text": "First item", "decorations": [] } }
          ]
        }
      ]
    }
  ],
  "bulletedListData": { "indentation": 0 }
}
```

**BLOCKQUOTE** — wraps a PARAGRAPH (never a bare TEXT):

```json
{
  "type": "BLOCKQUOTE",
  "nodes": [
    {
      "type": "PARAGRAPH",
      "nodes": [
        { "type": "TEXT", "textData": { "text": "A quoted line.", "decorations": [] } }
      ]
    }
  ],
  "blockquoteData": { "indentation": 1 }
}
```

**DIVIDER** — a standalone horizontal rule (no children). `lineStyle`: `SINGLE`·`DOUBLE`·`DASHED`·`DOTTED`; `width`: `LARGE`·`MEDIUM`·`SMALL`:

```json
{
  "type": "DIVIDER",
  "dividerData": { "lineStyle": "SINGLE", "width": "LARGE", "alignment": "CENTER" }
}
```

**TABLE** — nesting is `TABLE → TABLE_ROW → TABLE_CELL → PARAGRAPH → TEXT`. `tableData.dimensions.colsWidthRatio` sets relative column widths. Fill a header row or zebra-stripe body rows with `tableCellData.cellStyle.backgroundColor` (a hex string):

```json
{
  "type": "TABLE",
  "nodes": [
    {
      "type": "TABLE_ROW",
      "nodes": [
        {
          "type": "TABLE_CELL",
          "tableCellData": { "cellStyle": { "verticalAlignment": "MIDDLE", "backgroundColor": "#116DFF" }, "borderColors": {} },
          "nodes": [
            { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Header A", "decorations": [] } } ] }
          ]
        },
        {
          "type": "TABLE_CELL",
          "tableCellData": { "cellStyle": { "verticalAlignment": "MIDDLE", "backgroundColor": "#116DFF" }, "borderColors": {} },
          "nodes": [
            { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Header B", "decorations": [] } } ] }
          ]
        }
      ]
    }
  ],
  "tableData": { "dimensions": { "colsWidthRatio": [50, 50], "colsMinWidth": [120, 120], "rowsHeight": [47] } }
}
```

**CODE_BLOCK** — children are TEXT nodes (one per line, or `\n`-joined):

```json
{ "type": "CODE_BLOCK", "nodes": [ { "type": "TEXT", "textData": { "text": "const x = 1;", "decorations": [] } } ], "codeBlockData": { "textStyle": { "textAlignment": "AUTO" } } }
```

**IMAGE** — references a Wix Media `id` (upload/import the image first via Media Manager; a raw external URL will not render). Requires `width` and `height`. An optional `CAPTION` child holds a TEXT node:

```json
{
  "type": "IMAGE",
  "nodes": [
    { "type": "CAPTION", "nodes": [ { "type": "TEXT", "textData": { "text": "Figure 1", "decorations": [] } } ] }
  ],
  "imageData": {
    "containerData": { "width": { "size": "CONTENT" }, "alignment": "CENTER" },
    "image": { "src": { "id": "mediaId" }, "width": 900, "height": 600 },
    "altText": "Descriptive alt text"
  }
}
```

**BUTTON** — a standalone call-to-action block. **Not the same as an inline `LINK` decoration** on TEXT (that is hyperlinked body copy; this is a labeled button control). **`buttonData.type` is required** on every BUTTON node — use `"LINK"` for URL navigation or `"ACTION"` for viewer click handlers (never omit `type` even when `link` is present). Two `buttonData.type` values:

- **`LINK`** — navigates to a URL when clicked (`link.url`, `link.target`: `BLANK`·`SELF`, optional `link.rel`).
- **`ACTION`** — triggers a viewer `onClick` handler (store the node in JSON; behavior is configured in the Ricos viewer, not in the document body).

```json
{
  "type": "BUTTON",
  "buttonData": {
    "type": "LINK",
    "text": "Get Started",
    "link": { "url": "https://example.com", "target": "BLANK", "rel": { "nofollow": true } },
    "containerData": { "alignment": "CENTER", "width": { "size": "ORIGINAL" }, "textWrap": true },
    "styles": { "borderRadius": 4, "borderWidth": 0, "backgroundColor": "#116DFF", "textColor": "#FFFFFF" }
  }
}
```

**AUDIO** — uploaded audio via Wix Media `src.id`, or an embed variant whose `audioData.html` holds an iframe (SoundCloud, Spotify). Include `audioData.containerData` with `alignment` and width settings, and use an empty `nodes: []` array because AUDIO has no child nodes. Optional fields include `coverImage` (`src.id`, `width`, `height`), `name`, `authorName`, and `disableDownload`:

```json
{
  "type": "AUDIO",
  "nodes": [],
  "audioData": {
    "containerData": { "alignment": "CENTER", "width": { "size": "CONTENT" }, "textWrap": true },
    "audio": { "src": { "id": "mp3/f0f74f_48772df0375c41cd88e8e29370ccf899" } },
    "disableDownload": true,
    "coverImage": { "src": { "id": "f0f74f_2973832f552e4002b58ec6abbe7fce71~mv2.png" }, "width": 436, "height": 524 },
    "name": "Track title",
    "authorName": "Artist name"
  }
}
```

**VIDEO** — Wix Media `video.src.id`, `duration` (seconds), and a `thumbnail` (`src.id`, `width`, `height`). YouTube and other embeds use the same `VIDEO` node shape with the appropriate media id:

```json
{
  "type": "VIDEO",
  "videoData": {
    "containerData": { "width": { "size": "CONTENT" }, "alignment": "CENTER" },
    "video": { "src": { "id": "video/11062b_a552731f40854d16a91627687fb8d1a6/1080p/mp4/file.mp4" }, "duration": 14.08 },
    "thumbnail": { "src": { "id": "media/11062b_a552731f40854d16a91627687fb8d1a6f000.jpg" }, "width": 1920, "height": 1080 }
  }
}
```

**GALLERY** — multiple images in one block. Each `items[]` entry wraps `image.media` with `src` (`id` or `url`), `width`, and `height`. `galleryData.options` controls layout (`layout.type`: `GRID`, `numberOfColumns`, `orientation`; `item.ratio`, `item.crop`; `thumbnails.placement`):

```json
{
  "type": "GALLERY",
  "galleryData": {
    "containerData": { "width": { "size": "CONTENT" }, "alignment": "CENTER", "textWrap": true },
    "items": [
      { "image": { "media": { "src": { "id": "8bb438_36726a2d14ec44ee9edc5693bade1092.jpg" }, "width": 3648, "height": 5472 } } },
      { "image": { "media": { "src": { "id": "8bb438_6bbf8e82fe8f4b79b6e03ee79b66fd6a.jpg" }, "width": 1920, "height": 1280 } } }
    ],
    "options": {
      "layout": { "type": "GRID", "horizontalScroll": false, "orientation": "COLUMNS", "numberOfColumns": 3 },
      "item": { "ratio": 1, "crop": "FILL" },
      "thumbnails": { "placement": "NONE" }
    }
  }
}
```

**COLLAPSIBLE_LIST** — FAQ-style expandable items. Nesting is `COLLAPSIBLE_LIST → COLLAPSIBLE_ITEM → COLLAPSIBLE_ITEM_TITLE | COLLAPSIBLE_ITEM_BODY → PARAGRAPH → TEXT` (body cells may also contain other supported block plugins such as IMAGE or VIDEO). The item wrapper type is **`COLLAPSIBLE_ITEM`** — not `COLLAPSIBLE_LIST_ITEM` or other variants:

```json
{
  "type": "COLLAPSIBLE_LIST",
  "nodes": [
    {
      "type": "COLLAPSIBLE_ITEM",
      "nodes": [
        {
          "type": "COLLAPSIBLE_ITEM_TITLE",
          "nodes": [
            { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Question?", "decorations": [] } } ], "paragraphData": { "textStyle": { "textAlignment": "AUTO" } } }
          ]
        },
        {
          "type": "COLLAPSIBLE_ITEM_BODY",
          "nodes": [
            { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Answer text.", "decorations": [] } } ], "paragraphData": { "textStyle": { "textAlignment": "AUTO" } } }
          ]
        }
      ]
    }
  ],
  "collapsibleListData": {
    "containerData": { "alignment": "CENTER", "textWrap": true },
    "expandOnlyOne": false,
    "initialExpandedItems": "FIRST",
    "direction": "LTR"
  }
}
```

`initialExpandedItems`: `NONE`·`FIRST`·`ALL`. Set `isQapageData: true` in list metadata when the list should render as FAQ structured data in search results.

**HTML** — embeds external content in an iframe. Provide either `url` (page URL) or inline `html` markup; `source` is typically `"HTML"`. Size via `containerData.width` / `height` (`custom` pixel strings or `size`):

```json
{
  "type": "HTML",
  "htmlData": {
    "containerData": { "width": { "custom": "550" }, "height": { "custom": "550" }, "alignment": "CENTER" },
    "url": "https://example.com/embed",
    "source": "HTML"
  }
}
```

## Inline text formatting (decorations)

Apply formatting with the `decorations` array on a TEXT node. Each decoration is an object with a `type` and (for some types) a data field:

```json
{
  "type": "TEXT",
  "textData": {
    "text": "Bold, colored, and linked",
    "decorations": [
      { "type": "BOLD", "fontWeightValue": 700 },
      { "type": "COLOR", "colorData": { "foreground": "#116DFF" } },
      { "type": "LINK", "linkData": { "link": { "url": "https://example.com", "target": "BLANK" } } }
    ]
  }
}
```

| Decoration | Data field |
| ------------------------------------------ | ---------------------------------------------------------- |
| `BOLD`                                     | `fontWeightValue: 700`                                     |
| `ITALIC`                                   | `italicData: true`                                         |
| `UNDERLINE`                                | _(none)_                                                   |
| `STRIKETHROUGH`                            | `strikethroughData: true`                                  |
| `COLOR`                                    | `colorData: { foreground: "#hex" }` (add `background` for highlight) |
| `LINK`                                     | `linkData: { link: { url, target: "BLANK" } }`             |
| `FONT_SIZE`                                | `fontSizeData: { unit: "PX", value: 24 }`                  |
| `SPOILER`                                  | _(none — `{ "type": "SPOILER" }` hides text behind a reveal control)_ |

- **Mixed formatting in one paragraph → split into multiple TEXT nodes** (one per style run) inside the same PARAGRAPH. A single TEXT node carries one consistent set of decorations.
- Use a plain hex string in `foreground` for colors.
- **No `\n` inside `textData.text`** — one visual line is one node. Emit separate sibling PARAGRAPH/HEADING nodes for separate lines.

## A complete worked example

Assemble the shapes above into one valid `richContent` document. This example exercises **every** common node type — heading, bulleted list, ordered list, blockquote, filled-header table, divider, code block, and a paragraph with mixed bold + link runs — all correctly nested. Copy its **structure**; replace the placeholder text with real content.

```json
{
  "nodes": [
    { "type": "HEADING", "nodes": [ { "type": "TEXT", "textData": { "text": "What's New in v2.1", "decorations": [] } } ], "headingData": { "level": 2, "textStyle": { "textAlignment": "AUTO" } } },
    { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "This release focuses on speed and clarity.", "decorations": [] } } ], "paragraphData": { "textStyle": { "textAlignment": "AUTO" } } },

    { "type": "HEADING", "nodes": [ { "type": "TEXT", "textData": { "text": "Highlights", "decorations": [] } } ], "headingData": { "level": 3 } },
    { "type": "BULLETED_LIST", "nodes": [
      { "type": "LIST_ITEM", "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Faster page loads", "decorations": [] } } ] } ] },
      { "type": "LIST_ITEM", "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Redesigned dashboard", "decorations": [] } } ] } ] }
    ], "bulletedListData": { "indentation": 0 } },

    { "type": "HEADING", "nodes": [ { "type": "TEXT", "textData": { "text": "How to upgrade", "decorations": [] } } ], "headingData": { "level": 3 } },
    { "type": "ORDERED_LIST", "nodes": [
      { "type": "LIST_ITEM", "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Back up your data", "decorations": [] } } ] } ] },
      { "type": "LIST_ITEM", "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Run the migration", "decorations": [] } } ] } ] }
    ], "orderedListData": { "indentation": 0 } },

    { "type": "BLOCKQUOTE", "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "The new dashboard cut our reporting time in half.", "decorations": [] } } ] } ], "blockquoteData": { "indentation": 1 } },

    { "type": "DIVIDER", "dividerData": { "lineStyle": "SINGLE", "width": "LARGE", "alignment": "CENTER" } },

    { "type": "HEADING", "nodes": [ { "type": "TEXT", "textData": { "text": "Plan comparison", "decorations": [] } } ], "headingData": { "level": 3 } },
    { "type": "TABLE", "nodes": [
      { "type": "TABLE_ROW", "nodes": [
        { "type": "TABLE_CELL", "tableCellData": { "cellStyle": { "verticalAlignment": "MIDDLE", "backgroundColor": "#116DFF" }, "borderColors": {} }, "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Plan", "decorations": [ { "type": "BOLD", "fontWeightValue": 700 }, { "type": "COLOR", "colorData": { "foreground": "#FFFFFF" } } ] } } ] } ] },
        { "type": "TABLE_CELL", "tableCellData": { "cellStyle": { "verticalAlignment": "MIDDLE", "backgroundColor": "#116DFF" }, "borderColors": {} }, "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Price", "decorations": [ { "type": "BOLD", "fontWeightValue": 700 }, { "type": "COLOR", "colorData": { "foreground": "#FFFFFF" } } ] } } ] } ] }
      ] },
      { "type": "TABLE_ROW", "nodes": [
        { "type": "TABLE_CELL", "tableCellData": { "cellStyle": { "verticalAlignment": "MIDDLE" }, "borderColors": {} }, "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Starter", "decorations": [] } } ] } ] },
        { "type": "TABLE_CELL", "tableCellData": { "cellStyle": { "verticalAlignment": "MIDDLE" }, "borderColors": {} }, "nodes": [ { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "$0", "decorations": [] } } ] } ] }
      ] }
    ], "tableData": { "dimensions": { "colsWidthRatio": [50, 50], "colsMinWidth": [120, 120], "rowsHeight": [47, 47] } } },

    { "type": "CODE_BLOCK", "nodes": [ { "type": "TEXT", "textData": { "text": "npm install @wix/sdk@latest", "decorations": [] } } ], "codeBlockData": { "textStyle": { "textAlignment": "AUTO" } } },

    { "type": "PARAGRAPH", "nodes": [
      { "type": "TEXT", "textData": { "text": "Read the ", "decorations": [] } },
      { "type": "TEXT", "textData": { "text": "full release notes", "decorations": [ { "type": "BOLD", "fontWeightValue": 700 }, { "type": "LINK", "linkData": { "link": { "url": "https://example.com/release-notes", "target": "BLANK" } } } ] } },
      { "type": "TEXT", "textData": { "text": " for details.", "decorations": [] } }
    ], "paragraphData": { "textStyle": { "textAlignment": "AUTO" } } }
  ]
}
```

Note the mixed-run paragraph at the end: the linked words are their own TEXT node carrying `BOLD` + `LINK`, while the surrounding words are separate plain TEXT runs — that is how you apply formatting to *part* of a sentence.

## Nesting rules

| Parent | Valid children |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Root `nodes`                         | PARAGRAPH, HEADING, BULLETED_LIST, ORDERED_LIST, BLOCKQUOTE, DIVIDER, IMAGE, TABLE, CODE_BLOCK, BUTTON, AUDIO, VIDEO, GALLERY, COLLAPSIBLE_LIST, HTML |
| PARAGRAPH / HEADING / CODE_BLOCK     | TEXT                                                                                                  |
| BULLETED_LIST / ORDERED_LIST         | LIST_ITEM                                                                                             |
| LIST_ITEM / BLOCKQUOTE               | PARAGRAPH (which then contains TEXT)                                                                  |
| TABLE → TABLE_ROW → TABLE_CELL       | cell contains PARAGRAPH / HEADING / IMAGE                                                              |
| IMAGE / VIDEO                        | CAPTION (optional)                                                                                    |
| COLLAPSIBLE_LIST                     | COLLAPSIBLE_ITEM                                                                                      |
| COLLAPSIBLE_ITEM                     | COLLAPSIBLE_ITEM_TITLE, COLLAPSIBLE_ITEM_BODY                                                        |
| COLLAPSIBLE_ITEM_TITLE / _BODY       | PARAGRAPH (and other plugins supported inside collapsible cells — see COLLAPSIBLE_LIST above)           |
| BUTTON / AUDIO / GALLERY / HTML      | _(leaf — `nodes: []` or omit)_                                                                        |

## Self-audit before returning the document

All decidable from the JSON itself — check before handing the document to a consuming API:

1. **Every `type` is a bare string** — search for `"type": {`; there should be zero hits.
2. **TEXT wrapping** — no TEXT node sits directly in the root array, a `LIST_ITEM`, a `BLOCKQUOTE`, or a `TABLE_CELL`.
3. **Container nesting is complete** — `LIST → LIST_ITEM → PARAGRAPH → TEXT` and `TABLE → TABLE_ROW → TABLE_CELL → PARAGRAPH → TEXT`, no level skipped.
4. **Headings carry a `level`** (1–6) and nest logically (don't jump H2 → H4).
5. **No `\n` inside `textData.text`** — split into sibling nodes; mixed inline formatting → split into multiple TEXT runs.
6. **Images** use a Wix Media `id` (not a raw URL), with `width`, `height`, and meaningful `altText`.
7. **Links** — every `LINK` decoration has a valid `url` and `target`. Use a `BUTTON` block with `buttonData.type: "LINK"` for CTAs — not an inline `LINK` decoration styled to look like a button.
8. **Buttons** — every BUTTON includes **`buttonData.type`** (`LINK` requires `link.url`; `ACTION` has no URL). Omitting `type` is invalid even when `link` is set. `LINK` buttons and inline `LINK` decorations serve different purposes.
9. **Media blocks** — AUDIO has root-level `nodes: []` and `audioData.containerData`; VIDEO keeps `thumbnail` beside `video` under `videoData`; every GALLERY item is under `galleryData.items` and carries `image.media.src`, `width`, and `height`.
10. **Collapsible lists** — every item has both `_TITLE` and `_BODY`, each wrapping content through `PARAGRAPH → TEXT`, and every PARAGRAPH has `paragraphData`.
11. **HTML embeds** — `htmlData` includes `source`, `containerData.width`, `containerData.height`, and either `url` or `html` (not both empty).
12. **Spoiler** — `SPOILER` is a decoration on `TEXT` (or `containerData.spoiler` on some block plugins in editor output); preserve it verbatim on edit.
13. **Vertical spacing** — stacked block nodes that should not appear cramped are separated by empty `{ "type": "PARAGRAPH" }` spacers — especially after images, videos, tables, collapsible lists, galleries, buttons, and between consecutive paragraphs. Missing spacers produce a wall-of-blocks layout with no renderer-added margin.
