# Manifest Build Errors

Use this reference only when `npx wix build` or `npx wix generate manifest`
exits with an error. Read the error name from the first token before the colon
(`IoError:`, `ParseError:`, or `NotFoundError:`), then apply the matching fix.

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

After each fix, re-run `npx wix build && npx wix generate manifest` to confirm.

## Checklist

- [ ] The fix matches the reported error name and message.
- [ ] Build errors are resolved before manifest generation is retried.
- [ ] Both build and manifest generation pass after the fix.
