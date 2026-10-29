# Function Handlers

Expose typed optional callbacks for the component's public behavior. Keep DOM
events used to implement that behavior internal unless they are part of the
requested public API. Preserve existing public APIs when editing; do not silently
rename callbacks or change their payloads.

## Value Changes: Native Input Contract

New input controls follow native TextInput and Dropdown:

- Expose `value` and `onValueChange?: (value: T) => void`, where `T` is the value's
  actual type. Text and single-select options emit strings, checkboxes emit
  booleans, and numeric inputs emit numbers. Emit the option's value, not its
  label, index, or option object.
- Expose only `onValueChange` by default for an input. Do not add `onChange`,
  click, hover, focus, or blur callbacks merely because an internal control has
  those events. Additional public callbacks require a request.
- Render the current value from props. A user edit proposes the next value;
  the parent/context accepts it by supplying the next prop. Callback presence
  never selects controlled mode. Without a callback or with a no-op callback,
  preserve the prop value; do not introduce a local value fallback.
- Convert DOM input events inside the component: read `event.currentTarget.value`,
  `checked`, or the parsed number, then notify once with the typed value. Never
  pass a React event, `{ target: { value } }`, or a cast event to a value setter.
- Text changes notify during editing, including `''` when cleared. A new value
  prop updates the display without emitting a callback. Preserve disabled and
  read-only guards and keyboard behavior. Do not emit from a prop-sync effect.
- Match empty-value behavior to the declared contract. Native Dropdown has no
  clear action and `value === undefined` means no selection; do not invent
  `onValueChange('')` for clearing it. For a requested clearable control, define
  its empty value explicitly. Do not invent `null` or use a numeric cast on text.

This allows direct binding to a context setter with the same value type.
Controlled inputs stay controlled even when the initial value is absent or empty.
Use `value ?? ''` for a text input; map an absent dropdown selection to its
underlying control's controlled empty value.

HTML select and checkbox controls have no effective `readOnly` attribute. Either
disable them while read-only, or keep them focusable with supported read-only
semantics and a guarded `onChange` while keeping `value`/`checked` controlled.
The native checkbox's implicit `checkbox` role supports `aria-readonly` per
[WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/#checkbox) and
[ARIA in HTML](https://www.w3.org/TR/html-aria/#el-input-checkbox). ARIA communicates
the state; it does not block edits. Verify support for the actual rendered role.
Do not cancel a controlled checkbox's click with `preventDefault()` to enforce
read-only: click cancellation can undo React's checked-state restoration and
leave the checkbox toggled. Native disabled controls must also receive `disabled`;
a callback guard alone is not disabled behavior.

```tsx
import type * as React from 'react';

export type TextInputProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
};

export const TextInput: React.FC<TextInputProps> = (props) => {
  const { value, onValueChange, disabled, readOnly } = props;
  return (
    <input
      value={value ?? ''}
      disabled={disabled}
      readOnly={readOnly}
      onChange={(event) => {
        if (!disabled && !readOnly) onValueChange?.(event.currentTarget.value);
      }}
    />
  );
};
```

The example shows value wiring only; keep the full root, parts, and accessibility
contract. For an explicitly requested autonomous widget, local state is valid:
update it before notifying `onValueChange`. For other stateful widgets (tabs,
carousels, toggles), preserve their state contract. Callback presence must never
disable internal behavior or choose a state mode.

Editable selections in composite widgets also default to `onValueChange` with
the selected semantic value (for example a plan name or value). Do not invent
`onSelectPlan` or another specialized public callback unless requested. Preserve
the widget's autonomous selection behavior when it owns that state; the callback
name and payload do not change its state model.

## Action and DOM Callbacks

For non-input action surfaces, include common optional SDK callbacks by
capability: `onClick`, `onMouseIn`, `onMouseOut` for pointer/click interaction;
`onFocus`, `onBlur` for focusable controls. Decorative elements get none.
For a composite containing inputs and a separate CTA, these callbacks belong to
the CTA; input value changes retain the value contract above. A form's submit
button is also an action surface: keep its default SDK callbacks alongside a
requested typed data callback. Requesting a payload does not by itself restrict
the callback list; only an explicit exclusive API restriction overrides these
defaults. Specialized callbacks require a request.

When exposing a DOM event, use the supported SDK name and matching React type:

| SDK prop | React DOM prop | Parameter | Manifest `domEvent` |
| --- | --- | --- | --- |
| `onClick` | `onClick` | `React.MouseEvent` | `POINTER` |
| `onDblClick` | `onDoubleClick` | `React.MouseEvent` | `POINTER` |
| `onChange` | `onChange` | `React.ChangeEvent<E>` | `CHANGE` |
| `onFocus` | `onFocus` | `React.FocusEvent` | `FOCUS` |
| `onBlur` | `onBlur` | `React.FocusEvent` | `FOCUS` |
| `onMouseIn` | `onMouseEnter` | `React.MouseEvent` | `POINTER` |
| `onMouseOut` | `onMouseLeave` | `React.MouseEvent` | `POINTER` |

For `onChange`, `E` is the actual control element: `HTMLInputElement`,
`HTMLSelectElement`, or `HTMLTextAreaElement`. Do not promise an input element
when the callback comes from a select or textarea.

Internal handlers preserve component behavior and disabled/read-only guards,
then notify once with the original event. Forward directly when no internal
logic is needed. Do not emit SDK-only names as DOM attributes or synthesize a
change event from blur. Explicitly requested DOM callbacks may coexist with a
value callback; they have different payloads.

## TypeScript Signature Is the Manifest Contract

ZeroConfig derives parameters and return values from the public TypeScript
signature, before legacy name/DOM-usage inference. Custom names can carry typed
data; they are not restricted to `() => void`. Use explicit supported types:

| Public signature | Generated function metadata |
| --- | --- |
| `(value: string) => void` | `parameters: [{ dataType: 'text' }]` |
| `(value: number) => void` | `parameters: [{ dataType: 'number' }]` |
| `(value: boolean) => void` | `parameters: [{ dataType: 'booleanValue' }]` |
| `(name: string, subscribed: boolean) => void` | `parameters: [{ dataType: 'text' }, { dataType: 'booleanValue' }]` |
| `() => void` | `function: {}` (no parameters) |
| `(event: React.MouseEvent) => void` | `parameters: [{ domEvent: 'POINTER' }]` |

Wix semantic types (for example `LocalDate` and `LocalTime` from
`@wix/editor-react-types`) retain their semantic data types. Inspect the installed
declaration before using an undocumented type. Supported signatures also include
optional parameters, string literal enums, arrays, objects, and Promise returns.
An optional callback prop is different from an optional argument: keep the
emitted value required unless absence is part of its explicit contract.

A user can request data types without naming callback props or writing TypeScript.
Choose clear names and derive explicit signatures from that request. When one
callback must expose several values, declare separate parameters in the requested
order and pass them together in one call, for example
`onSave?.(name, subscribed)`. Keep one manifest parameter per argument, including
when two arguments share a type. Do not drop arguments, split the notification
into separate calls, or replace positional arguments with an object unless
requested. ZeroConfig supports up to ten parameters; the native input default
`onValueChange(value)` is a single-value callback.

Avoid `any`, `unknown`, rest parameters, overloads, unsupported unions, and unions
of callback types. Do not rely on handler names to repair an uninformative
signature. A no-argument callback emits no arguments even if named `onClick`.
Inspect the generated manifest's exact callback entry after generation: confirm
its parameter count, data type or DOM-event type, and return type when present.
Never edit `*.generated.ts` or override function metadata to hide a wrong type.

## Checklist

- [ ] Inputs emit typed values and render the parent/context value.
- [ ] Input public callbacks stay minimal; action/DOM callbacks match their scope.
- [ ] Behavior, guards, and callback arguments agree with the declared signature.
- [ ] Generated callback metadata matches the public API.
