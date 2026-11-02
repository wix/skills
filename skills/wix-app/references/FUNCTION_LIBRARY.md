# Function Library

> **Studio 2 editor only.** This extension type works only on sites built in the Studio 2 editor. It does not run on Harmony, the classic Wix Editor or Wix Studio (Editor X), so do not offer it for those sites. Apps can't use it: if `wix.config.json` has `"projectType": "App"`, tell the user before building.

A function library bundles reusable functions the Wix editor and runtime can call — formatters, math helpers, data transformers, event handlers. It is a registered `extensions.functionLibrary()` extension, not a plain utility module: functions in `utils.ts`, `helpers.ts` or `src/lib/` are invisible to the editor.

**You MUST read [FUNCTION_LIBRARY_SPEC.md](function-library/FUNCTION_LIBRARY_SPEC.md) before implementing a function library.** It holds the manifest fields, DOM event types and type constraints; the data types are in [DATA_TYPES.md](function-library/DATA_TYPES.md).

## Quick Start Checklist

1. [ ] Scaffold with the Wix CLI, from the project root:

   ```bash
   npx wix generate --params '{"extensionType":"FUNCTION_LIBRARY","name":"<library-name>"}'
   ```

   `name` is kebab-case (e.g. `car-formatting`) — the CLI rejects spaces and uppercase. It derives the folder, `type`, `id` and the `src/extensions.ts` registration from it, and creates `src/extensions/site/function-libraries/{library-name}/{library-name}.ts` (a `formatPrice` stub) and `{library-name}.extension.ts`.
2. [ ] In `{library-name}.extension.ts`, add `resources.moduleSpecifier` (the scaffold omits it, see [Hard Constraints](#hard-constraints)) and set `name` to a Title Case display name (e.g. `Car Formatting`, max 100 chars) — the scaffold writes the kebab-case name there, and the editor lists the library under it
3. [ ] Install `@wix/editor-react-types` as a devDependency if not already present
4. [ ] Replace the `formatPrice` stub in `{library-name}.ts` with your named exports, and the `formatPrice` entry in the `functions` map with one entry per function (parameters, return type, async flag). Keep the CLI-generated `id`

`moduleSpecifier` sits directly under `resources`, next to `client`, not inside it. `tsc` does not catch a misplaced one:

```typescript
resources: {
  client: { /* generated, leave as is */ },
  moduleSpecifier: '@/car-formatting',
},
```

`extensions` comes from `@wix/astro/builders/experimental` (current scaffold) or `@wix/custom-extensions` (older scaffolds). Both work: keep the import the scaffold wrote. If `tsc` reports that `functionLibrary` does not exist on `extensions`, upgrade that package.

## Hard Constraints

- **Always set `resources.moduleSpecifier` to `<moduleSpecifierPrefix><library-name>`** (e.g. `@/car-formatting`). `<moduleSpecifierPrefix>` is `@/` by default, or the prefix the user gives you. Module specifiers are unique across all of Wix, not per app: an unprefixed name may already belong to another app, and the checkpoint then fails with `Error during component specifier upsert`
- **Never change the `moduleSpecifier` of a library that already exists** — a registered module specifier cannot be renamed. The prefix rule applies to new libraries only
- **Exported function names MUST exactly match the keys in the `functions` map** — a mismatch means the editor references a function that doesn't exist at runtime. Named exports only, no `export default`
- **The boolean type is `booleanValue` — NOT `boolean`**, which is a TypeScript primitive and not a valid `dataType`
- **Match each declared data type to its runtime value.** `richText` requires a `RichText` object from `@wix/editor-react-types` with `text`, `html`, and `linkList`; an HTML string is not one. For plain strings, declare `text`. See [RichText values](function-library/DATA_TYPES.md#richtext-values)
- **Do NOT use disallowed data types** (listed in the spec), at most 10 parameters per function, each parameter has exactly one of `dataType` or `domEvent`, and optional parameters come last
- Do NOT invent or assume new types, modules, or imports
- NEVER use mocks, placeholders, or TODOs — implement complete, production-ready functionality

## Library Implementation Pattern

```typescript
import type { Text, NumberType, WebUrl } from '@wix/editor-react-types';

export function capitalize(text: Text): Text {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

export function sum(numbers: NumberType[]): NumberType {
  return numbers.reduce((acc, num) => acc + num, 0);
}

export async function fetchData(url: WebUrl): Promise<Text> {
  const response = await fetch(url);
  return await response.text();
}

export function logEvent(eventName: Text): void {
  console.log(`[event] ${eventName}`);
}
```

### Key Rules for Library Files

- **Use types from `@wix/editor-react-types`** — `Text`, `NumberType`, `BooleanValue`, `WebUrl`, etc. — these match the runtime format Wix provides. Other types are exported under their PascalCase name too (`LocalDate`, `TextEnum`, `RichText`); grep the package rather than guessing. A `textEnum` parameter is typed `TextEnum` (a `string`)
- **DOM event parameters** (`domEvent`) take the matching DOM type: `POINTER` → `PointerEvent`, `KEYBOARD` → `KeyboardEvent`, `FOCUS` → `FocusEvent`, `CHANGE` → `Event`, `SUBMIT` → `SubmitEvent`
- **Functions can be async** — mark with `async` and return a `Promise<T>` when the registration sets `async: true`. `returns` describes the resolved value's type, not the Promise
- **Void functions** — functions with no return value should return `void`; omit `returns` in the registration
- **No side-effect imports at module scope** — keep the file SSR-safe

## Function Definitions

Each key of the `functions` map is a function name and each value a `Function` object — see [FUNCTION_LIBRARY_SPEC.md](function-library/FUNCTION_LIBRARY_SPEC.md) for its fields and [PARAMETER_PATTERNS.md](function-library/PARAMETER_PATTERNS.md) for parameter examples (optional, complex objects, arrays, textEnum, async, void, DOM events).

## Reference Documentation

- [Function Library Specification](function-library/FUNCTION_LIBRARY_SPEC.md) — Complete manifest structure, all types, and constraints
- [Code Quality](CODE_QUALITY.md) — requirements for every generated file
- [Data Types](function-library/DATA_TYPES.md) — Disallowed and available data types, and `richText` values
- [Parameter Patterns](function-library/PARAMETER_PATTERNS.md) — All parameter type examples (optional, complex objects, arrays, textEnum, async, void, DOM events)
- [Complete Examples](function-library/EXAMPLES.md) — Full function library examples with registration and implementation
- [Troubleshooting](function-library/TROUBLESHOOTING.md) — Common issues and solutions
