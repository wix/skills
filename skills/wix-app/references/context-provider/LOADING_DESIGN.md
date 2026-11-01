# Loading Design Decisions

## Name the Entity Type, Do Not Derive It

Type the fetched data from the SDK's exported entity — `services.Service`, `members.Member` — never from the method that fetches it. `Awaited<ReturnType<typeof services.getService>>` looks like it should work and does not: Wix auto-generated SDKs export each method as an intersection that includes its own call signature, so `ReturnType` resolves to the **signature interface** instead of the response.

The failure is nasty because the alias itself compiles. It silently becomes the wrong type and errors only at the first property access, far from the cause:

```
error TS2339: Property 'payment' does not exist on type 'GetServiceSignature'
```

Every variation of the idiom fails the same way, including indexing into the derived type — `['find']`, `['member']`. Reach for the exported entity type instead, whatever the SDK.

## Why It Splits Into Three Components

Nothing above replaces the [Provider Component Pattern](PROVIDER_PATTERN.md#provider-component-pattern) — `BookingServiceContextInternal` *is* that pattern, unchanged: the same `createContext`, the same exported hook, the same state, the same `api` object and `Context.Provider`. Async only wraps it. Two components are added around it, and `use()` is the reason for both:

> ⚠️ **The `<Suspense>` boundary must live in a different component than the `use()` call.** A component that suspends never renders the JSX it returns, so a boundary it returns is never mounted — React walks up to the nearest *ancestor* boundary instead and the fallback is dead code. Under server rendering this failure is invisible (the data resolves before any HTML is sent), so it ships quietly and only surfaces on client-side navigation.

> ⚠️ **The initial promise must be created in a component that does not suspend.** React discards the hook state of a component that suspends during its initial mount — the render never commits. So a `useState(() => fetch(…))` *inside* the suspending component re-runs its initializer on every retry, producing a new pending promise each time and suspending forever. The subtree never leaves the fallback and the fetch repeats in a loop.

Hence the two additions: `BookingServiceContextProvider` on the outside, holding the boundary and the promise and never suspending — it takes over as the default export the Wix runtime loads — and `BookingServiceContextFallback`, a stripped copy of the same provider holding placeholder values. All three carry a `displayName`, as [Key Rules for Provider Components](PROVIDER_PATTERN.md#key-rules-for-provider-components) requires.

### The fallback is a provider, not `children`

A bare `fallback={children}` leaves those children with no provider above them: the hook named in `contextSpecifier.hook` throws when the context is `null`, and any element bound to this context has nothing to read. The throw happens *while loading*, but the damage is permanent — the error boundary that catches it latches, so the section stays broken after the data arrives instead of recovering.

That is why `placeholderApi()` spells out **every key the manifest declares**, at placeholder values. A missing key breaks the binding that reads it.

One caveat on what the fallback buys. Children are **rendered** throughout, which is why unbound elements never disappear. But the fallback subtree and the primary subtree are different positions in the React tree, so when the promise resolves React unmounts one and mounts the other — element instances are replaced. Nothing bound to the context notices, and native text, buttons and images hold nothing to lose, but an element carrying its own internal state, a partly-filled form input or a playing video, resets at that moment. Keep such elements outside the provider if that matters.

### Lock the initial promise

`useState(() => fetchService(serviceId))` holds the initial promise. Nothing ever writes it, so it never triggers a re-render — what matters is the initializer form, and where it lives.

**What matters is which component holds it, not which hook.** A component that suspends during initial mount never commits, so React throws away *all* of its hook state and runs it again on retry. For the data state that is harmless: the retry re-seeds it from the resolved data, which is exactly what `useState(initialService)` inside the suspending component does. For a promise it is fatal: a new promise is pending, so `use()` suspends again, and the cycle repeats.

So the promise goes in the outer component, which never suspends and therefore commits normally. `useState` is the right hook for it there because its initializer is contractually once per mount — but creating it inline in the render body, or in a `useMemo` keyed on the dependency, re-suspends on every dependency change and blanks the subtree again.

Two consequences follow. In dev, a hot update that remounts the provider takes its hook state with it, so the promise is re-created and the data refetches. That is dev-only noise, not a correctness problem.

The other is scope: the promise carries the `serviceId` **as it stood at mount**, so a later change to that data prop does not refetch. The exposed function — `showService` here — is the only route to different data, which is why a provider whose id can change has to expose one. Do not reach for a dependency-keyed `useMemo` to close that gap; it re-suspends and blanks the subtree, as above.

### Does the provider refetch?

Answer this before writing the internal component; both answers change what it contains. Some providers go back to the data source after the first load — a category change, a date change, a different id. Plenty do not: they fetch once, and every later interaction filters, sorts or selects from what is already in memory.

**Scope, so this is not read too widely.** If it *does* refetch, read on. If it does not, the rest of this subsection — all three paragraphs, including the one on dead code — still applies to you; only the next two subsections — [Commit later fetches only when the data is ready](LOADING_RULES.md#commit-later-fetches-only-when-the-data-is-ready) and [Values that describe the data](LOADING_RULES.md#values-that-describe-the-data) — are refetch-only. Everything else in this file applies to every async provider, [Read the clock once](LOADING_RULES.md#read-the-clock-once-next-to-the-fetch) included.

For one of those, `isFetching` and the request-id guard have no role. Leave both out. `isPlaceholderHidden` still exists as a context item and is still `false` during the initial suspension, supplied by the fallback provider — it simply never becomes `false` again.

**The data state goes too.** Nothing writes it, so it is not state — it is a wrapper around a value that never changes. Read the resolved value from `use()` directly and derive the context items from that. A `useState` whose setter is never called is the most common form this dead code takes, precisely because the rest of the pattern makes it feel mandatory: state is for values that change, and a value that arrives once and never updates is not one.

Do not generate the machinery and then neutralise it. An import that is never called, a `void someUnusedThing;` statement to quiet the linter — each is dead code, and Hard Constraints rules out stubs. Either the provider refetches and the machinery is live, or it does not and the machinery is absent.
