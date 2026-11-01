# Loading Rules

### Commit later fetches only when the data is ready

**What keeps stale content on screen is the ordering.** The previous data is never cleared: the fetch runs, and only a *successful* result is written to state. Nothing is re-suspended and nothing is emptied in between, so the old content simply stays until the new content replaces it — with `isPlaceholderHidden` `false` alongside it so a loading hint can show without the content vanishing. Commit only once the data is fully ready. A provider that clears its data before fetching blanks its own subtree, and no wrapper repairs that.

⚠️ **A failure settles too, and writing it clears the data just as surely.** The wrapper resolves to `null` rather than rejecting, so a refetch that fails hands the commit a perfectly settled `null` — and `setService(null)` sends `isContentHidden` to `true` while `setIsFetching(false)` sends `isPlaceholderHidden` to `true`. That is the *fetch failed with nothing cached* row of the table below, reached when something very much was cached: the visitor was reading service A, clicked B during an outage, and A vanished into a blank section with no loading visual and no explanation. Guard the write, as the example does — a failed refetch should leave the previous data untouched. If the request wants the visitor told, that is a separate boolean, because `isContentHidden` stays `false` with the stale content still on screen.

Note what the guard also does, since `null` carries two meanings here. A genuine "no such service" answer is `null` as well, so it is ignored too and the previous service stays up. That is the right trade for a refetch — silently keeping the last good content beats blanking the section — but it means a provider whose data can legitimately become empty needs the wrapper to say so with a value, an empty array or an explicit sentinel, rather than with `null`.

⚠️ **The ordering is what keeps the content up, not `startTransition`.** Later fetches here never suspend — `showService` resolves the promise itself and commits with `setState` — so there is no fallback to avoid and no transition to mark. Wrapping the commit adds machinery that does nothing, which [Does the provider refetch?](LOADING_DESIGN.md#does-the-provider-refetch) rules out.

It does matter if a later fetch ever *does* drive a new suspension, and it is one reason the state here is plain React state: verified against React 18.3.1, a suspension driven by `useState` inside `startTransition` keeps the old content on screen, while the identical suspension driven by a signal write hides it and shows the fallback anyway. `useService` subscribes the component through `useSignals`, which is `useSyncExternalStore`, and React gives those updates synchronous priority to avoid tearing — so the transition marking never reaches a signal.

Because two fetches can overlap — a visitor clicking faster than the network answers — a slower earlier response can still land after a newer one and overwrite it. That is what `latestRequest` guards, held in a ref so the guard itself never triggers a re-render.

### Values that describe the data

The new data commits in one step, but the selection the visitor just made commits immediately. So anything derived from the selection runs ahead of the data: a week label reading `Aug 24 – Aug 30` above a list of the previous week's classes, or a count describing a set that is not on screen yet. The section no longer contradicts itself only because it went blank — it contradicts itself while fully rendered, which is worse.

**Derive descriptive values from the committed data, never from the pending selection.** Hold the data and the parameters it was fetched with in one state value, written once when the fetch settles *successfully* — then the label, the count and the rows always describe the same fetch, and a failed refetch leaves the label describing the data still on screen rather than the request that failed. Only the control's own state, which button looks active, belongs on the immediate selection.

### Read the clock once, next to the fetch

**Applies to every async provider, refetching or not.** Any value derived from the current time — a countdown, "renews in N days", "starts in an hour", this week's range — must be computed where the data is fetched and carried alongside it, never recomputed from `new Date()` in a render body or in a helper the render body calls.

The server and the browser read their clocks at different moments. Most of the time the derived value is identical and nothing shows. But when the two readings fall either side of a boundary — a `Math.ceil` over days, a week start, midnight — the server HTML and the first client render disagree, and React does not quietly patch the text: it abandons the whole Suspense boundary and re-renders it on the client. Verified against React 18.3.1 with clocks two minutes apart: `Text content did not match`, then `There was an error while hydrating this Suspense boundary. Switched to client rendering.` The server render this pattern exists to preserve is thrown away, intermittently, on a timer nobody can reproduce on demand.

So resolve the time to a concrete value at fetch time and treat it as part of the data:

```typescript
const fetchPlan = async (): Promise<PlanView | null> => {
  const order = await getActiveOrder();          // may be null — no plan, or a failed call
  if (!order) { return null; }
  const renewsAt = order.currentCycle.endedDate;
  return { renewsAt, daysLeft: daysBetween(new Date(), renewsAt) };  // clock read once, here
};
```

`daysLeft` is now a field on the resolved data, so every render of it — server, hydration, and any later re-render — produces the same number. A page that must keep counting down past load needs a value that changes over time — state written from an interval; that is a different feature from rendering a correct number on arrival, and most requests only ask for the latter.
