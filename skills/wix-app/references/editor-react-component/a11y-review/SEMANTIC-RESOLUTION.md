# Semantic Resolution

The scanner is library-agnostic. It does not assume Wix Design System, Material UI, Chakra, or any other specific package.

## Resolution Order

1. Native tag name
2. Explicit polymorphic props such as `as="a"` or `component="button"`
3. Local wrapper implementation
4. Installed package source or declarations in `node_modules`
5. Prop evidence such as `href`, `to`, `src`, `alt`, `role`
6. Component-name heuristics

## Semantic Types

The scanner tries to classify a JSX element as one of:

- `img`
- `a`
- `button`
- `input`
- `textarea`
- unsupported native element
- `unknown`

## Wrapper Inspection

For local imports, the scanner reads the imported file and tries to find the exported component's root JSX element. If that root resolves to another local or package component, it follows the chain until confidence drops or the recursion limit is reached.

## Package Inspection

For package imports, the scanner attempts to resolve the import source from `node_modules` and inspect the exported entry file. If the package structure hides semantics, the scanner falls back to prop and name evidence instead of pretending certainty.
