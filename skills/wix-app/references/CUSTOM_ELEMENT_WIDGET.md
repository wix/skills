
# Wix Custom Element Widget Builder

Custom element widgets are native web components (HTML custom elements) that appear in the Wix Editor. Site owners add interactive, configurable widgets to their pages and edit them through a built-in settings panel.

## Scaffold

Use `wix generate --params` with `extensionType: CUSTOM_ELEMENT`. `folder` must be a valid custom-element tag name (lowercase, starts with a letter, contains at least one hyphen). The CLI generates 4 files plus the `src/extensions.ts` registration:

| File | Purpose |
|------|---------|
| `<name>.tsx` | The widget — a class that extends `HTMLElement` |
| `<name>.panel.tsx` | The settings panel React component shown in the Editor sidebar |
| `<name>.module.css` | CSS Modules stylesheet pre-wired with a `.root` class and CSS custom-property tokens |
| `<name>.extension.ts` | Builder file (UUID, name, sizing defaults, auto-add, presets, tagName, file paths) |

After scaffolding, edit `<name>.tsx` for the widget logic, `<name>.panel.tsx` for the settings UI, `<name>.module.css` for the visual design, and the builder file only for non-default sizing, auto-add, or preset behavior.

## Widget Component (`<name>.tsx`)

Wix calls `customElements.define()` for you using the builder's `tagName`; do NOT call it in your code.

Two valid patterns exist: the **native class** component (CLI default) and the **React function component** via `react-to-webcomponent`.

### Native class component (CLI default)

```typescript
import styles from './<name>.module.css';

class MyWidget extends HTMLElement {
  static get observedAttributes() { return ['display-name']; }

  constructor() { super(); }

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

Key authoring rules:

- Extend `HTMLElement`; export the class as the default export.
- `observedAttributes` must return **kebab-case** strings — HTML attributes don't preserve camelCase.
- Start side effects in `connectedCallback`, tear them down in `disconnectedCallback`.
- Call `this.render()` from `attributeChangedCallback`; always provide defaults via `getAttribute` — attributes may be `null` on first paint.
- Render via `this.innerHTML` (template strings) or imperative DOM, not JSX.
- Apply the `.root` class from `<name>.module.css` rather than hard-coding colors inline.

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

Key authoring rules for the function component pattern:

- Define props in the `props` option of `reactToWebComponent` using **camelCase** keys. The library automatically maps kebab-case HTML attributes (e.g., `display-name`) to camelCase React props — you do not need `observedAttributes` or `attributeChangedCallback`.
- Use React hooks (`useState`, `useEffect`) for state and side effects.
- Render with JSX; use `<name>.module.css` for styles via `className`.

## Settings Panel (`<name>.panel.tsx`)

React component shown in the Wix Editor sidebar.

- Uses Wix Design System components (see [SETTINGS_PANEL.md](custom-element-widget/SETTINGS_PANEL.md)).
- Manages widget properties via the `@wix/editor` `widget` API.
- Loads initial values with `widget.getProp('kebab-case-name')`.
- Updates properties with `widget.setProp('kebab-case-name', value)`. Always update both local React state AND the widget prop in onChange handlers.
- Wrapped in `WixDesignSystemProvider > SidePanel > SidePanel.Content`.
- For color pickers, use `inputs.selectColor()` from `@wix/editor` with `FillPreview` — NOT `<Input type="color">`.
- For font pickers, use `inputs.selectFont()` from `@wix/editor` with a `Button` — NOT a text Input.

## Builder file (`<name>.extension.ts`)

The CLI scaffolds the builder file with sensible defaults — edit it only to customize sizing, auto-add behavior, or presets.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `id` | UUID | generated | Extension ID. Don't change after scaffolding. |
| `name` | string | from scaffold param | Display name. |
| `tagName` | kebab-case | derived from `folder` | Custom-element tag the widget is registered under. Used by the Editor and by `customElements.define()`. |
| `width.defaultWidth` | number (px) | `450` | Initial width when the widget is added to a page. |
| `width.allowStretch` | boolean | `true` | Whether the site owner can stretch the widget to the page width. |
| `height.defaultHeight` | number (px) | `250` | Initial height. |
| `installation.autoAdd` | boolean | `true` | If true, the widget is auto-added to the site when the app is installed. Set to `false` for opt-in widgets. |
| `presets` | array | one default preset | Editor presets (saved configurations) the site owner can pick from. Each preset has its own `id`, `name`, and `thumbnailUrl`. |
| `presets[].thumbnailUrl` | string | `{{BASE_URL}}/<name>-thumbnail.png` | Path to a preview image. `{{BASE_URL}}` is resolved at build time. Replace the placeholder image at the same relative path with your actual asset. |
| `element` | path | `./extensions/site/widgets/<name>/<name>.tsx` | Path to the widget custom element file. Don't change unless renaming files. |
| `settings` | path | `./extensions/site/widgets/<name>/<name>.panel.tsx` | Path to the settings panel file. Don't change unless renaming files. |

- Import `@wix/design-system/styles.global.css` for styles
- For colors, use `ColorPickerField` with `inputs.selectColor()` from `@wix/editor` — NOT `<Input type="color">`
- For fonts, use `FontPickerField` with `inputs.selectFont()` from `@wix/editor` — NOT a text Input
- Font values are stored as JSON strings via `JSON.stringify()` / `JSON.parse()`

## Props Naming Convention

The convention differs by pattern, but the settings panel side is always kebab-case.

**Native class component:**

| Side | Convention | Example |
| ---- | ---------- | ------- |
| `<name>.tsx` — `observedAttributes`, `getAttribute` | kebab-case | `"display-name"`, `"bg-color"` |
| `<name>.panel.tsx` — `widget.getProp` / `widget.setProp` | kebab-case | `"display-name"`, `"bg-color"` |
| Local TypeScript variables | camelCase | `displayName`, `bgColor` |

**React function component (react-to-webcomponent):** Define props with camelCase keys in the `props` option. The library handles the kebab-case ↔ camelCase mapping at the HTML attribute boundary automatically.

| Side | Convention | Example |
| ---- | ---------- | ------- |
| `reactToWebComponent` `props` option | camelCase | `{ displayName: 'string' }` |
| React component props interface | camelCase | `displayName?: string` |
| `<name>.panel.tsx` — `widget.getProp` / `widget.setProp` | kebab-case | `"display-name"`, `"bg-color"` |

## Wix Data API Integration

When using the Wix Data API in widgets, you **must** handle the Wix Editor environment gracefully — fetching data inside the Editor produces empty results and noisy errors.

**Requirements (both patterns):**

- Import `{ window as wixWindow }` from `'@wix/site-window'`.
- Check `await wixWindow.viewMode()` before fetching data.
- If `viewMode === 'Editor'`, render a placeholder instead of fetching.
- Only query and render real data when NOT in Editor mode.

**Native class component:**

```typescript
import { items } from '@wix/data';
import { window as wixWindow } from '@wix/site-window';

class MyWidget extends HTMLElement {
  static get observedAttributes() {
    return ['collection-id'];
  }

  constructor() {
    super();
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  async render() {
    const collectionId = this.getAttribute('collection-id') || '';
    const viewMode = await wixWindow.viewMode();

    if (viewMode === 'Editor') {
      this.innerHTML = `
        <div style="padding: 20px; border: 2px dashed #ccc">
          <p>Widget will display data on the live site</p>
          <p>Collection: ${collectionId}</p>
        </div>
      `;
      return;
    }

    try {
      const { items: results } = await items.query(collectionId).limit(10).find();
      this.innerHTML = results.map((item) => `<div>${item.title}</div>`).join('');
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }
}

export default MyWidget;
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

Use native Wix pickers — never `<Input type="color">` or a plain text input.

| Picker | API | Preview component | Value type |
|--------|-----|-------------------|------------|
| Color | `inputs.selectColor(value, { onChange })` from `@wix/editor` | `<FillPreview fill={value} onClick={...} />` | `string` |
| Font | `inputs.selectFont(value, { onChange })` from `@wix/editor` | `<Button onClick={...}>Change Font</Button>` | `{ font: string; textDecoration: string }` — store as `JSON.stringify()` |

```typescript
// Color — inside a SidePanel.Field > FormField
<FillPreview
  fill={bgColor}
  onClick={() => inputs.selectColor(bgColor, {
    onChange: (val) => { if (val) { setBgColor(val); widget.setProp('bg-color', val); } }
  })}
/>

// Font — inside a SidePanel.Field > FormField
<Button onClick={() => inputs.selectFont(font, {
  onChange: (val) => {
    const next = { font: val.font, textDecoration: val.textDecoration || '' };
    setFont(next);
    widget.setProp('font', JSON.stringify(next));
  }
})}>Change Font</Button>
```

## Examples

### Countdown Timer Widget

**Request:** "Create a countdown timer widget"

**Output:**

- Widget with configurable title, target date/time, colors, and font
- Settings panel with date picker, time input, color pickers, font picker
- Real-time countdown display with days, hours, minutes, seconds

### Product Showcase Widget

**Request:** "Create a widget that displays products from a collection"

**Output:**

- Widget that queries Wix Data collection
- Editor environment handling (shows placeholder in editor)
- Settings panel for collection selection, display options, styling
- Responsive grid layout with product cards

### Interactive Calculator Widget

**Request:** "Create a calculator widget with customizable colors"

**Output:**

- Functional calculator component
- Settings panel for color customization (background, buttons, text)
- Inline styles for all styling
- No external dependencies

## Frontend Aesthetics

Avoid generic aesthetics. Create distinctive designs with unique fonts (avoid Inter, Roboto, Arial), cohesive color palettes, CSS animations for micro-interactions, and context-specific choices. Don't use clichéd color schemes or predictable layouts.

## Custom-element-specific Conventions

- **Native class (CLI default):** Widget extends `HTMLElement` and renders via `this.innerHTML`. Use kebab-case throughout (`observedAttributes`, `getAttribute`, `getProp`, `setProp`).
- **React function component alternative:** Widget uses a React FC converted via `react-to-webcomponent`. Use camelCase in the `props` option; the library handles kebab-case HTML attributes automatically. The settings panel side still uses kebab-case with `getProp`/`setProp`.
- The settings panel (`<name>.panel.tsx`) is always a functional React component with hooks, regardless of which widget pattern is used.
- Style via the generated `<name>.module.css` (preferred) or inline styles. Don't import other global CSS.
- Handle the Wix Editor environment when using the Wix Data API.
