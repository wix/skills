# Dashboard Page Boundary — the entry file's pending and failed renders

**A dashboard page extension is its own iframe, and nothing above it renders a fallback.** When the page's first render produces nothing — because it is still waiting on the host, or because something threw — the user sees a blank white page, not an error. [CAIRO-4759](https://wix.atlassian.net/browse/CAIRO-4759) was reported exactly that way: an Aria link opening a blank dashboard page that a manual refresh fixed, with users assuming the generated page was broken.

Two separate causes produce the same blank page, so the entry file handles both.

## 1. The pending render is a loader, never `null`

A routed template's entry file waits on `dashboard.observeState` for `location` and must not render the page before it arrives — `PatternsReactRouter` throws on a `location` that is still `undefined`. That guard is correct; what matters is its other branch.

`null` renders nothing, which is indistinguishable from a page that crashed. The host delivers `location` asynchronously, and when that delivery never completes the `null` branch is what the user is left with — permanently. Render a loader instead, so a stalled handshake reads as "still loading".

## 2. A render-time throw needs a boundary

The entry file is the last place that can catch a throw. Without a boundary, anything that throws while the page mounts unmounts the tree and leaves the iframe blank with the error only in the console. Write this once per app, beside `BusinessManagerTheme.tsx`:

```tsx
// src/DashboardPageBoundary.tsx — one per app
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState } from '@wix/design-system';

interface DashboardPageBoundaryState {
  hasError: boolean;
}

export class DashboardPageBoundary extends Component<
  { children: ReactNode },
  DashboardPageBoundaryState
> {
  state: DashboardPageBoundaryState = { hasError: false };

  static getDerivedStateFromError(): DashboardPageBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Dashboard page failed to render', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <EmptyState
        title="This page didn't load"
        subtitle="Reloading usually fixes it."
      >
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </EmptyState>
    );
  }
}
```

A boundary has to be a class — `getDerivedStateFromError` has no hook equivalent.

## 3. Wiring both into the entry file

The boundary goes **inside** `BusinessManagerTheme`, so its fallback is themed too, and **outside** the template's app component, so it also catches a throw from the provider stack and the router — not only from the pages below them:

```tsx
<BusinessManagerTheme>
  <DashboardPageBoundary>
    {location ? (
      <ItemsApp location={location} />
    ) : (
      <Box align="center" verticalAlign="middle">
        <Loader />
      </Box>
    )}
  </DashboardPageBoundary>
</BusinessManagerTheme>
```

`Box` and `Loader` come from `@wix/design-system`; rename `ItemsApp` to the template's app component. A page with no router (the settings template) needs no `location` guard, but still takes the boundary.

**None of this is caught before runtime.** `tsc`, `wix build` and `wix preview` all pass on an entry file with a bare `null` branch and no boundary — the page only goes blank when the host is slow or something throws, which is why the symptom was reported as intermittent.
