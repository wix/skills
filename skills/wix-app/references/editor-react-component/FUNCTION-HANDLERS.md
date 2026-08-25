# Function Handlers

Use this reference only when the component specification exposes callbacks to
site owners. Keep implementation-only handlers out of the public props type.

## Standard SDK Handlers

Use the exact SDK prop name and wire it to the matching React DOM event.

| SDK prop | React DOM prop | Type |
| --- | --- | --- |
| `onClick` | `onClick` | `(event: React.MouseEvent) => void` |
| `onDblClick` | `onDoubleClick` | `(event: React.MouseEvent) => void` |
| `onChange` | `onChange` | `(event: React.ChangeEvent<HTMLElement>) => void` |
| `onFocus` | `onFocus` | `(event: React.FocusEvent) => void` |
| `onBlur` | `onBlur` | `(event: React.FocusEvent) => void` |
| `onMouseIn` | `onMouseEnter` | `(event: React.MouseEvent) => void` |
| `onMouseOut` | `onMouseLeave` | `(event: React.MouseEvent) => void` |

Declare only the handlers the component actually exposes.

```tsx
export type ActionProps = {
  onClick?: (event: React.MouseEvent) => void;
  onDblClick?: (event: React.MouseEvent) => void;
  onMouseIn?: (event: React.MouseEvent) => void;
  onMouseOut?: (event: React.MouseEvent) => void;
};

export const Action: React.FC<ActionProps> = (props) => {
  const { onClick, onDblClick, onMouseIn, onMouseOut } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDblClick}
      onMouseEnter={onMouseIn}
      onMouseLeave={onMouseOut}
    />
  );
};
```

Do not expose DOM names such as `onDoubleClick`, `onMouseEnter`, or
`onMouseLeave` in the component API; zero config recognizes the SDK names.

## Custom Callbacks

A component-level notification that is not one of the standard SDK DOM events
uses `() => void` unless the component contract explicitly defines a serializable
payload. Do not expose a React synthetic event for custom callbacks.

Use this pattern:

```tsx
export type VideoPlayerProps = {
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
};

export const VideoPlayer: React.FC<VideoPlayerProps> = (props) => {
  const { onPlay, onPause, onEnded } = props;
  return <video onPlay={onPlay} onPause={onPause} onEnded={onEnded} />;
};
```

## Checklist

- [ ] The specification explicitly requires each public callback.
- [ ] Standard handler names match the SDK contract exactly.
- [ ] Mismatched SDK/DOM names are mapped at the rendered element.
- [ ] Custom callbacks do not leak React event objects.
- [ ] Internal handlers remain implementation details.
