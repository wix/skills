# React + CSS Modules for Wix CLI Apps

All React UI in Wix CLI app extensions (dashboard pages, modals, plugins, settings panels) uses **co-located CSS Modules**. Do NOT use `@wix/design-system`, Tailwind CSS, or global CSS setup.

## Rules

| Rule | Detail |
| --- | --- |
| **Do NOT use WDS** | No `@wix/design-system`, `WixDesignSystemProvider`, `Page`, `Card`, `FormField`, etc. |
| **Do NOT use Tailwind** | No `tailwindcss`, `@tailwindcss/vite`, or `globals.css` |
| **CSS Modules only** | Create `<component>.module.css` next to each `.tsx` entry file |
| **Import** | `import styles from './<component>.module.css'` in the entry `.tsx` only — not child files |
| **Semantic HTML** | `<main>`, `<section>`, `<form>`, `<label>`, `<button>`, `<input>`, `<table>` |
| **Dashboard modals** | Use `dashboard.openModal()` / `dashboard.closeModal()` — never a custom overlay modal |
| **Editor pickers** | Use `inputs.selectColor()` / `inputs.selectFont()` from `@wix/editor` with styled `<button>` triggers |
| **Custom element widgets** | Widget (`.tsx`) uses the scaffolded `<name>.module.css`; panel uses `<name>.panel.module.css` |

No npm install or `astro.config.mjs` changes are required for styling.

## Dashboard Page

**`shift-manager.tsx`**

```tsx
import { useState, type FC } from 'react';
import { dashboard } from '@wix/dashboard';
import styles from './shift-manager.module.css';

const ShiftManager: FC = () => {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Shift Manager</h1>
        <button type="button" className={styles.primaryButton} onClick={handleSave}>
          Save
        </button>
      </header>
      <section className={styles.card}>
        <label className={styles.field}>
          <span className={styles.label}>Employee name</span>
          <input className={styles.input} value={name} onChange={...} />
        </label>
      </section>
    </main>
  );
};

export default ShiftManager;
```

**`shift-manager.module.css`**

```css
.page {
  min-height: 100vh;
  padding: 24px;
  background: #f9fafb;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #111827;
}

.card {
  padding: 24px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.field {
  display: block;
  margin-bottom: 16px;
}

.label {
  display: block;
  margin-bottom: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.input {
  width: 100%;
  padding: 8px 12px;
  font-size: 0.875rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}

.primaryButton {
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #fff;
  background: #2563eb;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.primaryButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

## Dashboard Modal

Create `edit-item.module.css` next to `edit-item.tsx`. Use `className={styles.root}`, `styles.actions`, `styles.secondaryButton`, `styles.primaryButton`.

## Dashboard Plugin

Create `my-plugin.module.css` next to the plugin `.tsx`. Wrap content in `<section className={styles.root}>`.

## Settings Panel

Create `<name>.panel.module.css` next to `<name>.panel.tsx`:

```tsx
import styles from './my-widget.panel.module.css';

export default function Panel() {
  return (
    <form className={styles.form}>
      <label className={styles.field}>
        <span className={styles.label}>Display Name</span>
        <input className={styles.input} ... />
      </label>
    </form>
  );
}
```

## Loading State

```tsx
{isLoading ? (
  <div className={styles.loading}>
    <p>Loading…</p>
  </div>
) : (
  // form content
)}
```

## Data Table

```tsx
<div className={styles.tableWrapper}>
  <table className={styles.table}>
    <thead>
      <tr>
        <th className={styles.th}>Name</th>
      </tr>
    </thead>
    <tbody>
      {items.map((item) => (
        <tr key={item._id}>
          <td className={styles.td}>{item.title}</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

## Form Field Types

| Parameter type | Element |
| --- | --- |
| TEXT / URL | `<input className={styles.input} />` |
| NUMBER | `<input type="number" className={styles.input} />` |
| BOOLEAN | `<input type="checkbox" className={styles.checkbox} />` |
| SELECT | `<select className={styles.input} />` |
| DATE | `<input type="date" className={styles.input} />` |
| IMAGE | Custom button + `dashboard.openMediaManager()` |

Show validation errors with `<p className={styles.error}>` below the field.
