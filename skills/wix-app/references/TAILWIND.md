# Tailwind CSS for Wix CLI Apps

All React UI in Wix CLI app extensions (dashboard pages, modals, plugins, editor settings panels) uses **Tailwind CSS utility classes**. Do NOT use `@wix/design-system` or any WDS components.

## Project Setup

Codegen pre-installs Tailwind when the dev environment starts (`src/styles/globals.css`, `astro.config.mjs` Vite plugin, and npm dependencies). **Skip setup if already present** — only import `globals.css` in extension entry files.

If setting up manually (local project without codegen), run once:

```bash
npm install -D tailwindcss @tailwindcss/vite
```

Create `src/styles/globals.css` with `@import "tailwindcss";` and register `@tailwindcss/vite` in `astro.config.mjs` under `vite.plugins`.

### Import globals in each extension entry file

Import once in the **main component** for each extension (`page.tsx`, modal `.tsx`, `.panel.tsx`, plugin `.tsx`) — not in child/helper files:

```typescript
import '../../../styles/globals.css';
```

Adjust the relative path based on file location.

## UI Rules

| Rule | Detail |
| --- | --- |
| **Do NOT use WDS** | No `@wix/design-system`, `WixDesignSystemProvider`, `Page`, `Card`, `FormField`, `SidePanel`, `Modal`, etc. |
| **Use semantic HTML** | `<main>`, `<section>`, `<form>`, `<label>`, `<button>`, `<input>`, `<table>` |
| **Style with Tailwind** | `className="flex flex-col gap-4 rounded-lg border bg-white p-6"` |
| **Dashboard modals** | Use `dashboard.openModal()` / `dashboard.closeModal()` — never a custom overlay modal |
| **Editor color/font pickers** | Use `inputs.selectColor()` / `inputs.selectFont()` from `@wix/editor` with a styled `<button>` trigger — never `<input type="color">` |
| **Custom element widgets** | Widget (`.tsx`) uses CSS Modules; settings panel (`.panel.tsx`) uses Tailwind |

## Component Patterns

### Dashboard Page

```tsx
import '../../styles/globals.css';
import { dashboard } from '@wix/dashboard';

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">Configure your app</p>
        </div>
        <button
          type="button"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Headline</span>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
          />
        </label>
      </section>
    </main>
  );
}
```

### Dashboard Modal

```tsx
import '../../styles/globals.css';
import { dashboard } from '@wix/dashboard';

export default function EditItemModal() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold text-gray-900">Edit Item</h2>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Name</span>
        <input className="w-full rounded-md border px-3 py-2 text-sm" value={name} onChange={...} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={() => dashboard.closeModal()}>
          Cancel
        </button>
        <button type="button" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
}
```

### Dashboard Plugin

```tsx
import '../../styles/globals.css';
import { dashboard } from '@wix/dashboard';

export default function MyPlugin() {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-700">Plugin content here</p>
    </section>
  );
}
```

### Editor Settings Panel

```tsx
import '../../styles/globals.css';
import { widget, inputs } from '@wix/editor';

export default function Panel() {
  return (
    <form className="flex flex-col gap-4 p-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">Display Name</span>
        <input
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={displayName}
          onChange={handleChange}
          aria-label="Display Name"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">Background Color</span>
        <button
          type="button"
          className="h-8 w-8 rounded border border-gray-300"
          style={{ backgroundColor: bgColor }}
          onClick={() => inputs.selectColor(bgColor, { onChange: (val) => { if (val) setBgColor(val); } })}
          aria-label="Pick background color"
        />
      </label>
    </form>
  );
}
```

### Loading State

```tsx
{isLoading ? (
  <div className="flex h-64 items-center justify-center">
    <p className="text-sm text-gray-500">Loading…</p>
  </div>
) : (
  // form content
)}
```

### Data Table

```tsx
<div className="overflow-hidden rounded-lg border border-gray-200">
  <table className="min-w-full divide-y divide-gray-200">
    <thead className="bg-gray-50">
      <tr>
        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Name</th>
        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-gray-200 bg-white">
      {items.map((item) => (
        <tr key={item._id}>
          <td className="px-4 py-3 text-sm text-gray-900">{item.title}</td>
          <td className="px-4 py-3 text-sm text-gray-500">{item.status}</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

## Form Field Type Mapping

| Parameter type | Tailwind pattern |
| --- | --- |
| TEXT / URL | `<input className="w-full rounded-md border px-3 py-2 text-sm" />` |
| NUMBER | `<input type="number" className="w-full rounded-md border px-3 py-2 text-sm" />` |
| BOOLEAN | `<input type="checkbox" className="h-4 w-4 rounded border-gray-300" />` |
| SELECT | `<select className="w-full rounded-md border px-3 py-2 text-sm" />` |
| DATE | `<input type="date" className="w-full rounded-md border px-3 py-2 text-sm" />` |
| IMAGE | Custom picker button + `dashboard.openMediaManager()` |

Wrap each field in `<label className="block">` with a `<span className="mb-1 block text-sm font-medium text-gray-700">` for the label text. Show validation errors with `<p className="mt-1 text-sm text-red-600">`.
