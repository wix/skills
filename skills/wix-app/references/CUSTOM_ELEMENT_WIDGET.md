
# Wix Custom Element Widget Builder

Custom element widgets are native web components (HTML custom elements) that appear in the Wix Editor. Site owners add interactive, configurable widgets to their pages and edit them through a built-in settings panel.

## Scaffold

Use `wix generate --params '{"extensionType":"CUSTOM_ELEMENT","name":"<Display Name>"}'` — `name` is the required param (a human-readable name, e.g. `"Countdown Timer"`), **not `folder`**: the CLI derives the folder/tag name from it (kebab-cased, `-element` suffix added if needed for the hyphen requirement). The CLI generates 4 files plus the `src/extensions.ts` registration:

| File | Purpose |
|------|---------|
| `<name>.tsx` | The widget — a class that extends `HTMLElement` |
| `<name>.panel.tsx` | The settings panel React component shown in the Editor sidebar |
| `<name>.module.css` | CSS Modules stylesheet pre-wired with a `.root` class and CSS custom-property tokens |
| `<name>.extension.ts` | Builder file (UUID, name, sizing defaults, auto-add, presets, tagName, file paths) |

Edit `<name>.tsx`/`.panel.tsx`/`.module.css` for logic/settings-UI/styling; touch the builder file only for non-default sizing, auto-add, or presets.

## Widget Component (`<name>.tsx`)

Wix calls `customElements.define()` for you using the builder's `tagName`; do NOT call it in your code.

Two patterns: **native class** (CLI default) and **React function component** via `react-to-webcomponent`.

### Native class component (CLI default)

```typescript
import styles from './<name>.module.css';

class MyWidget extends HTMLElement {
  static get observedAttributes() { return ['display-name']; }
  connectedCallback() { this.render(); }
  disconnectedCallback() { /* tear down timers, listeners */ }
  attributeChangedCallback() { this.render(); }

  render() {
    const displayName = this.getAttribute('display-name') || "Your Widget's Title";
    this.innerHTML = `<div class="${styles.root}"><h2>${displayName}</h2></div>`;
  }
}

export default MyWidget;
```

Key rules:

- Extend `HTMLElement`; export the class as the default export.
- `observedAttributes` must return **kebab-case** strings — HTML attributes don't preserve camelCase.
- Start side effects in `connectedCallback`, tear them down in `disconnectedCallback`.
- Call `this.render()` from `attributeChangedCallback`; always provide defaults via `getAttribute` — attributes may be `null` on first paint.
- Render via `this.innerHTML` (template strings) or imperative DOM, not JSX.
- Apply the `.root` class from `<name>.module.css` rather than hard-coding colors inline — don't import other global CSS.

### React function component alternative (react-to-webcomponent)

Use this pattern when you prefer JSX, React hooks, or want to share React components between the widget and the settings panel. Install `react-to-webcomponent` if not already present: `npm install react-to-webcomponent`.

```typescript
import React, { type FC } from 'react';
import ReactDOM from 'react-dom';
import reactToWebComponent from 'react-to-webcomponent';
import styles from './<name>.module.css';

const MyWidget: FC<{ displayName?: string }> = ({
  displayName = "Your Widget's Title",
}) => (
  <div className={styles.root}>
    <h2>{displayName}</h2>
  </div>
);

export default reactToWebComponent(MyWidget, React, ReactDOM as any, {
  props: { displayName: 'string' },
});
```

Key rules for this pattern:

- Define props in camelCase (see [Props Naming Convention](#props-naming-convention) below) — you do not need `observedAttributes` or `attributeChangedCallback`.
- Use React hooks (`useState`, `useEffect`) for state and side effects.
- Render with JSX; use `<name>.module.css` for styles via `className`.

## Settings Panel (`<name>.panel.tsx`)

React component shown in the Wix Editor sidebar.

- Uses Wix Design System components (see [SETTINGS_PANEL.md](custom-element-widget/SETTINGS_PANEL.md)).
- Manages widget properties via the `@wix/editor` `widget` API.
- Loads initial values with `widget.getProp('kebab-case-name')`.
- Updates properties with `widget.setProp('kebab-case-name', value)`. Always update both local React state AND the widget prop in onChange handlers.
- Wrapped in `WixDesignSystemProvider > SidePanel > SidePanel.Content`.
- For color/font fields, see [Color & Font Pickers](#color--font-pickers) below — never a plain `<Input>`.
- For date/time fields, see [Date & Time Fields](custom-element-widget/SETTINGS_PANEL.md#date--time-fields) — `DatePicker`/`TimeInput` `onChange` shapes differ.

## Builder file (`<name>.extension.ts`)

The CLI scaffolds the builder file with sensible defaults — edit it only to customize sizing, auto-add behavior, or presets.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `id` | UUID | generated | Extension ID. Don't change after scaffolding. |
| `name` | string | from scaffold param | Display name, **max 30 chars** — longer fails platform validation on deploy. |
| `tagName` | kebab-case | derived from `folder` | Custom-element tag used by the Editor and `customElements.define()`. |
| `width.defaultWidth` | number (px) | `450` | Initial width when added to a page. |
| `width.allowStretch` | boolean | `true` | Whether the site owner can stretch the widget's width. |
| `height.defaultHeight` | number (px) | `250` | Initial height. |
| `installation.autoAdd` | boolean | `true` | Auto-added on app install if true; set `false` for opt-in widgets. |
| `presets` | array | one default preset | Editor presets the site owner can pick, each with its own `id`/`name`/`thumbnailUrl`. |
| `presets[].thumbnailUrl` | string | `{{BASE_URL}}/<name>-thumbnail.png` | Preview image path; `{{BASE_URL}}` resolves at build time — replace the placeholder asset there. |
| `element` / `settings` | path | generated paths | Widget/panel file paths. Don't change unless renaming files. |

- Import `@wix/design-system/styles.global.css` for styles

## Props Naming Convention

The convention differs by pattern, but the settings panel side is always kebab-case:

| Pattern | Side | Convention | Example |
| --- | --- | --- | --- |
| Native class | `<name>.tsx` (`observedAttributes`, `getAttribute`) | kebab-case | `"display-name"`, `"bg-color"` |
| Native class | Local TypeScript variables | camelCase | `displayName`, `bgColor` |
| React FC | `reactToWebComponent` `props` option | camelCase | `{ displayName: 'string' }` |
| React FC | Component props interface | camelCase | `displayName?: string` |
| Both | `<name>.panel.tsx` (`widget.getProp`/`setProp`) | kebab-case | `"display-name"`, `"bg-color"` |

## Identity and SDK Calls

A widget runs as the **site visitor or member**, never as the app — see [Identity and Elevation Requirement](../SKILL.md#identity-and-elevation-requirement) before routing any SDK call out to a backend endpoint.

A widget's collection reads need permissions admitting an anonymous visitor — see [Permissions](DATA_COLLECTION.md#permissions); the scaffolded default is `ANYONE` read, `PRIVILEGED` write.

## Wix Data API Integration

When using the Wix Data API in widgets, you **must** handle the Wix Editor environment gracefully — fetching data inside the Editor produces empty results and noisy errors.

**Requirements (both patterns):** install `@wix/site-window` first (not part of the CLI's base scaffold), check `await wixWindow.viewMode()` before fetching, render a placeholder if `'Editor'`, as below.

**Native class component** — same class shape as [above](#native-class-component-cli-default), `observedAttributes` returning `['collection-id']`, with this `render()`:

```typescript
import { items } from '@wix/data';
import { window as wixWindow } from '@wix/site-window';

async render() {
  const collectionId = this.getAttribute('collection-id') || '';
  if ((await wixWindow.viewMode()) === 'Editor') {
    this.innerHTML = `<div style="padding: 20px; border: 2px dashed #ccc"><p>Widget will display data on the live site</p></div>`;
    return;
  }
  const { items: results } = await items.query(collectionId).limit(10).find();
  this.innerHTML = results.map((item) => `<div>${item.title}</div>`).join('');
}
```

**React function component** — use `useEffect` for the viewMode check and data fetch:

```typescript
const [results, setResults] = useState<string[]>([]);
const [isEditor, setIsEditor] = useState(false);

useEffect(() => {
  wixWindow.viewMode().then((viewMode) => {
    if (viewMode === 'Editor') { setIsEditor(true); return; }
    items.query(collectionId).limit(10).find()
      .then(({ items: data }) => setResults(data.map((item) => item.title as string)))
      .catch((err) => console.error('Failed to load data:', err));
  });
}, [collectionId]);

// render: if (isEditor) return <placeholder />; else return <results />;
```

## Color & Font Pickers

See [SETTINGS_PANEL.md § Color & Font Picker Fields](custom-element-widget/SETTINGS_PANEL.md#color--font-picker-fields) for the API, value types, and wiring — never `<Input type="color">` or a plain text input. Call `widget.setProp('bg-color', val)` / `widget.setProp('font', JSON.stringify(val))` from the `onChange` shown there to persist the value.

## Examples

- **"Create a countdown timer widget"** → title/date/colors/font settings (see [Date & Time Fields](custom-element-widget/SETTINGS_PANEL.md#date--time-fields)), a live days/hours/minutes/seconds display.
- **"Create a widget that displays products from a collection"** → Wix Data query with [Editor-mode handling](#wix-data-api-integration), a responsive product-card grid.
- **"Create a calculator widget with customizable colors"** → a functional calculator, color-customization settings, inline styles, no external dependencies.

## Frontend Aesthetics

Avoid generic aesthetics — distinctive fonts (not Inter, Roboto, Arial), a cohesive color palette, and CSS micro-interactions, not a predictable clichéd layout.

