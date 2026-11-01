# Loading Requirements: The Pair, Server Rendering and the Fetch Wrapper

## The Loading Pair Is Mandatory

**Every provider with an async data source exposes `isPlaceholderHidden` and `isContentHidden` as `booleanValue` context items.** Not when the request asks for a loading treatment — always: a binding cannot compute either one, so a manifest that omits them can never have a loading treatment added without rebuilding the provider.

The two are **independent, not complements** — during a refetch both are `false`, because stale content stays visible *and* the loading visual shows:

| Moment | `isPlaceholderHidden` | `isContentHidden` | What renders |
|---|---|---|---|
| First load, promise pending | `false` | `true` | Loading visual only |
| Loaded | `true` | `false` | Content only |
| Refetch after a change | `false` | `false` | Stale content **and** the loading visual |
| Refetch failed, earlier data still held | `true` | `false` | The earlier content, indistinguishable from *Loaded* — give failure its own boolean if the visitor should be told |
| Fetch failed with nothing cached | `true` | `true` | Neither — add an explicit empty-state boolean if the request wants a message here |

Only elements explicitly bound are affected — static, unbound elements stay visible throughout. Both booleans depend on the fallback provider: while the subtree is suspended without one, nothing renders at all, so no visibility binding can fire.

⚠️ **`isContentHidden` means "no result arrived", not "the result is empty".** A category with genuinely zero products has data — an empty list is an answer. Deriving it as `products.length === 0` permanently hides that category's content elements while `isPlaceholderHidden` is also `true`, so the visitor gets a blank section with no explanation. Type the value as `T | null`, seed it from the resolved promise, and derive `isContentHidden` from `=== null`. An empty result is a *different* condition and gets its own boolean if the request wants a message for it — `isEmptyStateHidden`, by rule 1 of [Derived Values (Mandatory)](DERIVED_VALUES.md#derived-values-mandatory).

⚠️ **Every other boolean, count or total describing the *content* of the result must also require that a result arrived.** A failed fetch resolves to `null`, and the `null ?? []` you render from is indistinguishable from a successful empty answer — so `isFullyStockedMessageHidden: list.length > 0` is **`false` during an outage**, showing the reassuring message over a broken page, and a `0` derived from a failure reads as a real zero. Carry the arrived check into each one: `isFullyStockedMessageHidden: currentProducts === null || list.length > 0`. Anything a visitor could mistake for good news needs it.

Where `isPlaceholderHidden` comes from depends on whether the provider refetches. If it does, it needs its own state, as `isFetching` above. If it does not, there is nothing to track: the fallback provider supplies `isPlaceholderHidden: false` while the promise is pending and the internal component hard-codes `true`, because by the time it renders the data has arrived — see [Does the provider refetch?](LOADING_DESIGN.md#does-the-provider-refetch).

Either way, `useTransition`'s `isPending` does **not** work: it covers only the re-render, not the fetch that precedes it, so it is true for a fraction of a frame.

## Server Rendering and the Fallback

The pattern is correct either way, so do not assume — but the fallback matters more in one case than the other. Server-rendered, the promise resolves before the HTML is sent and the fallback is only reached on client-side navigation. Not server-rendered, `use()` suspends in the browser and **the fallback is what the visitor actually sees** on first load, reporting `isPlaceholderHidden: false` and `isContentHidden: true`.

The promise resolves first because the renderer buffers rather than streams: Astro's React renderer calls `renderToPipeableStream` and waits for `onAllReady` before emitting anything, so the delivered HTML carries the resolved content and no fallback markup at all. The exception is Astro's `experimentalDisableStreaming`, which switches to `renderToString` — that does not support Suspense, so React emits the **fallback** into the HTML instead, with a template warning saying as much, and the server render this pattern exists to preserve is gone. A project with that flag set should be treated as not server-rendered.

## The Fetch Wrapper Must Never Reject

`use()` rethrows the rejection reason, which propagates to the nearest error boundary — and the provider has no control over what that boundary renders. So all handling belongs inside the wrapper, once, as in `fetchService` above. **That placement covers later fetches too**, which a `.catch()` bolted onto the `useState` call does not: a rejected refetch that nobody caught leaves `isFetching` stuck at `true` — `isPlaceholderHidden` stays `false` and the loading visual never goes away — plus an unhandled rejection. The `.then()` in `showService` simply never runs.

The `if (!serviceId)` guard ahead of the call is a separate concern, and it is **not** there to catch a synchronous throw. Wix auto-generated SDK methods are `async` functions, so a bad id rejects rather than throwing, and a call-site `.catch()` would in fact catch it. The guard is there because the id is validated **on the server**: an empty id spends a network round-trip to come back `INVALID_ARGUMENT`, and `.catch(() => null)` then flattens that into the same `null` as a genuine outage. Answer the missing-id case locally instead of paying for a request whose only possible reply is a failure.

Resolve to `null`, not an empty value. `isContentHidden` reads `=== null`, so a failure that resolved to `[]` or `''` would report the content as visible and the elements would render empty with no loading visual and no explanation.

**`undefined` counts as an empty value here, and it is the easy one to ship by accident.** Wix responses wrap the entity in an optional field, so the obvious unwrap hands back `undefined` rather than `null` — `members.getCurrentMember()` resolves to `{ member?: Member }`, so `.then((r) => r.member)` is `undefined` for a signed-out visitor, and `.then((r) => r.items)` is `undefined` whenever the response names that collection something else. Since `undefined === null` is `false`, `isContentHidden` goes `false` with every field empty and `isPlaceholderHidden` `true` — the exact failure this section is about, arrived at from the other direction. **Normalise in the wrapper: `.then((r) => r.member ?? null)`.** Doing it there keeps one place responsible for the contract, so every `=== null` downstream can be trusted.

Note what this makes indistinguishable. A rejected call resolves to `null`, and so does an unauthorized one — and `null` means "no result", which renders as an empty section rather than as an error. That matters most for a data source that authenticates: the request starts in a `useState` initializer during the provider's first render, which can precede whatever access token the platform injects, and a first read that comes back unauthorized looks exactly like a page with nothing on it. If the request calls for an error or empty message, give it its own boolean rather than reading it off `isContentHidden`, which cannot tell the two apart.
