# Wix Data SDK Reference

Complete reference for working with Wix Data collections in dashboard pages.

## Installation

**IMPORTANT**: The `@wix/data` package must be installed as a dependency before use.

```bash
npm install @wix/data
```

### Troubleshooting

**If you encounter: `Cannot find module '@wix/data'`**

❌ **WRONG**: Do not create mock implementations or workarounds
✅ **CORRECT**: Install the package using `npm install @wix/data`

The `@wix/data` package is a real npm package that provides access to Wix Data collections. It must be installed before TypeScript compilation will succeed.

## Summary

- Read: `items.query('Collection').filter/sort.limit.find()` → `{ items, totalCount, hasNext }`
- Write: `items.insert | update | remove`. Ensure collection permissions allow the action

## Collection Schema Rules

- Always use the exact field keys defined in your collection schema
- Use the collection ID exactly as defined in the schema
- Use the schema's exact field types for all operations (query, insert, update, remove)
- All custom fields are stored in the `[key: string]: any` part of `items.WixDataItem`

## API Signatures & Usage

**CRITICAL**: Pay attention to the exact function signatures to avoid TypeScript errors.

```typescript
import { items } from "@wix/data";

export type WixDataItem = items.WixDataItem;

// --- Query ---

// Get all items
const result = await items.query("MyCollection").find();
// result: { items: WixDataItem[], totalCount: number, hasNext: boolean }

// Get by ID
const result = await items.query("MyCollection").eq("_id", itemId).find();
const item = result.items.length > 0 ? result.items[0] : null;

// --- Insert ---
// Takes collection ID and data object (without _id)
const created = await items.insert("MyCollection", { field: "value" });

// --- Update ---
// Takes collection ID and data object (MUST include _id)
// Explicitly spread _id to satisfy TypeScript strict null checks
const updated = await items.update("MyCollection", {
  ...itemData,
  _id: itemData._id, // Explicitly include _id to satisfy type checker
});

// ❌ WRONG - passing _id as separate parameter
await items.update("MyCollection", itemId, { field: "value" });
// ✅ CORRECT - _id is part of the data object
await items.update("MyCollection", { _id: itemId, field: "value" });

// --- Remove ---
// Takes collection ID and item ID as separate parameters
const removed = await items.remove("MyCollection", itemId);
```

## Date/Time Handling

- **Date (date-only)**: Store as a string in "YYYY-MM-DD" format (as returned by `<input type="date" />`).
- **DateTime (date + time)**: Store as a Date object. Accept the YYYY-MM-DDTHH:mm format returned by `<input type="datetime-local" />` and convert to a Date object using `new Date()`.
- **Time (time-only)**: Store as a string in HH:mm or HH:mm:ss 24-hour format (as returned by `<input type="time" />`).
- Use native JavaScript Date methods for parsing, formatting, and manipulating dates/times (e.g., `new Date()`, `toISOString()`, `toLocaleString()`, `toLocaleDateString()`).
- Always validate incoming date/time values and provide graceful fallback or explicit error handling when values are invalid.
