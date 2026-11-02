# Page onLoad

> **Studio 2 editor only.** This extension type works only on sites built in the Studio 2 editor. It does not run on Harmony, the classic Wix Editor or Wix Studio (Editor X), so do not offer it for those sites. It is a context provider, and apps can't currently provide contexts: if `wix.config.json` has `"projectType": "App"`, tell the user before building.

Creates a **side-effect-only page context** for Wix CLI applications: a context whose only job is to run a piece of logic **once, the moment the page is rendered**. It exposes **no API** to other components — it is not meant to be consumed via a hook. The user attaches it to a page in the Editor (**Page Settings → Contexts**) and the side effect fires on page render.

This is the **onReady / page onLoad** use case. Typical requests:

- Send a `page_view` BI / analytics event with the page name and the visitor's locale
- Read `utm_source`, `utm_medium`, `utm_campaign` from the URL and send a `campaign_attribution` event on one named page (capturing across whichever/any page site-wide is an Embedded Script extension instead — see the callout below)
- Fire an `ab_exposure` event with the experiment id and the bucketed variant, before the visitor interacts

**Mental model:** Context → `useEffect(..., [])` → side effect. The call lives **inside** `useEffect`, with an empty dependency array so it fires exactly once on mount.

## ⚠️ This is a Wix Extension Type — register it

A page onLoad context is a **registered Wix context provider extension** (`extensions.contextProvider()`), scaffolded with `wix generate`. Do NOT ship a loose `createContext` file in `src/site/` or `src/contexts/` and wrap the app with it manually — that bypasses the Wix extension system and cannot be bound to a page in the Editor.

Because this context **exposes nothing** and only performs a side effect, do not add signals service, bindable items, or consumer-facing API machinery.

> ⚠️ **This does not auto-apply to future pages.** Binding this context to N pages only covers those N pages today — a page created next month gets nothing until someone binds it manually. **Phrasing like "whichever page," "any page," "wherever they land," or "every page" means this case, even without the words "future" or "later"** — don't wait for the request to say "future pages" explicitly. If it applies, that's an **Embedded Script extension** instead of a page onLoad context — build it from [EMBEDDED_SCRIPT.md](EMBEDDED_SCRIPT.md): it activates once and covers the whole site automatically, with no per-page setup, ever.

## Quick Start Checklist

0. [ ] **First rule out the every-page-automatically case** (see callout above) — watch for phrasing like "whichever page," "any page," or "every page load," not just literal mentions of "future" pages. If it applies, stop and build an **Embedded Script extension** instead (see [EMBEDDED_SCRIPT.md](EMBEDDED_SCRIPT.md)). Otherwise, **apply the reuse test**: glob `src/extensions/site/contexts/page-on-load*/` (the trailing `*` also catches a legacy flat `page-on-load/` folder from before task-derived naming) and read the `useEffect` in each match — does a context for this exact task already exist, **and would its current behavior also correctly satisfy this request**? If **yes** → don't create a new one — bind the existing context to any additional page(s) that need it too (no code change). If **no** (this is a genuinely new task, or the task is conceptually similar but needs different behavior) → create a new, more specifically-named context (see [Naming](#naming)).
1. [ ] Scaffold the context with the Wix CLI, from the project root:

   ```bash
   npx wix generate --params '{"extensionType":"CONTEXT_PROVIDER","name":"Page On Load <Task Name>"}'
   ```

   The CLI derives the folder and file names (`page-on-load-<task-kebab-case-name>`), the `type` (with the app's own code identifier — no need to ask the user), a fresh `id`, and the `src/extensions.ts` registration (see [Naming](#naming)). It creates `src/extensions/site/contexts/page-on-load-<task-kebab-case-name>/` with a `.tsx` and a `.extension.ts` that hold a counter example.
2. [ ] Run `npm install @wix/site` if the effect sends analytics events: `analytics` comes from it, and it is often only a transitive dependency
3. [ ] Rewrite `page-on-load-<task-kebab-case-name>.tsx`: a `createContext` + Provider that runs the requested logic inside `useEffect(() => { ... }, [])`, exports the hook, and exports the component as `default`
4. [ ] In `page-on-load-<task-kebab-case-name>.extension.ts`, replace the counter's `context` with `{ items: {} }` and its `data` with `{}` (both are required manifest fields), set `contextSpecifier.hook` to the hook you export, and add `contextSpecifier.moduleSpecifier` (the scaffold omits it, see [Naming](#naming))
5. [ ] Tell the user to attach the context to each target page in the Editor via **Page Settings → Contexts** — repeat per page when reusing one context across pages (manual step)

## Naming

Every onLoad context is named after the **task** it performs — never derived from which page(s) it happens to be bound to. A context can be bound to any number of pages over its lifetime (see the reuse test in step 0), so a page-derived name would go stale, and the target page isn't always identifiable from the request anyway. Derive `<TaskName>` (PascalCase) from what the effect does — e.g. capturing UTM/click-id params → `UtmCapture`, logging a page view → `PageView`, checking an A/B exposure → `AbExposure`. This mirrors the one-token-derivation approach [CONTEXT_PROVIDER.md](CONTEXT_PROVIDER.md) uses for `<ComponentName>`, just keyed by task instead of a page or a user-chosen component name.

| Thing | Name |
|---|---|
| Component / default export | `PageOnLoad<TaskName>` (e.g. `PageOnLoadUtmCapture`) |
| Context | `PageOnLoad<TaskName>Context` |
| Hook (`contextSpecifier.hook`) | `usePageOnLoad<TaskName>` |
| Module specifier (`contextSpecifier.moduleSpecifier`) | `<moduleSpecifierPrefix>page-on-load-<task-kebab-case-name>`, where `<moduleSpecifierPrefix>` is `@/` by default, or the prefix the user gives you. Never change it once the context exists |
| Folder and files | `page-on-load-<task-kebab-case-name>` (+ `.tsx`, `.extension.ts`) — generated by the CLI from `name` |

Always keep the `PageOnLoad` prefix — this artifact has no business identity of its own (never consumed as a real API), so the prefix marks it as this pattern at a glance. If a context for the exact same task, with the exact same behavior, already exists somewhere in the app, reuse it (see step 0) instead of duplicating it. If the behavior needs to differ even slightly, that's a different task — give it its own, more specific name rather than reusing.

## Hard Constraints

- **The side-effect call MUST live INSIDE the `useEffect`** — never at module scope. Module-scope side effects break SSR and run at import time, not on page render.
- **The dependency array MUST be empty (`[]`)** — this is what makes the effect run exactly once, on mount (page render).
- **The context MUST expose no API** — set `context: { items: {} }` in the registration. This context is not bindable or consumable from other surfaces.
- **Do NOT use signals service here** — it is required only when a provider exposes reactive state. A side-effect-only context exposes nothing.
- **A context may be bound to multiple pages** when the same task belongs on all of them — reuse it, don't duplicate it (see the reuse test in step 0). Different tasks on the same page are separate contexts, each bound independently — there's no "one context per page" limit.
- For async work (e.g. an `await`ed BI call), define an `async` function inside the effect and call it — do NOT make the `useEffect` callback itself `async`.
- NEVER use mocks, placeholders, or TODOs. Implement complete, production-ready logic.

## Reference Documentation

- [PROVIDER.md](page-on-load/PROVIDER.md) — the provider component, the extension registration, binding to a page, runtime support and code quality. Read it before writing the `.tsx`.
- [EXAMPLES.md](page-on-load/EXAMPLES.md) — documented imports and onLoad templates by use case.
