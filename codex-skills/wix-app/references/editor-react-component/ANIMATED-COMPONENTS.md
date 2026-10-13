# Animated Components

Use this reference when the component's primary content **auto-advances or plays**
— a slideshow/carousel/slider; a Lottie/JSON animation; an animated GIF/SVG, a canvas/WebGL loop, a video-like surface; or similar content a visitor should be able to start or stop.

Every such component must ship an on-stage **play/pause button**.

## Apply When

Apply whenever the component has `autoPlay` or startable/loopable primary content:

- Slideshow, carousel, slider, or gallery that advances slides/cards
- Lottie / JSON vector animations
- Animated GIFs or animated SVGs
- Canvas / WebGL animation loops
- Any video-like playing surface

**Key rule:** If the component accepts an `autoPlay` prop — even if the
underlying mechanism is a `setInterval` advancing an index rather than a media
player, it must expose a play/pause button so visitors can stop the
auto-advancing behavior. "Autoplay" is a behavior contract, not an
implementation detail.

## Required Contract

1. **Props** — for a new component, use `autoPlay` when it can start
   automatically, `loop` only when repeat behavior is supported, and
   `pauseButtonVisibility` for the on-stage control. When editing, preserve
   existing playback prop names and add only the missing safety contract.
   Carousels, sliders, slideshows, and galleries **must** define `autoPlay`
   (default `true`).
2. **Playback state** — play/pause toggle state, derived `isPlaying`, and
   `handlePause` / `handleResume`
3. **Play/pause button** — overlay `<button>` with inline SVG icon and CSS
   positioning; it must be a named part with `elementProps` wiring, a hover
   design state, and a standalone `:focus-visible` keyboard indicator
4. **Modify `component.preview.tsx`** — suppress autoplay in editor design mode
5. **Respect `prefers-reduced-motion`** — start paused when the OS requests reduced motion

### Announce Manually Selected Parallel Content

For carousel-like components that swap readable parallel items, make the item
wrapper a live region:

- Use `aria-live={isPlaying ? 'off' : 'polite'}` and `aria-atomic="false"`.
- `isPlaying = isPlayOn && !isHovered && !isStoppedByFocus`. Reduced motion
  starts paused; editor mode, `autoPlay={false}`, and pause set it false.
  Keyboard focus remains stopped until the rotation control restarts; hover
  pauses temporarily.
- Previous/next changes items. Use root `onMouseEnter`/`onMouseLeave`;
  leaving resumes unless focus has stopped rotation.

## 1. Define Props

Playback controls are behavior props. `pauseButtonVisibility` is the documented
exception to the usual visual-visibility rule because editor preview must be
able to force the safety control visible.

```typescript
import type { A11y, Direction } from '@wix/editor-react-types';

export interface MyAnimationProps {
  id: string;
  className?: string;
  direction?: Direction;
  a11y?: A11y;

  /** Start playing on load. Default `true`. */
  autoPlay?: boolean;

  /** Repeat when finished. Default `true`. */
  loop?: boolean;

  /** Show play/pause button. Default `'showOnHover'`. */
  pauseButtonVisibility?: 'showAlways' | 'showOnHover';

  elementProps?: {
    playButton?: { className?: string };
  };
}
```

Omit `loop` when repeat is unsupported.

### Lottie / JSON source

For Lottie, `animationUrl?: string` is a JSON URL, not `VectorArt` (SVG).
This and its renderer are exceptions to the generic media/dependency rules in
`COMPONENT-CONTRACT.md`. Check `package.json`: use `lottie-web` if present,
otherwise add it as a runtime dependency. Import `lottie` and
`type AnimationItem` from it. In an effect, call
`lottie.loadAnimation({ container, renderer: 'svg', path: animationUrl,
loop, autoplay: false })`; keep the item in a ref, destroy it on cleanup,
and use `play()` / `pause()` when `isPlaying` changes. Browser work belongs in
effects. If no URL is supplied, bundle a valid local Lottie JSON asset and
import it with `?url` as the component default; a placeholder URL renders blank.

## 2. Manage Playback State

Track play/pause button state with `useState`. Initialize it from `autoPlay`
and reduced motion; reduced motion starts paused, but a visitor can start it.

```tsx
import { useReducedMotion } from '@wix/react-component-utils';

const reducedMotion = useReducedMotion();

const [isPlayOn, setIsPlayOn] = React.useState(() => (autoPlay ?? true) && !reducedMotion);

const previousAutoPlay = React.useRef(autoPlay);
React.useEffect(() => {
  if (previousAutoPlay.current !== autoPlay) {
    setIsPlayOn((autoPlay ?? true) && !reducedMotion);
  } else if (reducedMotion) {
    setIsPlayOn(false);
  }
  previousAutoPlay.current = autoPlay;
}, [autoPlay, reducedMotion]);

const handlePause = () => setIsPlayOn(false);
const handleResume = () => setIsPlayOn(true);
```

`reducedMotion` is runtime-only. Pause when the OS turns reduced motion on, but
do not restart when it turns off. Resume can still override the preference.

Derive runtime playback from `isPlayOn` plus only needed conditions. Without
another condition, use `const isPlaying = isPlayOn`. A carousel, slideshow,
slider, or gallery also uses hover and focus-stop state:

```tsx
const isPlaying = isPlayOn && !isHovered && !isStoppedByFocus;
```

Pass `isPlaying` to the renderer. The button uses `isPlayOn` and toggles
between `handlePause` / `handleResume` on click. In a carousel-like component,
focus entering anything except that button sets `isPlayOn` to `false` and
`isStoppedByFocus` to `true`; `handleResume` sets `isPlayOn` to `true` and
clears `isStoppedByFocus`.

## 3. Add the Play/Pause Button

Use inline SVG icons: a triangle for play and two bars for pause. Declare
`--icon-size` and `--icon-color` on the button. Apply `var(--icon-size)` to the
SVG's CSS `width` and `height` (or React `style`), not raw SVG attributes;
set button `color: var(--icon-color)` and SVG `fill: currentColor`.

Position the button absolutely so it overlays the content without pushing other elements out of place:

```css
.animationContainer {
  position: relative;
  block-size: 100%;
  inline-size: 100%;
}

.playButton {
  --icon-size: 20px;
  --icon-color: #ffffff;
  position: absolute;
  inset-inline-end: 5px;
  inset-block-start: 5px;
}

/* Design-state selectors: pair native pseudo-class with editor-injected modifier class. */
.playButton:global(.my-animation-play-button--hover),
.playButton:hover {
  /* e.g. background: rgba(255, 255, 255, 1); */
}

/* Keyboard indicator only: focus is not an editor design state on a non-input
   control unless editable focus styling was explicitly requested. */
.playButton:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

Define stable system-owned labels outside JSX:

```ts
// constants.ts
export const ARIA_LABELS = {
  playButton: 'Play animation',
  pauseButton: 'Pause animation',
} as const;
```

Set the visibility data attribute on the existing elected root, preserving its
full root contract:

```tsx
data-pause-button-visibility={pauseButtonVisibility ?? 'showOnHover'}
```

Wire the named part completely:

```tsx
<button
  type="button"
  {...elementProps?.playButton}
  className={classNames(
    'my-animation-play-button',
    styles.playButton,
    elementProps?.playButton?.className,
  )}
  onClick={isPlayOn ? handlePause : handleResume}
  aria-label={
    isPlayOn ? ARIA_LABELS.pauseButton : ARIA_LABELS.playButton
  }
>
  {isPlayOn ? <PauseIcon /> : <PlayIcon />}
</button>
```

```css
/* Narrow behavior-only exception documented in CSS-GUIDELINES.md. Keep editable
   appearance on .playButton and use this relationship only for visibility. */

/* showOnHover (default) */
.root[data-pause-button-visibility="showOnHover"] .playButton {
  opacity: 0;
  pointer-events: none;
}

.root[data-pause-button-visibility="showOnHover"]:hover .playButton {
  opacity: 1;
  pointer-events: auto;
}

/* showAlways — no extra CSS needed; button is visible by default */
```

## 4. Suppress Autoplay in `component.preview.tsx`

The Wix CLI scaffold generates `component.preview.tsx`. Read the file first,
then edit only the body of the existing preview component. Do not overwrite
the file from scratch.

### Edit the generated `component.preview.tsx`

Add `useIsEditMode` to the existing `@wix/react-component-utils` import. Then
edit only the body of the existing `ComponentNamePreview` function — add the
`isEditMode` check and gate the autoplay props. Do not touch the
`withFallbackPlaceholder` call, the `withDefaults` export, or any other part
of the file. The composition must keep `withDefaults` outside
`withFallbackPlaceholder`, whether the calls are nested inline or assigned to
component variables.

```tsx
const ComponentNamePreview: FC<ComponentProps<typeof Component>> = (props) => {
  const isEditMode = useIsEditMode();
  return (
    <Component
      {...props}
      autoPlay={isEditMode ? false : props.autoPlay}
      pauseButtonVisibility={isEditMode ? 'showAlways' : props.pauseButtonVisibility}
    />
  );
};
```

Design mode stops autoplay and exposes the control; preview uses the user's values.

## Checklist

- [ ] Autoplaying or loopable primary content has an on-stage play/pause control.
- [ ] Autoplay and pause-control props use the documented contract; `loop` is
      present only when repeat behavior is supported.
- [ ] Reduced motion starts paused and never restarts playback automatically.
- [ ] The play/pause button is a fully wired named part with a stable accessible name.
- [ ] Both icons inherit button-owned `--icon-size` for width and height and
      `--icon-color` via `color` and `currentColor` for fill or stroke.
- [ ] Hover has a paired editor design state; `:focus-visible` remains a
      standalone keyboard indicator.
- [ ] Hover-only visibility changes behavior, not the button's editable styling surface.
- [ ] The preview exports the adapter with synchronized fallback metadata and
      disables autoplay in design mode.
