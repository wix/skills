# Disabled and Invalid Wiring

Use after DESIGN-STATES.md §1 decides a part exposes `disabled` or `invalid`. A
native element's `:disabled` or `:invalid`, paired with the `:global` modifier in
the §3 rule, is what generates the state.

## Disabled

Author it when asked, or when the control stays visible but its action can be
unavailable (unmet precondition, request in progress, sold out). Otherwise author
no `disabled` binding and no `--disabled` rule.

## Invalid

Author it only for a native field with a constraint (`required`, `pattern`,
`type="email"`, …) or a `setCustomValidity` message. An unconstrained field is
never invalid.

For validity from outside the field (a server check, a password confirmation),
call `setCustomValidity` in the component file, on the field itself: through a
ref bound with `ref={confirmRef}`, a callback ref, or `event.currentTarget` in an
`on*` handler (inline, or a function of the component passed by name). The field may be in a component of the same file
that renders it. Not from a custom hook, a function outside the component, or
another file, and not through a ref given to a custom component. A field in a loop
or rendered conditionally is detected when every field with that `ref` or handler
prop calls it. If only some do, the ones that do may not be detected: give them a
constraint prop instead, otherwise leave `invalid` off them.

A `form` or `fieldset` is invalid when a field inside it is
(`.form:global(.signup-form--invalid), .form:invalid`), with no constraint of its
own; with no constrained field it is never invalid.
