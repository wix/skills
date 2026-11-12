# Manifest Build Errors

Use this reference only when `npx wix build` or `npx wix generate manifest`
exits with an error or prints a warning, or when saving or releasing rejects the
manifest. For a build or generation error, read the error name from the first token before the colon
(`IoError:`, `ParseError:`, `NotFoundError:`, or `ValidationError:`); for a save error, match its message. Then apply the matching fix.

| Error | Fix |
| --- | --- |
| `IoError: Failed to load compiled bundle` | Re-run `npx wix build`; fix any TypeScript/build errors it reports first |
| `IoError: Failed to access component "X" from compiled bundle` | Corrupted artifact — delete `dist/`, re-run `npx wix build` from scratch |
| `IoError: CSS selector matching failed for "X"` | Fix invalid selector syntax in `<componentName>.module.css` |
| `IoError: Component "X" render produced no root element` | Component returns null or bare text — ensure it always renders a root JSX element |
| `IoError` (render phase, no other pattern) | SSR crash — remove browser-only APIs (`window`, `document`, `localStorage`) used at render time; ensure props have defaults |
| `NotFoundError: File not found` | Restore the missing source file or fix its registered/imported path; do not re-scaffold an existing component |
| `NotFoundError: Component "X" was not found as a named export` | Confirm `component.tsx` has a default export and re-run `npx wix build` |
| `ParseError: Failed to parse TypeScript config` | Fix `tsconfig.json`; run `npx tsc --noEmit` to surface the error |
| `ParseError: Failed to extract component types from "X"` | TypeScript error in the component — run `npx tsc --noEmit` and fix |
| `ParseError: Failed to compile "<file.scss>"` | SCSS syntax error — line/column is in the error message |
| `ParseError: Failed to parse CSS file for component "X"` | CSS syntax error in `.module.css` — line/column is in the error message |
| `ValidationError: Component "X" produced an invalid editorElement` with `selector ".x" is already used by <path>` or `part name "x" is already used by an ancestor element`; on save or release, `Selector ".x" is used by more than one element: <paths>` | One part name sits in two places in the part tree. In component source, rename the copy inside the other part, prefixed with that part's name (each copy, when they sit in two different parts), with its own `elementProps` key and state classes per `PARTS.md`, then rebuild and regenerate. Never edit `*.generated.ts` |

After each fix, re-run `npx wix build && npx wix generate manifest` to confirm.

## Warnings

The build can also print non-fatal warnings such as
`.item is missing from initial render (<file>)`.
Read every warning and fix it; this is mandatory, with one exception below.

- **A `.tsx` file in parentheses**, or **a part's own class** (`.errorMessage`,
  `.item`) in a `.css` file, means the part is not mounted in the extraction
  render. Keep it mounted and hide it with `hidden` or CSS per `PARTS.md`,
  then re-run build and manifest generation.
- **A class applied only by state** (`.contentOpen` from `open && styles.contentOpen`)
  is expected: the part is mounted and only the state look is absent. Leave the
  markup and CSS unchanged; do not force the state on or remove the styling.

## Checklist

- [ ] The fix matches the reported error name and message.
- [ ] Build errors are resolved before manifest generation is retried.
- [ ] Both build and manifest generation pass after the fix.
