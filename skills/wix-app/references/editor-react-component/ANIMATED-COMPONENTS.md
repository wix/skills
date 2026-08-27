# Animated Components

Use this reference when the component's primary content is a **playable
animation**—a Lottie/JSON animation, an animated GIF/SVG, a canvas/WebGL loop,
or a video-like surface.

Every such component must ship an on-stage **play/pause button**.

## Contents

- [Apply When](#apply-when)
- [Required Contract](#required-contract)
- [Define Props](#1-define-props)
- [Manage Playback State](#2-manage-playback-state)
- [Add the Play/Pause Button](#3-add-the-playpause-button)
- [Suppress Autoplay in `component.preview.tsx`](#4-suppress-autoplay-in-componentpreviewtsx)
- [Checklist](#checklist)

## Apply When

Apply automatically — without being asked — whenever the component has an
`autoPlay` prop **or** its primary content is a **startable / loopable**
animation a visitor would reasonably want to start or stop:

- Any component with an `autoPlay` prop (gallery, slider, carousel, etc.)
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
2. **Playback state** — `isPlaying` + `handlePause` / `handleResume`
3. **Play/pause button** — overlay `<button>` with inline SVG icon and CSS
   positioning; it must be a named part with `elementProps` wiring, a hover
   design state, and a standalone `:focus-visible` keyboard indicator
4. **Modify `component.preview.tsx`** — suppress autoplay in editor design mode
5. **Respect `prefers-reduced-motion`** — suppress autoplay when the OS requests reduced motion

## 1. Define Props

Playback controls are behavior props. `pauseButtonVisibility` is the documented
exception to the usual visual-visibility rule because editor preview must be
able to force the safety control visible.

```typescript
import type { A11y, Direction } from '@wix/editor-react-types';

export interface MyAnimationProps {
  id?: string;
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

The example shows a looping animation. Omit `loop` when the component does not
support repeat behavior; do not add it only to match the example.

## 2. Manage Playback State

Track play/pause state with `useState`. Initialize it from `autoPlay` and the OS reduced-motion preference — when the visitor has requested reduced motion, the animation starts paused:

```tsx
import { useReducedMotion } from '@wix/react-component-utils';

// inside the component:
const reducedMotion = useReducedMotion();

const [isPlaying, setIsPlaying] = React.useState((autoPlay ?? true) && !reducedMotion);

// when autoPlay prop changes, re-sync (but still respect reduced motion)
React.useEffect(() => {
  setIsPlaying((autoPlay ?? true) && !reducedMotion);
}, [autoPlay]);

// when reduced motion is enabled, suppress playback; never re-enable on its own
// (visitor may have manually paused — don't restart against their will)
React.useEffect(() => {
  if (reducedMotion) {
    setIsPlaying(false);
  }
}, [reducedMotion]);

const handlePause = () => setIsPlaying(false);
const handleResume = () => setIsPlaying(true);
```

**`reducedMotion`** is `true` when the hook reports that reduced motion is enabled. When active, the animation starts paused — the visitor can still press the play button to start it manually. It is a runtime browser signal, not a manifest/data prop; never expose it as a component prop or in the manifest.

Pass `isPlaying` to the animation renderer and toggle between `handlePause` / `handleResume` on button click.

## 3. Add the Play/Pause Button

Create play/pause icons that visually match the component's style. Use simple recognizable shapes — a triangle for play, two rectangles for pause — implemented as inline SVG so there is no external icon dependency. Size, stroke, and fill should feel native to the component's design.

Position the button absolutely so it overlays the content without pushing other elements out of place:

```css
.animationContainer {
  position: relative;
  block-size: 100%;
  inline-size: 100%;
}

.playButton {
  position: absolute;
  inset-inline-end: 5px;
  inset-block-start: 5px;
}

/* Design-state selectors: pair native pseudo-class with editor-injected modifier class.
   The editor applies the modifier class (e.g. my-animation-play-button--hover) when
   the site owner previews that state in the design panel, so both selectors must exist. */
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
  onClick={isPlaying ? handlePause : handleResume}
  aria-label={
    isPlaying ? ARIA_LABELS.pauseButton : ARIA_LABELS.playButton
  }
>
  {isPlaying ? <PauseIcon /> : <PlayIcon />}
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

The Wix CLI scaffold generates `component.preview.tsx`. For animated components,
modify its passthrough preview component without replacing the generated
defaults or fallback-placeholder wiring.

### Adapt the generated `component.preview.tsx`

Add `useIsEditMode` to the existing `@wix/react-component-utils` import. In the
generated preview component, replace only the passthrough return with the gated
props below. Keep the generated `withFallbackPlaceholder`, required-data fields,
root class, and `withDefaults` export unchanged.

```tsx
const MyAnimationPreview: FC<ComponentProps<typeof Component>> = (props) => {
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

In editor design mode (`isEditMode` is `true`) → `autoPlay` is forced to `false` and `pauseButtonVisibility` is forced to `'showAlways'` so the site owner can always see and interact with the button.
In preview mode (`isEditMode` is `false`) → both use the user's configured values.

## Checklist

- [ ] Autoplaying or loopable primary content has an on-stage play/pause control.
- [ ] Autoplay and pause-control props use the documented contract; `loop` is
      present only when repeat behavior is supported.
- [ ] Reduced motion starts paused and never restarts playback automatically.
- [ ] The play/pause button is a fully wired named part with a stable accessible name.
- [ ] Hover has a paired editor design state; `:focus-visible` remains a
      standalone keyboard indicator.
- [ ] Hover-only visibility changes behavior, not the button's editable styling surface.
- [ ] The preview preserves generated wrappers and forces autoplay off in design mode.
