# Animated Components

Content that **auto-advances or plays** must ship an on-stage **play/pause button**.

## Apply When

Apply whenever the component has `autoPlay` or startable/loopable primary content:

- Slideshow, carousel, slider, or gallery that advances slides/cards
- Lottie / JSON vector animations
- Animated GIFs or animated SVGs
- Canvas / WebGL animation loops (also follow `CANVAS-COMPONENTS.md`)
- Any video-like playing surface

**Key rule:** an `autoPlay` prop requires a play/pause button, even when it only
advances an index on a `setInterval`.

## Required Contract

1. **Props** — `autoPlay` when it can start automatically (carousels, sliders,
   slideshows and galleries **must** define it, default `true`), `loop` only when
   repeat is supported, and `pauseButtonVisibility` (default `'showOnHover'`).
   When editing, keep existing playback prop names and add only what is missing.
2. **Playback state** — play/pause toggle state, derived `isPlaying`, and
   `handlePause` / `handleResume`
3. **Play/pause button** — icon-only `<button>` over the playing content, apart
   from other controls; SVG using `--icon-size`/`--icon-color`; it must be a
   named part with `elementProps` wiring, a hover design state, and a
   standalone `:focus-visible` keyboard indicator
4. **Remove the button's size and justify controls** in the extension
5. **Modify `component.preview.tsx`** — suppress autoplay in editor design mode
6. **Respect `prefers-reduced-motion`** — start paused when the OS requests reduced motion

### Announce Manually Selected Parallel Content

For carousel-like components that swap readable parallel items, make the item
wrapper a live region:

- Use `aria-live={isPlaying ? 'off' : 'polite'}` and `aria-atomic="false"`.
- `isPlaying = isPlayOn && !isHovered && !isFocusWithin`. Reduced motion
  starts paused; editor mode, `autoPlay={false}`, and pause set it false.
- Root `onMouseEnter`/`onMouseLeave` and `onFocus`/`onBlur` (clear only when
  `relatedTarget` leaves the root) pause temporarily; prev/next/dot set
  `isPlayOn` to `false`.

## 1. Define Props

Playback controls are behavior props; `pauseButtonVisibility` is one by exception,
so the preview can force the safety control visible.

```typescript
import type { A11y, Direction } from '@wix/editor-react-types';

export interface MyAnimationProps {
  id: string;
  className?: string;
  direction?: Direction;
  a11y?: A11y;

  /** Start playing on load. */
  autoPlay?: boolean;

  /** Repeat when finished. */
  loop?: boolean;

  pauseButtonVisibility?: 'showAlways' | 'showOnHover';

  elementProps?: {
    myAnimationPlayButton?: { className?: string };
  };
}

export const defaultProps = {
  autoPlay: true,
  loop: true,
  pauseButtonVisibility: 'showOnHover',
} as const;
```

### Lottie / JSON source

For Lottie, `animationUrl?: string` is a JSON URL, not `VectorArt` (SVG).
This and its renderer are exceptions to the generic media/dependency rules in
`COMPONENT-CONTRACT.md`. Check `package.json`: use `lottie-web` if present,
otherwise add it as a runtime dependency. Import `lottie` and
`type AnimationItem` from it. In an effect, call
`lottie.loadAnimation({ container, renderer: 'svg', path: animationUrl,
loop, autoplay: false })`; keep the item in a ref, destroy it on cleanup,
and use `play()` / `pause()` when `isPlaying` changes. Preserve supplied or existing animations. For a new component needing
a generic default, copy
`<SKILL_ROOT>/scripts/default-animation.json` into the component
and import it with `?url` as `defaultProps.animationUrl`.

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

`reducedMotion` is runtime-only: pause when it turns on, never restart when it
turns off; Resume still overrides it.

Derive `isPlaying` from `isPlayOn` plus only needed conditions (otherwise
`const isPlaying = isPlayOn`). A carousel, slideshow, slider or gallery adds hover and focus:

```tsx
const isPlaying = isPlayOn && !isHovered && !isFocusWithin;
```

Pass `isPlaying` to the renderer. In CSS, put it in the `animation` shorthand,
never in `animationPlayState`. The button toggles `isPlayOn` with
`handlePause` / `handleResume`.

## 3. Add the Play/Pause Button

Use inline SVG icons: a triangle for play and two bars for pause. Follow SVG Icons in `CSS-GUIDELINES.md` for `--icon-size` and `--icon-color`.

Position it absolutely inside the playing content, not a controls row:

```css
.animationContainer {
  position: relative;
  block-size: 100%;
  inline-size: 100%;
}

.playButton {
  --icon-size: 12px;
  --icon-color: #ffffff; /* readable */
  padding: 6px;
  position: absolute;
  inset-inline-end: 5px;
  inset-block-start: 5px;
}

.playIcon {
  inline-size: var(--icon-size);
  block-size: var(--icon-size);
  fill: var(--icon-color);
}

/* Design-state selectors: pair native pseudo-class with editor-injected modifier class. */
.playButton:global(.my-animation-play-button--hover),
.playButton:hover {
  /* hover appearance */
}

/* Keyboard indicator only: focus is not an editor design state on a non-input
   control unless editable focus styling was explicitly requested. */
.playButton:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

Labels live outside JSX:

```ts
// constants.ts
export const ARIA_LABELS = {
  playButton: 'Play animation',
  pauseButton: 'Pause animation',
} as const;
```

Set the visibility attribute on the elected root, keeping its root contract:

```tsx
data-pause-button-visibility={pauseButtonVisibility}
```

Wire the named part completely:

```tsx
<button
  type="button"
  {...elementProps?.myAnimationPlayButton}
  className={clsx(
    'my-animation-play-button',
    styles.playButton,
    elementProps?.myAnimationPlayButton?.className,
  )}
  onClick={isPlayOn ? handlePause : handleResume}
  aria-label={
    isPlayOn ? ARIA_LABELS.pauseButton : ARIA_LABELS.playButton
  }
>
  {isPlayOn ? <PauseIcon className={styles.playIcon} /> : <PlayIcon className={styles.playIcon} />}
</button>
```

```css
/* Visibility only (CSS-GUIDELINES.md exception); editable styling stays on .playButton. */

/* showOnHover (default) */
.root[data-pause-button-visibility="showOnHover"] .playButton {
  opacity: 0;
  pointer-events: none;
}

.root[data-pause-button-visibility="showOnHover"]:hover .playButton,
.root[data-pause-button-visibility="showOnHover"]:focus-within .playButton {
  opacity: 1;
  pointer-events: auto;
}
```

## 4. Remove the Button's Size Controls

Generation gives every `<button>` part size, blend-mode, margin and (under flex
or grid) justify controls. Add this above `editorElementWithDefaults` in
`<component-name>.extension.ts`, keyed by its `elementProps` key:

```ts
const sizedByIcon = (parts: Record<string, ElementItem>): Record<string, ElementItem> => Object.fromEntries(Object.entries(parts).map(([key, part]) => {
  const inline = part.inlineElement;
  if (!inline) return [key, part];
  let { cssProperties: css, elements } = inline;
  if (key === 'myAnimationPlayButton' && css) {
    const { width, height, mixBlendMode, marginTop, marginBottom, marginInlineStart, marginInlineEnd,
      justifyContent, ...kept } = css;
    css = kept;
  }
  return [key, { ...part, inlineElement: { ...inline, cssProperties: css, elements: elements && sizedByIcon(elements) } }];
}));
const withPlayButtonSizedByIcon = <E extends EditorElement>(element: E): E =>
  element.elements ? { ...element, elements: sizedByIcon(element.elements) } : element;
```

Wrap the declaration: `withPlayButtonSizedByIcon(withEditorElementDefaults(editorElement, defaultProps))`,
importing `type EditorElement` and `type ElementItem` from `@wix/react-component-schema` if missing.
Then check `*.generated.ts` has that key at any depth under `elements`; a typo trims nothing.

## 5. Suppress Autoplay in `component.preview.tsx`

Read the scaffolded `component.preview.tsx`; never rewrite it. Add `useIsEditMode`
to its `@wix/react-component-utils` import and change only the body of
`ComponentNamePreview`. Leave `withFallbackPlaceholder` and the `withDefaults`
export as they are; `withDefaults` stays outside `withFallbackPlaceholder`.

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

## Checklist

- [ ] Autoplay and pause-control props use the documented contract; `loop` is
      present only when repeat behavior is supported.
- [ ] Reduced motion starts paused and never restarts playback automatically.
- [ ] Hover and focus pause rotation; manual navigation stops it.
- [ ] The play/pause button is a fully wired, icon-only named part with a stable accessible name.
- [ ] Hover has a paired editor design state; `:focus-visible` remains a
      standalone keyboard indicator.
- [ ] Section 4 removes the button's size and justify controls.
- [ ] Hover-only visibility changes behavior, not the button's editable styling surface.
- [ ] The preview exports the adapter with synchronized fallback metadata and
      disables autoplay in design mode.
