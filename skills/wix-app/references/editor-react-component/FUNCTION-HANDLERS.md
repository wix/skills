# Function Event Handlers

Rules and patterns for adding function event handler props to an Editor React component's TypeScript interface, wiring them to DOM events, and declaring custom callbacks.

---

## Rules

### Standard SDK Event Handlers

These are the standard event handler props the editor SDK exposes to site owners. Use the exact prop names — ZeroConfig and the manifest system recognize them.

| Prop name    | React DOM event | Type                                  |
| ------------ | --------------- | ------------------------------------- |
| `onClick`    | `onClick`       | `(event: React.MouseEvent) => void`   |
| `onDblClick` | `onDoubleClick` | `(event: React.MouseEvent) => void`   |
| `onChange`   | `onChange`      | `(event: React.ChangeEvent<HTMLElement>) => void` |
| `onFocus`    | `onFocus`       | `(event: React.FocusEvent) => void`   |
| `onBlur`     | `onBlur`        | `(event: React.FocusEvent) => void`   |
| `onMouseIn`  | `onMouseEnter`  | `(event: React.MouseEvent) => void`   |
| `onMouseOut` | `onMouseLeave`  | `(event: React.MouseEvent) => void`   |

Three props have a **name mismatch** between the SDK prop and the DOM event: `onDblClick` → `onDoubleClick`, `onMouseIn` → `onMouseEnter`, `onMouseOut` → `onMouseLeave`.

### Declaring Standard Handler Props

Declare standard handlers inline with the exact SDK prop names and React event types:

```typescript
interface MyComponentProps {
  label?: string;
  onClick?: (event: React.MouseEvent) => void;
  onDblClick?: (event: React.MouseEvent) => void;
  onChange?: (event: React.ChangeEvent<HTMLElement>) => void;
  onFocus?: (event: React.FocusEvent) => void;
  onBlur?: (event: React.FocusEvent) => void;
  onMouseIn?: (event: React.MouseEvent) => void;
  onMouseOut?: (event: React.MouseEvent) => void;
}
```

Only declare handlers the component actually exposes. Do not add all seven if the component only handles two.

### Wiring Standard Handlers to DOM Events

Destructure the props and pass them to the correct DOM event — applying the name mappings:

```typescript
export const MyComponent = (props: MyComponentProps) => {
  const { onClick, onDblClick, onFocus, onBlur, onMouseIn, onMouseOut } = props;
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDblClick}
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseEnter={onMouseIn}
      onMouseLeave={onMouseOut}
    >
      {/* ... */}
    </div>
  );
};
```

### Custom Callbacks

Component-specific callbacks that do not correspond to a DOM event (e.g., `onPlay`, `onPause`, `onEnded`, `onTimeupdate`) are **not** standard SDK event handlers. Type them as `() => void` — no React event parameter:

```typescript
interface VideoPlayerProps {
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
}
```

Pass them directly to the underlying element — no name remapping needed:

```typescript
export const VideoPlayer = (props: VideoPlayerProps) => {
  const { onPlay, onPause, onEnded } = props;
  return (
    <video onPlay={onPlay} onPause={onPause} onEnded={onEnded} />
  );
};
```

---

## Common Mistakes

### Passing SDK prop name directly to DOM instead of remapping

**❌ Wrong:**

```typescript
export const MyComponent = (props: MyComponentProps) => {
  const { onMouseIn, onMouseOut, onDblClick } = props;
  return (
    <div
      onMouseIn={onMouseIn}       // ❌ not a valid React DOM prop
      onMouseOut={onMouseOut}     // ❌ not a valid React DOM prop
      onDblClick={onDblClick}     // ❌ not a valid React DOM prop
    />
  );
};
```

**✅ Correct:**

```typescript
export const MyComponent = (props: MyComponentProps) => {
  const { onMouseIn, onMouseOut, onDblClick } = props;
  return (
    <div
      onMouseEnter={onMouseIn}    // ✅ onMouseIn → onMouseEnter
      onMouseLeave={onMouseOut}   // ✅ onMouseOut → onMouseLeave
      onDoubleClick={onDblClick}  // ✅ onDblClick → onDoubleClick
    />
  );
};
```

### Adding a React event parameter to custom callbacks

**❌ Wrong:**

```typescript
interface VideoPlayerProps {
  onPlay?: (event: React.SyntheticEvent) => void;  // ❌ event param on custom callback
  onEnded?: (event: React.SyntheticEvent) => void; // ❌ event param on custom callback
}
```

**✅ Correct:**

```typescript
interface VideoPlayerProps {
  onPlay?: () => void;   // ✅ no event param
  onEnded?: () => void;  // ✅ no event param
}
```

**Why:** Custom callbacks are component-level notifications to the site owner, not DOM event forwarders. They carry no event object — the SDK passes no event to them.

### Using the DOM event name as the SDK prop name

**❌ Wrong:**

```typescript
interface MyComponentProps {
  onDoubleClick?: (event: React.MouseEvent) => void; // ❌ DOM name, not SDK name
  onMouseEnter?: (event: React.MouseEvent) => void;  // ❌ DOM name, not SDK name
  onMouseLeave?: (event: React.MouseEvent) => void;  // ❌ DOM name, not SDK name
}
```

**✅ Correct:**

```typescript
interface MyComponentProps {
  onDblClick?: (event: React.MouseEvent) => void;  // ✅ SDK prop name
  onMouseIn?: (event: React.MouseEvent) => void;   // ✅ SDK prop name
  onMouseOut?: (event: React.MouseEvent) => void;  // ✅ SDK prop name
}
```

**Why:** The SDK prop names (`onDblClick`, `onMouseIn`, `onMouseOut`) are what ZeroConfig and the manifest system register. Using DOM names breaks the editor's event wiring.
