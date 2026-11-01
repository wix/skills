# Plain Values and Derived Values

## Plain Values, Not RichText Twins

Expose every text and number context value **once**, with its plain type: `dataType: 'text'` (typed `Text`) or `dataType: 'number'` (typed `NumberType`). **Do not add a `richText` twin** — no `richTextCount`, no `toRichText()` helper — for a value that already exists as `text` or `number`.

The binding panel converts types for you. The platform's data-type conversion library supplies `text → richText`, `number → richText`, and `number → text`, so a plain `text` or `number` item already binds straight to the content of Wix's built-in text elements. A twin only duplicates the item in the binding panel and the manifest, leaving two candidates for the same binding.

```typescript
import type { NumberType, Text } from '@wix/editor-react-types';

export interface MyContextType {
  count: NumberType;
  statusMessage: Text;
  // ...functions, other values
}
const api = { count, statusMessage };
```

Register each value once in `context.items`:

```typescript
count: { dataType: 'number', displayName: 'Counter Value' },
statusMessage: { dataType: 'text', displayName: 'Status message' },
```

Use `dataType: 'richText'` only when the value itself carries formatting that plain text would lose — for example, fetched HTML content. Expose that `RichText` value on its own, not alongside a plain twin.

ContextItems do not accept a `richText` abilities config (the ContextItem schema has no such field) — abilities belong only on `data` items. When the provider accepts a `richText` value as a `data` configuration prop (not a context item), the `richText` config and `defaultValue` fields apply — see [RichText Type in CONTEXT_PROVIDER_SPEC.md](CONTEXT_PROVIDER_SPEC.md#richtext-type) for both.

## Derived Values (Mandatory)

Design every provider for binding-only consumers — an element wired via Editor Binding, or an automated markup generator that consumes the provider manifest. Every consumer bound in the Editor is one, and binding is the default for this app's consumers. A binding wires **one context item straight through to one element prop or event handler**; there is no expression layer between them. The platform converts types (see [Plain Values, Not RichText Twins](#plain-values-not-richtext-twins)) but nothing else, so the consumer cannot evaluate `count >= 10 && <Banner/>` itself:

| A binding cannot | So this must not be left to the consumer |
|---|---|
| compare | show the banner once `count` reaches 10 |
| negate | hide the hint while the banner is showing |
| combine | show only when logged in **and** the cart has items |
| branch | pick between two messages based on one flag |
| build strings | render `Count: 7` from `count` |

**Every condition in the request must already exist as its own context item, resolved to exactly the value the element consumes.** Leaving one unresolved does not fail loudly: with no way to negate, the consumer wires the element to a value it was given rather than the one it needed, so a banner meant to appear at `count >= 10` shows while the count is *below* 10. Rules:

1. **Match the target property's polarity.** Expose one `booleanValue` per gated property, set to `true` exactly when that property should apply. For EML visibility modes, use names such as `isCongratsBannerHidden` or `isEmptyCartMessageCollapsed` because `hidden`, `collapsed`, and `removed` apply when their binding is `true`.
2. **Only expose the opposite polarity when another binding needs it.** If two elements are gated on opposite sides of one condition, expose a ready-to-bind value for each target property. **When the condition comes from fetched data, the complement must also require that the data arrived.** A failed fetch collapses to the same empty value as a successful empty result, so `count === 0` on its own is true during an outage — and an item named for the reassuring side of the condition then shows reassurance over a broken page. See [The Loading Pair Is Mandatory](LOADING_REQUIREMENTS.md#the-loading-pair-is-mandatory).
3. **Raw state never stands in for a condition.** `count` is a display value; it is not `isCongratsBannerHidden`. Expose both — the first for the text element, the second for the gate.
4. **Pre-format state-dependent text.** Any string that varies with state ships fully assembled from the provider — `statusMessage`, not the pieces for a consumer to interpolate.
5. **Derive at render time from the state.** Compute derived values in the provider body from the state value itself. Never hold a second piece of state for a derived value — it drifts out of sync with its source.
6. **Any provider that awaits a promise exposes `isPlaceholderHidden` and `isContentHidden`.** Both as `booleanValue` items, whether or not the request mentions loading — and unlike rule 2's pairs these two are independent, not complements: during a refetch both are `false` (content stays visible and the loading visual shows). See [The Loading Pair Is Mandatory](LOADING_REQUIREMENTS.md#the-loading-pair-is-mandatory).

```typescript
const hasReachedGoal = count >= goal;

const api = {
  count,                                    // raw state — still exposed
  isCongratsBannerHidden: !hasReachedGoal,  // hidden until goal is reached
  isProgressHintHidden: hasReachedGoal,     // the complement — a binding cannot negate
  // ...display values and functions
};
```

Both booleans are ordinary `dataType: 'booleanValue'` entries in `context.items`. For the full provider and registration, see [Counter with a goal-gated banner](EXAMPLES.md#counter-with-a-goal-gated-banner).
