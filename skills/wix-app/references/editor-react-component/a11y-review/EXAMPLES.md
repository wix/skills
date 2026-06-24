# Examples

## Native image -- missing alt

```tsx
// Before
<img src={photoUrl} />
```

Scanner result: `alt-text`, `high`, semantic type `img`

```tsx
// After
<img src={photoUrl} alt="Product photo" />
```

## Wrapper around image -- forwards props, missing alt at call site

```tsx
export const ProductPhoto = (props) => <img {...props} />;
```

```tsx
// Before (call site)
<ProductPhoto src={photoUrl} />
```

Scanner result: `alt-text`, `high` or `medium` depending on wrapper resolution

```tsx
// After (call site -- wrapper already forwards alt via spread)
<ProductPhoto src={photoUrl} alt="Blue running shoes" />
```

## Wrapper around image -- does NOT forward alt

```tsx
// Before (wrapper definition)
const Avatar = ({ src }: { src: string }) => <img src={src} />;
```

Scanner result: `alt-text`, `high` or `medium`

```tsx
// After (wrapper definition -- add alt prop and forward it)
const Avatar = ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />;

// Then at call site
<Avatar src="/me.jpg" alt="Profile photo" />
```

## Link-like component with invalid target

```tsx
// Before
<LinkButton href="#" />
```

Scanner result: `anchor-is-valid` if the component resolves or strongly infers to anchor semantics

```tsx
// After (if it navigates)
<LinkButton href="/destination" />

// After (if it triggers an action -- change to button)
<ActionButton onClick={handleAction} />
```

## Invalid ARIA prop

```tsx
// Before
<SomeComponent aria-labeledby="title" />
```

Scanner result: `aria-props`, usually `high`

```tsx
// After
<SomeComponent aria-labelledby="title" />
```

## Invalid role

```tsx
// Before
<Box role="container" />
```

Scanner result: `aria-role`, confidence depends on whether the component forwards DOM props

```tsx
// After (if grouping)
<Box role="group" />

// After (if no role needed)
<Box />
```

## ARIA on unsupported element

```tsx
// Before
<meta aria-label="description" />
```

Scanner result: `aria-unsupported-elements`, `high`

```tsx
// After
<meta />
```

## Anchor used as button

```tsx
// Before
<a onClick={handleSave}>Save</a>
```

Scanner result: `anchor-is-valid`, `high`

```tsx
// After
<button onClick={handleSave}>Save</button>
```

## Conditional onClick on non-interactive element -- missing keyboard semantics

The conditional spread pattern `{...(cond && { onClick })}` is common in this codebase and must be checked alongside direct `onClick` props. When the condition is true the element becomes interactive, so it needs full keyboard semantics even though it is non-interactive in other states.

**Before applying any fix, run the pre-fix checks in [FIX-STRATEGIES.md](FIX-STRATEGIES.md#pre-fix-checks-for-adding-button-semantics-to-a-non-interactive-element).**

### Simple case -- no interactive children, no existing tabIndex management

```tsx
// Before
<div
  {...(isClickable && { onClick: toggleReducedMotion })}
  className={styles.root}
>
  {children}
</div>
```

Tier 2 finding: `high` confidence — native `<div>` conditionally receives `onClick` but has no `role`, `tabIndex`, or keyboard handler.

```tsx
// After
const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleReducedMotion();
  }
};

<div
  {...(isClickable && {
    onClick: toggleReducedMotion,
    onKeyDown: handleKeyDown,
    role: 'button' as const,
    tabIndex: 0,
  })}
  className={styles.root}
>
  {children}
</div>
```

### Compound case -- element may contain a link

When the same wrapper conditionally renders a `<Link>` or `<a>` as a child, adding `role="button"` to the wrapper creates nested interactive elements — a WCAG violation that confuses keyboard navigation and screen readers.

```tsx
// Before (BROKEN -- wrapper is a button containing a link)
const isClickable = animated && !forceReducedMotion;

<div
  {...(isClickable && {
    onClick: toggleReducedMotion,
    role: 'button',
    tabIndex: 0,
  })}
>
  {link ? <Link {...link}><Tag>{children}</Tag></Link> : <Tag>{children}</Tag>}
</div>
```

```tsx
// After -- exclude the link case from button semantics
const isClickable = animated && forceReducedMotion === undefined && !link;

<div
  {...(isClickable && {
    onClick: toggleReducedMotion,
    onKeyDown: handleKeyDown,
    role: 'button' as const,
    tabIndex: 0,
  })}
>
  {link ? <Link {...link}><Tag>{children}</Tag></Link> : <Tag>{children}</Tag>}
</div>
```

Key differences from the simple case:
- `isClickable` explicitly excludes `link` to avoid nested interactives.
- `forceReducedMotion === undefined` replaces `!forceReducedMotion` for type safety when the variable is `true | undefined`.

### Existing tabIndex management on the same element

When another utility already sets `tabIndex` on the same element (e.g., `getTabIndexAttribute(a11y)`), ensure the button-semantics `tabIndex: 0` does not silently override or conflict. Place the clickable spread **before** the a11y-driven spread so the a11y value wins when present. When the a11y source returns nothing, the clickable `tabIndex: 0` serves as fallback.

```tsx
// tabIndex: 0 from clickable spread is overridden by getTabIndexAttribute(a11y) when a11y.tabIndex is set
<div
  {...(isClickable && {
    onClick: toggleReducedMotion,
    onKeyDown: handleKeyDown,
    role: 'button' as const,
    tabIndex: 0,
  })}
  {...getTabIndexAttribute(a11y)}
>
```
