# Function Handlers

When creating a component or changing interactions, expose common optional
callbacks by capability, without requiring an explicit request.

## Default Support

Apply defaults to the public interaction surface:

| Component capability | Default optional props |
| --- | --- |
| Pointer/click interaction, including native controls | `onClick`, `onMouseIn`, `onMouseOut` |
| Focusable control | `onFocus`, `onBlur` |
| Editable value, text, or selection | `onChange` |

Combine matching rows; leave decorative elements alone. Explicit API restrictions
override defaults. Specialized callbacks (`onDblClick`, `onPlay`, `onEnded`,
`onActivate`, etc.) require a request.

Classify composite controls by their interactive descendants. For example, a
radio-based rating input matches all three rows and exposes all six callbacks.

## Standard SDK Handlers

Use the exact SDK prop name and wire it to the matching React DOM event.

| SDK prop | React DOM prop | Type | Zero config `domEvent` |
| --- | --- | --- | --- |
| `onClick` | `onClick` | `(event: React.MouseEvent) => void` | `POINTER` |
| `onDblClick` | `onDoubleClick` | `(event: React.MouseEvent) => void` | `POINTER` |
| `onChange` | `onChange` | `(event: React.ChangeEvent<HTMLElement>) => void` | `CHANGE` |
| `onFocus` | `onFocus` | `(event: React.FocusEvent) => void` | `FOCUS` |
| `onBlur` | `onBlur` | `(event: React.FocusEvent) => void` | `FOCUS` |
| `onMouseIn` | `onMouseEnter` | `(event: React.MouseEvent) => void` | `POINTER` |
| `onMouseOut` | `onMouseLeave` | `(event: React.MouseEvent) => void` | `POINTER` |

React `onChange` fires on live text edits and selection changes. Pass that
`ChangeEvent` directly. Do not synthesize a commit callback from blur or cast a
`FocusEvent` to `ChangeEvent`.

Callbacks only notify; they never enable controlled mode. Internal handlers run
component logic, then call the optional callback once, preserving event payloads
and disabled/read-only guards. Behavior must work without callbacks or consumer
prop updates. Forward directly when no internal logic is needed. Add controlled
state only when requested; preserve existing controlled APIs when editing.

```tsx
import * as React from 'react';

export type ActionProps = {
  onClick?: (event: React.MouseEvent) => void;
  onMouseIn?: (event: React.MouseEvent) => void;
  onMouseOut?: (event: React.MouseEvent) => void;
  onFocus?: (event: React.FocusEvent) => void;
  onBlur?: (event: React.FocusEvent) => void;
};

export const Action: React.FC<ActionProps> = (props) => {
  const { onClick, onMouseIn, onMouseOut, onFocus, onBlur } = props;
  const [count, setCount] = React.useState(0);

  const handleClick = (event: React.MouseEvent) => {
    setCount((value) => value + 1);
    onClick?.(event);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={onMouseIn}
      onMouseLeave={onMouseOut}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      Clicked {count} times
    </button>
  );
};
```

Zero config requires SDK names, not `onDoubleClick`, `onMouseEnter`, or
`onMouseLeave`, in public props.

## Custom Callbacks

Custom notifications use `() => void`; zero config emits no event parameter for
unrecognized callback names. Custom callbacks must not declare React event
parameters. Use a standard SDK handler above when the event is public:

```tsx
export type VideoPlayerProps = {
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
};

export const VideoPlayer: React.FC<VideoPlayerProps> = (props) => {
  const { onPlay, onPause, onEnded } = props;
  return (
    <video
      controls
      onPlay={() => onPlay?.()}
      onPause={() => onPause?.()}
      onEnded={() => onEnded?.()}
    />
  );
};
```

## Checklist

- [ ] Defaults match capabilities; specialized callbacks are requested.
- [ ] SDK names, DOM mappings, and payloads match the contract.
- [ ] Internal behavior works independently and notifies callbacks once.
