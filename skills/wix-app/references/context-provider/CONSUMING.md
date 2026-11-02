# Consuming a Context Provider

## Consumers

A context provider is consumed in one of two ways:

- **Editor Binding (no code) — the default for a provider this app defines.** Native Wix Editor elements already on the stage (a built-in Heading, Button, Text component, etc.) and the app's own Editor React components receive context values as props, connected in the Editor UI. The site owner connects a context value straight to an element's prop or event handler. An Editor React component that shows or changes this app's context declares props for those values and is bound to them.
- **Code — for a context another app registers** (a system or vertical context, such as one a Wix business app provides), **or this app's own provider when the prompt asks for code.** An Editor React component imports that context's hook by its `moduleSpecifier` (see [Importing a Context in Code](#importing-a-context-in-code)). Custom element widgets, site plugins, and all other extension types are not supported as consumers.

Two worked examples of the Editor Binding path:
- *"Hide Heading 1 by default. On each click of the Button, toggle visibility so only one heading is visible at a time."* → expose `isHeading1Hidden` **and** `isHeading2Hidden` (both `booleanValue`, each `true` when its heading should be hidden) plus a `toggleHeading` function; the site owner binds each heading's `hidden` property to its own boolean and the Button's click handler to `toggleHeading` via Editor Binding.
- *"Make the text component in my footer always show the current date automatically."* → expose the current date as a `text` context value; the site owner binds the existing text component's content to it via Editor Binding.

### Importing a Context in Code

Each extension is bundled on its own, so a relative import, or a shared file that creates the context, gives the component a private copy of the React context that never sees the provider. Only an import of the context's `moduleSpecifier` reaches it, because the site's import map resolves that specifier to the provider's own module at runtime. This needs `@wix/cli` 1.2.2 or later: older versions fail `wix generate manifest` on the import.

1. **Import only the hook, by the context's `moduleSpecifier` — never by a relative path.** The hook is the export named in that context's `contextSpecifier.hook`; import nothing else from the specifier (no constants, components or types), because manifest generation only knows how to stand in for that hook. Declare any types the component needs in the component itself. TypeScript cannot resolve the specifier, so put `// @ts-ignore` on the line directly above the import:

   ```tsx
   // @ts-ignore -- resolved at runtime through the site's import map
   import { <contextHook> } from '<context-module-specifier>';
   ```

2. **Declare the specifier on both of the component's resources** in its `.extension.ts`. Without it `wix build` cannot resolve the import, and the live site's import map leaves the context out:

   ```typescript
   resources: {
     client: {
       componentUrl,
       dependencies: { contextDependencies: ['<context-module-specifier>'] },
     },
     editor: {
       componentUrl: componentPreviewUrl,
       dependencies: { contextDependencies: ['<context-module-specifier>'] },
     },
   },
   ```

3. **The component reads the context only inside the provider.** It must sit in a section, container or page connected to that context in the Editor; anywhere else the hook throws. If it throws, fix where the component sits — see [When the Hook Throws](#when-the-hook-throws).

Only context providers can be imported this way — not function libraries or other extensions. Take the `moduleSpecifier` and hook name from the provider's `contextSpecifier` (this app's `.extension.ts`, or what the other app documents); do not guess them.

### Wix Business Solution Contexts (Stores, Blog, Bookings, Events)

When the prompt needs data a Wix business solution already holds — a product's price or stock, an event's date, a blog post — and the site already has that context, **read it with the vertical's hook instead of creating a provider that fetches or collects the data again** (no settings panel, no data fields, no Wix SDK call). Look the hook up in [VERTICAL_CONTEXTS.md](VERTICAL_CONTEXTS.md); it lists each specifier and links to the properties the hook returns. Use a provider of your own only for logic on top of that data, and read the vertical's hook inside it. A provider declares the specifier at `resources.dependencies.contextDependencies` (not under `resources.client`, which only takes `url`): any other place builds, but bundles a private copy of the context that never sees the page's provider.

A context provider that imports a context declares it once, on the provider's own `resources` (the `client.dependencies` and `editor.dependencies` form above is for Editor React components):

```typescript
resources: {
  client: { url },
  contextSpecifier: { hook, moduleSpecifier },
  dependencies: { contextDependencies: ['@wix/stores/context/product'] },
},
```

### When the Hook Throws

`<hook> must be used within <Provider>` (or "Something went wrong — This element couldn't be displayed" on the element) means the element is not inside the provider in the React tree: it sits outside the section, container or page connected to the context. Fix the placement or the connection — move the element into the connected section, connect its section to the context, or for this app's own provider bind the element's props to the context instead of reading the hook. **Never** make the hook return `null`, wrap it in a try/catch, or add a fallback default (`?? 0`): the error goes away, but the element shows a constant and never follows the provider.

Code cannot see or change where an element sits on the page. When the fix is a placement or connection the code cannot make, change no code: tell the user, in your final message, to place the element inside the section, container or page connected to the context (naming the element and the context), or to connect that section to it.
