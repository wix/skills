# Canvas Components

Use this reference when a component draws on a `<canvas>` with Canvas 2D,
WebGL, three.js, p5 or another renderer. `ANIMATED-COMPONENTS.md` covers
playback controls; this reference connects drawing to the component's size,
settings and editor styling.

## Lifecycle and Settings

Create browser resources in effects, following `SSR.md`, and release the
resources, listeners and scheduled work in cleanup. Keep long-lived renderers
and scenes available across ordinary setting edits.

Separate resource creation from updates. An effect can apply changed props to
an existing scene, update affected objects and request a redraw. Use refs to
give long-lived loops and callbacks access to current props and playback
state. Updating a ref supplies the latest value; the loop or update path still
needs to apply it to the drawing.

Choose effect dependencies for the work that effect owns. Settings that can
update in place belong in an update path; a construction-only option may
require recreating the affected resource. Changes from root props must reach
the drawing in both the editor and the live site.

## Size

- Observe the component container with `ResizeObserver` so drawing follows
  editor resizing as well as browser layout changes.
- Initialize cameras and backing stores with valid dimensions. When a hidden
  component measures zero, retain the last valid size or wait for a positive
  measurement before resizing.
- Match the backing store to the rendered size and an appropriate device
  pixel ratio. Let the canvas fill its container through CSS, including when
  a library appends it to a wrapper.

## Playback and Redrawing

Use the playback state from `ANIMATED-COMPONENTS.md` to pause ongoing motion.
The library's playback API, a guarded animation step or a pause-aware clock
can provide this behavior. Keep elapsed time consistent across pause and
resume.

Make the paused editor view useful for editing: show visible content and an
appropriate stable state, such as the end of an intro. Continue applying
settings, style and size changes while paused, and redraw after those changes.
The live component can run the requested entrances and interactions when
playing.

## Design-Panel Values

Choose props and editable CSS with `PROPS-VS-CSS.md`. Content and behavior
settings reach the renderer through props. For appearance drawn inside a
canvas, CSS custom properties let the renderer use values edited through the
design panel.

ZeroConfig reads `@property` syntax for typed custom properties and can infer
types from their CSS usage. Declare defaults on the owning element:

```css
@property --mist-color { syntax: '<color>'; inherits: true; initial-value: #34868f; }
@property --mist-density { syntax: '<number>'; inherits: true; initial-value: 50; }

.root {
  --mist-color: #34868f;
  --mist-density: 50;
}
```

For a font variable, a use such as `font-family: var(--label-font)` supplies
the font control's type; `syntax: '*'` alone supplies no type. Numeric React
settings props use the JSDoc range annotations in `COMPONENT-CONTRACT.md`.

Read current computed CSS values when applying styles to the drawing. CSS can
change independently of React props, for example through a theme or design
panel edit, so include those changes in the redraw path. A loop can keep
checking current values while motion is paused. If caching is useful, choose
an invalidation mechanism that covers the style changes the component uses.

Apply resolved colors in a format the rendering library accepts, and load
fonts before drawing text with them. Update affected materials or drawing
parameters in place; rebuild geometry when its shape needs to change.

## Library Integration

- **three.js:** update the camera projection for the new dimensions when
  resizing; perspective cameras use an aspect ratio.
  `renderer.setSize(width, height, false)` leaves CSS sizing to the component.
  A canvas painter can supply a `CanvasTexture`.
- **p5:** load it in the browser and use instance mode with the component's
  container. Coordinate its resize and image-loading callbacks with drawing.
- **Canvas 2D:** scale the backing store for pixel density and map pointer
  coordinates from CSS pixels into drawing coordinates.
- **WebGL:** keep context ownership and resource cleanup with the renderer.

## Review

- Settings changes update the drawing, including while paused in the editor.
- Container resizing and hidden-to-visible changes keep valid dimensions.
- Design-panel values reach the materials or drawing operations that use them.
- Playback pauses motion while allowing editing and redrawing.
- Cleanup releases the resources created by the component.
