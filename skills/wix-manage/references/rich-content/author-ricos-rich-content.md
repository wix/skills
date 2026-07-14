---
name: "Author Ricos Rich Content"
description: Hand-authoring valid Ricos rich-content JSON (the richContent/nodes tree) used across Wix Blog posts, Stores product descriptions, Events, and CMS rich-text fields. Covers every common node shape — paragraphs, headings, lists, blockquotes, dividers, tables (with cell fills), code blocks, images — plus inline text decorations and the nesting rules the format enforces.
---

# Author Ricos Rich Content

Ricos is Wix's rich-content format — a tree of typed nodes serialized as JSON. The same structure is embedded by many products: a Blog post's `draftPost.richContent`, a Store product's rich description, an Events description, and CMS rich-text fields all expect a Ricos document. This recipe is the **authoring reference for that node tree**: the valid shape of each node, how nodes nest, and how to format text. It is intentionally product-agnostic — the consuming API decides *where* the document goes; this recipe governs *what a valid document looks like*.

> A Ricos document is an object with a `nodes` array: `{ "nodes": [ /* block nodes */ ] }`. Whatever field the consuming API exposes (e.g. `richContent`), it holds this object. For validating or converting an existing document to/from HTML/Markdown, see [Ricos Converter Service](ricos-converter-service.md).

## Universal rules for every node

- **`type` is always a bare string** — `"type": "PARAGRAPH"`, never an object like `"type": { "type": "PARAGRAPH" }`. An object-valued `type` may pass a shallow validation but renders as a broken/uneditable block.
- Every node carries a `type`, an optional `id`, and (for container nodes) a `nodes` array of children. Node `id`s are optional when authoring for a create request — the API generates them; the examples below omit `id` for brevity.
- **TEXT is a leaf.** A TEXT node only ever lives inside a `PARAGRAPH`, `HEADING`, or `CODE_BLOCK`. It must **never** sit directly in the root `nodes` array or inside a `LIST_ITEM`, `BLOCKQUOTE`, or `TABLE_CELL` — those must contain a `PARAGRAPH` (or `HEADING`) that then contains the TEXT. See [Nesting rules](#nesting-rules).
- Failing to wrap TEXT correctly produces the parse error **"Expected a paragraph node but found TEXT"**.

## Block node shapes

**PARAGRAPH** — the base text container. An empty paragraph — `{ "type": "PARAGRAPH" }` — acts as a vertical spacer. `paragraphData.textStyle.textAlignment` accepts `AUTO`·`LEFT`·`CENTER`·`RIGHT`·`JUSTIFY`:

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
| Root `nodes`                         | PARAGRAPH, HEADING, BULLETED_LIST, ORDERED_LIST, BLOCKQUOTE, DIVIDER, IMAGE, TABLE, CODE_BLOCK         |
| PARAGRAPH / HEADING / CODE_BLOCK     | TEXT                                                                                                  |
| BULLETED_LIST / ORDERED_LIST         | LIST_ITEM                                                                                             |
| LIST_ITEM / BLOCKQUOTE               | PARAGRAPH (which then contains TEXT)                                                                  |
| TABLE → TABLE_ROW → TABLE_CELL       | cell contains PARAGRAPH / HEADING / IMAGE                                                              |
| IMAGE                                | CAPTION (optional)                                                                                    |

## Self-audit before returning the document

All decidable from the JSON itself — check before handing the document to a consuming API:

1. **Every `type` is a bare string** — search for `"type": {`; there should be zero hits.
2. **TEXT wrapping** — no TEXT node sits directly in the root array, a `LIST_ITEM`, a `BLOCKQUOTE`, or a `TABLE_CELL`.
3. **Container nesting is complete** — `LIST → LIST_ITEM → PARAGRAPH → TEXT` and `TABLE → TABLE_ROW → TABLE_CELL → PARAGRAPH → TEXT`, no level skipped.
4. **Headings carry a `level`** (1–6) and nest logically (don't jump H2 → H4).
5. **No `\n` inside `textData.text`** — split into sibling nodes; mixed inline formatting → split into multiple TEXT runs.
6. **Images** use a Wix Media `id` (not a raw URL), with `width`, `height`, and meaningful `altText`.
7. **Links** — every `LINK` decoration has a valid `url` and `target`.
