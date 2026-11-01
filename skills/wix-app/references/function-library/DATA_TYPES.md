# Function Library Data Types

## Disallowed Data Types

The following dataTypes are NOT allowed for function parameters or return types:

- `UNKNOWN_DataType`
- `schema`
- `container`
- `onClick` (deprecated — use `domEvent: POINTER`)
- `onChange` (deprecated — use `domEvent: CHANGE`)
- `onKeyPress` (deprecated — use `domEvent: KEYBOARD`)
- `onKeyUp` (deprecated — use `domEvent: KEYBOARD`)
- `onKeyDown` (deprecated — use `domEvent: KEYBOARD`)
- `onFocus` (deprecated — use `domEvent: FOCUS`)
- `onSubmit` (deprecated — use `domEvent: SUBMIT`)

## Available Data Types

| Type | Runtime Value | Use Case |
|------|---------------|----------|
| `text` | string | Names, IDs, labels |
| `textEnum` | string | Predefined option sets |
| `number` | number | Counts, quantities, dimensions |
| `booleanValue` | boolean | Toggles, flags |
| `a11y` | object | Accessibility attributes |
| `link` | `{ href, target, rel }` | Navigation links |
| `image` | Image object | Image data |
| `video` | Video object | Media content |
| `vectorArt` | SVG object | Icons, graphics |
| `audio` | Audio object | Audio content |
| `localDate` | string (YYYY-MM-DD) | Date values |
| `localTime` | string (hh:mm[:ss][.sss]) | Time values |
| `localDateTime` | string (YYYY-MM-DDThh:mm[:ss][.sss]) | Date-time values |
| `webUrl` | string | URLs (http/https) |
| `email` | string | Email addresses (RFC 5321) |
| `phone` | string | Phone numbers |
| `hostname` | string | Hostname (IANA) |
| `regex` | string | Regex patterns |
| `guid` | string | Unique identifiers |
| `richText` | `RichText` object (`{ text, html, linkList }`) | Formatted content with inline styles |
| `arrayItems` | Array | Lists, collections |
| `direction` | string | HTML dir attribute (ltr/rtl) |
| `menuItems` | Array | Menu item collections |
| `data` | object | Complex nested objects |
| `function` | function | Callback parameters |
| `filter` | object | Data filter definitions |
| `sort` | object | Data sort definitions |

### RichText values

For parameters and returns declared as `dataType: 'richText'`, use `RichText` from `@wix/editor-react-types`. It is an object, not an HTML string:

- `text`: the original rich text content.
- `html`: the HTML content with links resolved.
- `linkList`: the links present in the content; use `[]` when there are none.

For example, a function declared with `returns: { dataType: 'richText' }` can return this static, link-free greeting:

```typescript
import type { RichText } from '@wix/editor-react-types';

export function greet(): RichText {
  const html = '<p>Hello</p>';
  return { text: html, html, linkList: [] };
}
```

Do not return `'<p>Hello</p>'` directly for that declaration. Rich text elements read the object's `html` field, so a bare string can render blank even when the function succeeds.

For plain text, return a string and declare `dataType: 'text'`. Do not label a string `richText` just to match the target element: binding compatibility and converter selection use the declared types. Do not generate duplicate RichText versions of plain text values solely for binding.

### Link configuration

For a `link` item or parameter, the optional `link` field limits the link types a Wix user can pick in the editor:

| Field | Required | Description |
|---|---|---|
| `linkTypes` | No | Allowed link types. Defaults to all supported types. |
| `appIds` | No | App IDs available for `dynamicPageLink` and `pageLink` values. |
| `hideInnerRoute` | No | Whether a dynamic page link can target only a top-level page. |

```typescript
{ dataType: 'link', displayName: 'Destination', link: { linkTypes: ['externalLink', 'pageLink'] } }
```
