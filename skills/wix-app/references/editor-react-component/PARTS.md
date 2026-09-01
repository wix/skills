# Named Parts and Root Election

Use this reference to choose the component root and decide which inner elements
receive independent editor controls.

## Elect the Root First

The root is always the component's editor element. It carries the unprefixed
`'<component-name>'` global class and receives top-level `id`, `className`,
`direction`, and `a11y`. It never has an `elementProps` entry.

- If the component reduces to one meaningful control, link, media surface, or
  list, make that semantic element the root.
- Add a wrapper root only when it lays out multiple sibling parts, owns
  sizing/scrolling/clipping, or hosts a root-level prop-triggered state.
- Do not add a wrapper solely to hold root props or position decoration.
- If an inner part name stutters (`confetti-button-button`), the real semantic
  element probably should have been the root.

## Identify Named Inner Parts

A named inner part is an element whose styling or data/content a site owner
would plausibly control independently in the editor. It receives:

- one prefixed global class: `'<component-name>-<part-name>'`
- one CSS Module class
- one matching `elementProps` entry, spread onto the element

Apply this filter to every candidate:

- A state or variant (`selected`, `active`, `open`, `disabled`) is not a part.
  Implement it as a prefixed design-state modifier on the affected part.
- A hidden and shown version of the same element is one part, not two.
- A grouping or layout-only wrapper is not a part.
- A static child whose styling and data are fully owned by its parent is not a
  part. For example, an image whose source and appearance both belong to its
  carousel slide can remain module-class-only.
- An inner interactive element (`button`, `a`, `input`, and equivalent semantic
  controls) is a named part because it has an independent interaction and
  styling surface.
- Positional duplicates such as previous/next buttons are one part when they
  share the same semantic editor surface. Distinguish position with data or a
  module-only helper class, not separate part names.

## Sanity Check

For each candidate, ask:

> Would the controls for this element be a strict subset of its parent's controls?

If yes, remove the part. Then check the root in reverse: if it has one child part
and no independent surface, remove the wrapper and promote the child.

## Checklist

- [ ] The root is the component's best semantic element.
- [ ] The root has no `elementProps` entry or duplicate prefixed part class.
- [ ] Each inner part offers independent data or styling control.
- [ ] Every named inner part has global/module classes and `elementProps` wiring.
- [ ] States, wrappers, decorations, and positional variants are not extra parts.
