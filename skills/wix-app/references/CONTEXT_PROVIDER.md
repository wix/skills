# Context Provider

> **Studio 2 sites only** (its editor calls this extension a **Data Source**). Not for Harmony, classic Wix Editor or Wix Studio. Apps can't currently provide contexts: if `wix.config.json` has `"projectType": "App"`, tell the user before building.

Creates context provider components for Wix CLI applications. Context providers are logical components (no UI) that can be added to any page, container, or section in the Editor. They expose shared state and functionality that child components consume via a React hook.

**You MUST read [CONTEXT_PROVIDER_SPEC.md](context-provider/CONTEXT_PROVIDER_SPEC.md) before implementing a context provider.** It contains the complete manifest structure, all data types, and type constraints.

## ⚠️ This is a Wix Extension Type — a React Context Alone Is Not One

A Wix context provider is an ordinary React context — `createContext`, a provider component, a hook — that is **registered as an extension** with `extensions.contextProvider()` from the project's Wix extension builder package. The React half is standard React, and this skill does not restate it. What makes it a Wix context provider is the registration, the file location, and the manifest shape. Writing the React part and skipping those is the mistake this section rules out.

**DO NOT:**
- Leave a `SomeContext.tsx` (or similar) unregistered — a React context with no `extensions.contextProvider()` entry is invisible to the Editor; scaffold with `wix generate` (see the [Quick Start Checklist](#quick-start-checklist))
- Build an Editor React component that wraps a `SomeProvider` — this bypasses the Wix extension system entirely
- Put context files in `src/site/`, `src/contexts/`, or `src/site/widgets/`

**DO:**
- Let every consumer in this app — native Editor elements and the app's own Editor React components — consume it through Editor Binding by default; consumers need no registration (see [Consumers](context-provider/CONSUMING.md#consumers))

## Quick Start Checklist

Follow these steps in order when creating a context provider:

1. [ ] Scaffold the provider with the Wix CLI, from the project root:

   ```bash
   npx wix generate --params '{"extensionType":"CONTEXT_PROVIDER","name":"<Provider Name>"}'
   ```

   The CLI derives the folder (`counter-context`) from `name`, builds the `type` as `<codeIdentifier>.<camelCaseName>` with the app's own code identifier (no need to ask the user for it), generates a fresh UUID, and registers the extension in `src/extensions.ts`.
2. [ ] The scaffolded `<provider-kebab-case-name>.tsx` and `<provider-kebab-case-name>.extension.ts` (in `src/extensions/site/contexts/<provider-kebab-case-name>/`) hold a counter example (`count`, `increment`, `decrement`, `setCount`, hook `useCounterContext`, data prop `initialCount`) — replace it in full, leaving none of it behind unless the request is a counter
3. [ ] Add `contextSpecifier.moduleSpecifier` to the generated `<provider-kebab-case-name>.extension.ts` (see [Hard Constraints](#hard-constraints)) — the scaffold omits it
4. [ ] Install any that are not already present: `@wix/editor-react-types` (as a devDependency). Add `@wix/react-use-promise-polyfill` as well **if and only if** the provider awaits a promise (see step 5) — it supplies the `use()` hook. The scaffold's `@preact/signals-react` dependency is not used by this skill's providers: write plain React state in the provider and drop the signals import
5. [ ] Decide whether producing any context value involves a promise — any Wix SDK call, any `fetch`, any `await`. If it does, read [LOADING.md](context-provider/LOADING.md) **now, before writing any code**: it changes the shape of the next step from one component into three. Skipping it ships a blank page on load (see [Async Data and the Render Gate](context-provider/PROVIDER_PATTERN.md#async-data-and-the-render-gate))
6. [ ] Rewrite both files. In `.tsx`: React context, hook export, provider component, and a derived value for every condition in the request (see [Derived Values](context-provider/DERIVED_VALUES.md#derived-values-mandatory)). In `.extension.ts`: set `context.items`, `data` and `contextSpecifier.hook` to match, declaring each text and number value once with no richText twin (see [Plain Values, Not RichText Twins](context-provider/DERIVED_VALUES.md#plain-values-not-richtext-twins))

`extensions` comes from `@wix/astro/builders/experimental` (current scaffold) or `@wix/custom-extensions` (older scaffolds). Both work: keep the import the scaffold wrote. If `tsc` reports that `contextProvider` does not exist on `extensions`, upgrade that package.

## Hard Constraints

- **State is plain React state** — `useState` and `useReducer`, exactly as in any React context, plus a `useRef` for a value that must not trigger a re-render. Normal React rules apply and this skill does not restate them. The one placement rule that is specific to this pattern: an initial data promise for `use()` must be held in a component that does **not** suspend, or React discards the hook state and the initializer re-runs forever — see [Lock the initial promise](context-provider/LOADING_DESIGN.md#lock-the-initial-promise)
- **The signals service is an optimization, not the default** — `useService(SignalsServiceDefinition)` from `@wix/services-manager-react` exists for a provider with a measured render problem, and splitting one wide provider into smaller per-domain providers usually beats it. A signal write also gives up React behavior a plain `setState` keeps ([why](context-provider/LOADING_RULES.md#commit-later-fetches-only-when-the-data-is-ready)). Performance tuning is otherwise out of scope for this skill
- **A provider that opens, closes, or reads a lightbox (popup) also follows [LIGHTBOX.md](LIGHTBOX.md)** — never `@wix/site-window`, which throws in Studio 2, and declare the services it uses in `resources.dependencies.serviceDependencies`
- **Always set `contextSpecifier.moduleSpecifier` to `<moduleSpecifierPrefix><provider-kebab-case-name>`** (e.g. `@/counter-context`). `<moduleSpecifierPrefix>` is `@/` by default, or the prefix the user gives you. Module specifiers are unique across all of Wix, not per app: an unprefixed name such as `counter-context` may already belong to another app, and the checkpoint then fails with `Error during component specifier upsert`
- **Never change the `moduleSpecifier` of a provider that already exists** — a registered module specifier cannot be renamed, and the checkpoint rejects the change with the same `Error during component specifier upsert`. The prefix rule applies to new providers only
- **Fixing `Error during component specifier upsert`:** for a provider added since the last checkpoint, set its `moduleSpecifier` to `<moduleSpecifierPrefix><its current value>`. For a provider that already existed, restore the `moduleSpecifier` it had before (`git log -p -- <its .extension.ts>`). Change only that string — `type`, `hook`, the folder and the file names stay as they are
- **The boolean dataType is `booleanValue` — NOT `boolean`**, which is a TypeScript primitive and not a valid `dataType`. Disallowed data types are listed in [CONTEXT_PROVIDER_SPEC.md](context-provider/CONTEXT_PROVIDER_SPEC.md)
- `<provider-kebab-case-name>` below is the kebab-case of `name` (e.g. `Counter Context` → `counter-context`); the CLI uses it for the folder and both files
- **All context values go inside the `context.items` wrapper** — `context` has exactly one key: `items`. Never place value definitions directly under `context`, even when a value is itself named `items` (correct: `context: { items: { items: {…}, addItem: {…} } }`). The flattened form compiles and builds cleanly but fails checkpoint creation with `context.items[dataType] must be an object`
- The hook name in `contextSpecifier.hook` must match the exported hook in `<provider-kebab-case-name>.tsx`
- Never import a provider by a relative path or through a shared file that creates the context — code imports a context only by its `moduleSpecifier` (see [Importing a Context in Code](context-provider/CONSUMING.md#importing-a-context-in-code))
- NEVER use mocks, placeholders, or TODOs — implement complete, production-ready functionality

## Architecture

The scaffold creates `<provider-kebab-case-name>.tsx` and `<provider-kebab-case-name>.extension.ts`; the extension file registers the provider with `extensions.contextProvider()` (context model, `data` props, `contextSpecifier`). The `.tsx` is a React component that:

- Creates a React context using `createContext`
- Exports a hook for child components (e.g., `useCounterContext`)
- Exports the provider component as the `default` export
- Accepts configuration props defined in the `data` field of the registration
- Provides state and functions to child components via context
- Optionally exports `injectAccessTokenGetter` for access token injection

## Reference Documentation

| When | File |
| --- | --- |
| Before any provider | [CONTEXT_PROVIDER_SPEC.md](context-provider/CONTEXT_PROVIDER_SPEC.md), [CONTEXT_SPEC_ITEMS.md](context-provider/CONTEXT_SPEC_ITEMS.md), [CONTEXT_SPEC_FUNCTIONS.md](context-provider/CONTEXT_SPEC_FUNCTIONS.md) |
| Writing the provider and its manifest | [PROVIDER_PATTERN.md](context-provider/PROVIDER_PATTERN.md), [DERIVED_VALUES.md](context-provider/DERIVED_VALUES.md), [MANIFEST.md](context-provider/MANIFEST.md) |
| Consuming a context | [CONSUMING.md](context-provider/CONSUMING.md) |
| Any async provider | [LOADING.md](context-provider/LOADING.md), then [LOADING_PATTERN.md](context-provider/LOADING_PATTERN.md), [LOADING_DESIGN.md](context-provider/LOADING_DESIGN.md), [LOADING_RULES.md](context-provider/LOADING_RULES.md), [LOADING_REQUIREMENTS.md](context-provider/LOADING_REQUIREMENTS.md) |
| Reading Stores, Blog, Bookings or Events data | [VERTICAL_CONTEXTS.md](context-provider/VERTICAL_CONTEXTS.md) |
| A worked provider | [EXAMPLES.md](context-provider/EXAMPLES.md) |
