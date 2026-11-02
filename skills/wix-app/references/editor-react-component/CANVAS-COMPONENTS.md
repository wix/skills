# Canvas Components

Use this reference for a component whose visuals are drawn by code on a
`<canvas>` — Canvas 2D, WebGL, three.js, p5, or a physics or animation engine —
whether you write it or port it. `ANIMATED-COMPONENTS.md` owns the play/pause
button and its state; this file owns how the drawing pauses and the design-panel
values the code reads.

## Setup

- Create the renderer, scene, objects and helpers once, in one `useEffect`
  that runs once. Browser work stays inside it (`SSR.md`); release
  geometries, materials, textures, render targets and the renderer in its
  cleanup.
- Props reach the loop through a ref, never as effect dependencies: a
  dependency rebuilds the renderer on every panel keystroke.

  ```tsx
  const propsRef = useRef({ ...defaultProps, ...props });
  propsRef.current = { ...defaultProps, ...props };
  const isPlayingRef = useRef(true);
  isPlayingRef.current = isPlaying; // right below the derived isPlaying
  ```
- An engine with an update method (`setOptions`) is created once and updated
  through it. If its cleanup releases the WebGL context, the next engine gets
  a new `<canvas>`.

## Size

- Resize from a `ResizeObserver` on the root, never `window` `resize`: the
  editor changes the box without a window resize.
- A hidden component (`display: none` at a breakpoint) measures 0. Skip the
  resize and keep the last good size; a three.js camera built from 0/0 bakes
  a broken projection no later resize repairs, so seed setup with the design
  size when the first measurement is 0.
- Size the backing store from the rendered size times `devicePixelRatio`
  (capped at 2), inside the resize handler so moving to another display
  re-applies it. The `<canvas>` element itself fills the root with CSS
  (`display: block; width: 100%; height: 100%`); a canvas the library
  appends into a wrapper gets it through the wrapper (`.stage > canvas`), or
  it shows at its backing-store size and draws off-center.

## Playback

- Keep the source's loop, clock and timing as they are. Port them; don't
  restructure them into another pattern.
- Pause stops ongoing motion only: auto-rotation, drifting, particles,
  autoplay, and the source's video, sound or gsap/Tone timeline (their own
  `pause()`/`play()`, `suspend()`/`resume()`). Use whatever the source makes
  simplest: skip its motion step, stop its loop, or hold the time it reads.
  To hold an elapsed-time clock, take the paused time out of what it reads
  and keep the source's lines: `t = clock.getElapsedTime() - pausedFor`,
  adding each paused frame's time to `pausedFor`; `rotation.y = t * 0.05`
  stays `=`, never `+=`.
- **Paused shows the finished state**, and the editor is always paused. An
  intro counts as done (everything visible, at its final position), and
  values that ease toward a target (colors, size, an open or exploded state)
  jump to it, so panel edits and state changes show at once. Redraw when the
  size or a prop changes, even while paused: a resize clears the canvas.
- Playing (the live site with autoplay on) runs the intro as the source
  does, its text reveals included; only paused shows it finished. Never
  drop it, e.g. with framer-motion `initial={false}`; use
  `initial={playing ? <source's initial> : false}`.
- A never-played `<video>` paints black in Chrome: on `loadedmetadata`, set
  `currentTime = 0` to show its first frame.

## Design-Panel Values

Colors, fonts and visual numbers the code draws with are CSS custom
properties on the root, so the owner edits them in the design panel. A value
about looks (a color, a font, the size, density or opacity of what is drawn) is
a variable. How the drawing behaves or responds (the pointer's strength and
reach, the speed of motion) is a setting: a prop with `@min`/`@max` the loop
reads through the props ref. Content and a named set of choices are props too
(`PROPS-VS-CSS.md`). A value is a setting or a variable, never both, or one
field does nothing. A named set is an exported, named union type, which the
settings panel shows as a dropdown.

**Register each one** in the module CSS with its type and default, and
declare it on the root. `@property` gives the panel its control type.

```css
@property --mist-color { syntax: '<color>'; inherits: true; initial-value: #34868f; }
@property --mist-density { syntax: '<number>'; inherits: true; initial-value: 50; }
@property --label-font { syntax: '*'; inherits: true; initial-value: Archivo; }

.root {
  --mist-color: #34868f;
  --mist-density: 50;
  --label-font: Archivo;
  font-family: var(--label-font); /* type anchor: earns the font picker */
  transition-property: --mist-color, --mist-density, --label-font;
  transition-duration: 1ms;
  transition-behavior: allow-discrete;
}
```

- A font needs the `font-family: var(…)` anchor: a `syntax: '*'` registration
  carries no type, and without the anchor the panel shows no font picker.
- A palette or gradient is one variable per color; keep stop offsets in code.
- A number's range goes in `<component-name>.extension.ts`, inside the
  `editorElement` override, as strings (`multiplier` is the step). In a
  `{ ...editorElementWithDefaults, … }` override, spread the generated entry
  first, or the token ships with no type and the manifest is rejected
  (`UNKNOWN_CssPropertyType`):

  ```ts
  cssCustomProperties: {
    ...editorElementWithDefaults.cssCustomProperties,
    'mist-density': {
      ...editorElementWithDefaults.cssCustomProperties?.['mist-density'],
      number: { min: '0', max: '100', multiplier: '1' },
    },
  },
  ```
  The generated entries exist only once the manifest is generated, so add
  this after the first validate passes; if `tsc` says
  `cssCustomProperties` does not exist, validate without it first, then add
  it back. Never drop the ranges.
  An older extension built on `merge(...)` keeps its shape; there, the bare
  `number` entry is enough (`EDITOR-EXTENSION-CONFIGURATION.md`).

**Hear edits.** A design-panel or theme edit changes the variable without any
event; the 1ms transition above is what turns it into one. Read the values
once into a frozen object, cache it per root, and drop the cache on
`transitionend` and on resize:

```ts
const cache = new WeakMap<HTMLElement, Readonly<Tokens>>();
const readTokens = (root: HTMLElement) => {
  let tokens = cache.get(root);
  if (!tokens) {
    const style = getComputedStyle(root);
    const num = (name: string, fallback: number) => {
      const value = parseFloat(style.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    tokens = Object.freeze({
      mistColor: style.getPropertyValue('--mist-color').trim() || '#34868f',
      mistDensity: num('--mist-density', 50),
    });
    cache.set(root, tokens);
  }
  return tokens;
};
const onTransitionEnd = (event: TransitionEvent) => {
  if (event.target === root && event.propertyName.startsWith('--')) cache.delete(root);
};
root.addEventListener('transitionend', onTransitionEnd);
```

Call `readTokens(root)` each frame; never `getComputedStyle` per frame.

**Use them.**

- A color reads back as `rgb(...)`, not the hex you wrote. Pass it to the
  canvas or `new THREE.Color()` as is; never to a hex-only parser, which
  draws black.
- A font family may read back quoted; strip the quotes before passing it to
  a canvas font API, and `await document.fonts.load(…)` before the first
  draw, or the canvas falls back to a system font.
- Never bake a value into an object at creation (a particle's color). Store
  an index or ratio and resolve it when drawing; rebuild geometry only when
  the value that shapes it changes, with one guard per value, declared inside
  the effect. Derive into locals; never write into the frozen object.

## Per Library

- **three.js:** in the resize handler, `renderer.setPixelRatio(...)`,
  `renderer.setSize(width, height, false)` (`false` leaves the canvas's CSS
  size to the Size rule above) and the camera's aspect plus
  `updateProjectionMatrix()`. Never texture from `transferToImageBitmap()`
  (it renders upside down); pass the canvas to `CanvasTexture`.
- **p5:** import it dynamically inside the effect (it touches `window` when
  loaded) and run it in instance mode, `new p5(sketch, container)`: every
  global becomes a `p.` member. Size from the container, not the window.
  `p.loadImage(url, image => …)` with a callback, never the returned
  Promise. p5 writes inline pixel sizes, so force `.root > canvas` to
  `width: 100% !important; height: 100% !important`.
- **Canvas 2D:** scale the context to the backing store; map pointer input
  from CSS pixels into the drawing's coordinates.
- **WebGL:** claim the context once; never call `getContext('2d')` on the
  same canvas.

## Dependencies

Install libraries from npm, never a CDN `<script>`; a CDN import becomes the
bare npm import at the same version. Add a types package only from this
list: `three`, `p5`, `matter-js`, `d3`, `chroma-js`, `animejs`, `two.js`
(each `@types/<name>`). `gsap`, `pixi.js` and `paper` ship their own types
(their `@types` are deprecated stubs), and `tone`, `cannon-es`,
`simplex-noise` and `hydra-synth` have none; a guessed `@types` package
breaks `npm install`.

## Checklist

- [ ] One effect that runs once; props and play state through refs.
- [ ] Pause stops ongoing motion, video and sound; paused, the intro is done,
      eased values sit at their targets, and panel edits show at once;
      playing, the intro runs as in the source.
- [ ] `ResizeObserver` on the root; a zero size keeps the last good one; the
      `<canvas>` element itself is 100% of the root in CSS.
- [ ] Every value the owner edits in the design panel is registered with
      `@property`, declared on the root, in the transition list, and read
      through the cached reader; fonts have their anchor.
- [ ] Number ranges are in the extension's `cssCustomProperties`, added
      after the first validate.
- [ ] Cleanup releases what the effect created.
