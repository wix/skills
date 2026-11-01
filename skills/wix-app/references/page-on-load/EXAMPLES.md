# Page onLoad Examples

Use this table to choose documented Wix SDK imports and methods for the requested page onLoad behavior. Do not add SDK imports or method names that are not documented here or already present in the user's project.

All references assume the provider shape from [PROVIDER.md](PROVIDER.md#provider-component-pattern): side-effect logic inside `useEffect(() => { ... }, [])` and no exposed API. That sample is written for one example task (`UtmCapture`) — substitute the task-derived name (see [Naming](../PAGE_ON_LOAD.md#naming)) for the actual component/hook/type.

> ⚠️ **Runtime support — NEVER use the `@wix/site-*` packages.** The `@wix/site` package (`analytics`) works and is the only `@wix/*` site module you should import here. The separate `@wix/site-*` frontend modules — `@wix/site-window`, `@wix/site-location`, `@wix/site-seo` — throw `Wix Site SDK only works in a Wix site environment` in the Studio 2 runtime, **even when the provider is correctly bound to the page and the onLoad effect is firing**. That error from a firing provider is the signature of an unsupported runtime, not a binding bug. Use `@wix/site` analytics plus browser-native APIs (`window.location.search`, `navigator.language`) — read browser globals **inside the `useEffect`** (never at module scope), defensively guarded with `if (typeof window !== 'undefined')`.

These calls are SDK frontend modules, not Velo-only APIs. Setting SEO tags is **out of scope** for page onLoad — there is no portable client-side path and a client effect can't reliably reach crawlers; set SEO server-side instead (router `response.data` / the page's SEO settings).

## Documented imports

| User request | Imports | Methods to use (portable default) | Notes |
|---|---|---|---|
| Send a BI / analytics event when the page renders | `import { analytics } from '@wix/site';` | `analytics.trackEvent(...)`; read the visitor locale from the global `navigator.language` | `analytics.trackEvent()` reports standard or custom analytics events to connected tools, and works in all runtimes. `navigator.language` is the locale source. To gate the event out of Studio/editor preview, use project-specific logic — do **not** reach for `@wix/site-window` `viewMode()` (it throws at runtime). |
| Capture `utm_source`, `utm_medium`, `utm_campaign`, or other URL campaign params | `import { analytics } from '@wix/site';` when reporting to connected analytics tools | `new URLSearchParams(window.location.search)` → `params.get('utm_source')` etc.; `analytics.trackEvent(...)` | Reading UTM params from the global `window.location.search` needs **no `@wix/site-location`** and works in all runtimes. Preview URLs may include extra Editor query params; filter for the requested campaign keys. Use project BI code instead of `analytics.trackEvent()` if the project already has a BI client. |
| Record an experiment or A/B exposure before interaction | `import { analytics } from '@wix/site';` when reporting the exposure to connected analytics tools | `analytics.trackEvent(...)` | `analytics.trackEvent()` is the documented module for **reporting** the exposure once you know the variant. There is **no documented Wix SDK frontend module for assigning / bucketing the A/B variant itself** — use the project's real experiment/bucketing API for that, and do not invent `getBucketing()` or similar helper names. |

**Never import `@wix/site-window`, `@wix/site-location`, or `@wix/site-seo`.** They throw `Wix Site SDK only works in a Wix site environment` in the runtime Wix CLI apps run in, so there is no case in this skill where they are the right choice. Use `@wix/site` analytics and browser-native APIs only.

## Typing `analytics.trackEvent` data

A custom event's data is typed `TrackingParametersCustomEvent`: only `eventCategory`, `eventAction`, `eventLabel`, `eventValue` and a literal `"*"` key are known. Free-form keys such as `utm_source` fail `tsc` (TS2353) when written inline in the call. Build the data as a variable that carries the typed fields, then pass it:

```typescript
const eventData = {
  eventCategory: 'campaign',
  eventAction: 'campaign_attribution',
  utm_source: params.get('utm_source') ?? '',
  utm_medium: params.get('utm_medium') ?? '',
  utm_campaign: params.get('utm_campaign') ?? '',
};
analytics.trackEvent('campaign_attribution', eventData);
```
