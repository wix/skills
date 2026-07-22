# Animated Components (Play/Pause Control)

Rules and patterns for components whose primary content is a **playable
animation** — a Lottie/JSON animation, an animated GIF/SVG, a canvas/WebGL
loop, or a video-like surface.

Every such component MUST ship an on-stage **play/pause button**.

---

## When this applies

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
player — it MUST expose a play/pause button so visitors can stop the
auto-advancing behavior. "Autoplay" is a behavior contract, not an
implementation detail.

---

## What to add (checklist)

1. **Props** — `autoPlay`, `loop`, `pauseButtonVisibility`
2. **Playback state** — `isPlaying` + `handlePause` / `handleResume`
3. **Play/pause button** — overlay `<button>` with inline SVG icon + CSS positioning and optional hover-only visibility
4. **Modify `component.preview.tsx`** — suppress autoplay in editor design mode

---

## 1. Props

Playback controls are **behavior** props (see [`PROPS-VS-CSS.md`](PROPS-VS-CSS.md)):

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
}
```

---

## 2. Playback state

Track play/pause state with `useState`, initialized from the `autoPlay` prop:

```tsx
const [isPlaying, setIsPlaying] = React.useState(autoPlay ?? true);

const handlePause = () => setIsPlaying(false);
const handleResume = () => setIsPlaying(true);
```

Pass `isPlaying` to the animation renderer and toggle between `handlePause` / `handleResume` on button click.

---

## 3. Play/pause button

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
```

```css
/* pauseButtonVisibility variants — structural CSS, not named-part rules */

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

---

## 4. Modify `component.preview.tsx` for autoplay suppression

For animated components, modify the generated `component.preview.tsx` to suppress autoplay in editor design mode. See [`COMPONENT-PREVIEW.md`](COMPONENT-PREVIEW.md) for how the preview file works.

### Target state of `component.preview.tsx`

Replace the generated passthrough with the following. Replace `MyComponent` with the real component name.

```tsx
import React from 'react';
import MyComponent from './component';
import { useIsEditMode } from '@wix/react-component-utils';

export default function MyComponentPreview(
  props: React.ComponentProps<typeof MyComponent>,
) {
  const isEditMode = useIsEditMode();

  return (
    <MyComponent
      {...props}
      autoPlay={isEditMode ? false : props.autoPlay}
      pauseButtonVisibility={isEditMode ? 'showAlways' : props.pauseButtonVisibility}
    />
  );
}
```

In editor design mode (`isEditMode` is `true`) → `autoPlay` is forced to `false` and `pauseButtonVisibility` is forced to `'showAlways'` so the site owner can always see and interact with the button.  
In preview mode (`isEditMode` is `false`) → both use the user's configured values.

---
