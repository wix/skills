# Loading and Async Data

**Applies to every promise, without exception** — any Wix SDK call, any `fetch`, any backend or service-plugin call, any `await`. A fast promise is not an exemption: it still resolves after the first render, so the gate still closes. Only a provider whose state is entirely synchronous — a counter, a toggle, the current date — needs nothing here; for one of those see [Counter with a goal-gated banner](EXAMPLES.md#counter-with-a-goal-gated-banner).

| Section | Read it for |
|---|---|
| [The Render Gate](#the-render-gate) | Why an async provider blanks its whole subtree |
| [Why not `useEffect`](#why-not-useeffect) | The obvious alternative, and why it loses SSR |
| [The Pattern](LOADING_PATTERN.md#the-pattern) | The complete provider and registration — copy this |
| [Name the Entity Type, Do Not Derive It](LOADING_DESIGN.md#name-the-entity-type-do-not-derive-it) | The one type-derivation trap; it breaks against every SDK |
| [Why It Splits Into Three Components](LOADING_DESIGN.md#why-it-splits-into-three-components) | What `use()` forces, and the two bugs it causes |
| [The fallback is a provider, not `children`](LOADING_DESIGN.md#the-fallback-is-a-provider-not-children) | Why a bare fallback breaks the section permanently |
| [Lock the initial promise](LOADING_DESIGN.md#lock-the-initial-promise) | Where the promise must live, and the substitutes that fail |
| [Does the provider refetch?](LOADING_DESIGN.md#does-the-provider-refetch) | What to leave out when it does not — including the data state |
| [Commit later fetches only when the data is ready](LOADING_RULES.md#commit-later-fetches-only-when-the-data-is-ready) | Why the ordering is what keeps stale content on screen |
| [Values that describe the data](LOADING_RULES.md#values-that-describe-the-data) | Why a label must not run ahead of the rows it labels |
| [Read the clock once, next to the fetch](LOADING_RULES.md#read-the-clock-once-next-to-the-fetch) | Why `new Date()` in a render body discards the server render |
| [The Loading Pair Is Mandatory](LOADING_REQUIREMENTS.md#the-loading-pair-is-mandatory) | `isPlaceholderHidden` / `isContentHidden` — what each means and what to bind |
| [Server Rendering and the Fallback](LOADING_REQUIREMENTS.md#server-rendering-and-the-fallback) | When the fallback is visitor-facing |
| [The Fetch Wrapper Must Never Reject](LOADING_REQUIREMENTS.md#the-fetch-wrapper-must-never-reject) | Error handling that does not take down the subtree |

### The Render Gate

A context provider makes **one binary decision for its entire subtree**: render everything, or render nothing. While its initial data is unresolved nothing inside it renders, and that decision is not scoped to the bindings — the provider cannot tell which children read its data, so an unbound "Contact Us" button disappears along with the service name it has nothing to do with. Only the page shell outside the provider keeps rendering.

There is no platform-level loading mechanism. No skeleton, no spinner, no phased reveal. Any loading experience a page has was built by the provider.

### Why not `useEffect`

Fetching in a `useEffect` and writing the result to state also avoids the blank subtree, with none of the machinery below — no polyfill, no split, no fallback. It is the obvious move, and it is the wrong one here: **effects do not run on the server.** The server would render the provider with no data and ship that HTML, so the visitor gets the content popping in after hydration, and a crawler that does not execute JavaScript sees an empty section. Resolving the promise with `use()` is what lets the server render real content — that is the whole point of the pattern, and the reason it is worth the extra components.

Use `useEffect` for side effects that genuinely belong on the client. Do not use it to load the data a context provider exposes.
