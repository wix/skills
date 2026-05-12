# Component API

Rules and patterns for props structure, elementProps, data types, file structure, containers, data-driven components, and array props.

---

## Should This Use elementProps or CSS?

```
Does this element need:
- Configuration/data beyond styling
- Direction override
- State management
- Event handlers

│
├─ YES
│   └─ ✅ Use elementProps
│
└─ NO → Is it purely visual/decorative (including conditionally displayed)?
    │
    ├─ YES (icons, separators, decorations, elements only hidden/shown via CSS)
    │   └─ ❌ CSS class only (no elementProps)
    │
    └─ NO
        └─ Re-evaluate: likely needs elementProps
```

---

## Rules

### Component Props Structure

```typescript
interface ComponentProps {
  // Identity
  id?: string;
  className?: string;

  // Mandatory features (from @wix/editor-react-types)
  direction?: Direction;
  a11y?: A11y; // ALL ARIA attributes come through this (ariaLabel, role, etc.)

  // Component-specific props (NO children unless container-type - see container rules below)
  label?: string;
  items?: Array<ItemType>;
  // ... from specification
  // NEVER add: ariaLabel, ariaDescribedBy, role, etc. - use a11y prop instead

  // Sub-component configuration (only if needed - see elementProps rules)
  elementProps?: {
    [partName]?: {
      [configProp]?: string | boolean | number; // Only include if element needs config beyond className
      direction?: Direction;
    };
  };
}
```

### When to Use elementProps

**Use `elementProps`** for parts that need:

- Configuration/data beyond just styling
- Direction override
- State management
- Event handlers

**DO NOT use `elementProps`** for:

- Elements with only visual styling (use CSS classes)
- Elements where conditional display is the only requirement (visibility controlled via CSS for per-breakpoint hiding, not React props)
- Elements that would only have `className` — skip them entirely
- Icons, decorations, separators

**Minimal elementProps rule:** If an element would only have `className?: string` in elementProps, do NOT include it.

### What Qualifies as a Part

See [`PARTS.md`](PARTS.md) for the mandatory filter and full rules.

### Derived values are not props

If a displayed value can be computed with a simple pure function from
other props and/or internal state, compute it internally — don't
expose it as a prop. Expose only the source inputs (use numeric types
when arithmetic is needed: `price: number`, not `price: string`).

**Example:** subtotal = `price × quantity` → computed inside the component, not a prop.

### Data-Driven Components (NO children in exported props)

- Component's **exported interface** must NOT accept `children` prop
- ALL content MUST come through explicit named props (see "Derived values" above for what stays internal):
  - Text (labels, placeholders, messages) → `label`, `text`, `placeholder`, etc.
  - Media (images, videos, icons) → `imageSrc`, `videoUrl`, `iconName`, etc.
  - Links (URLs, hrefs) → `link`, `href`, `url`, etc.
  - Collections (list items, options, menu items) → `items`, `options`, `menuItems`, etc.
- **Internal implementation** can use children for composition between sub-components
- Hardcoded values are ONLY for fallback defaults when props are undefined

**Exception — Container-type components:** Components whose purpose is to wrap arbitrary child elements (e.g., BoxContainer, LegacyContainer) MAY accept `children: Container` (from `@wix/editor-react-types`). This applies only to structural containers — data-driven leaf components (Button, Tabs, Accordion, etc.) must NOT use `children`.

### Array Props: Data on Parent Only

When the parent component defines an array prop (e.g., `items`), child/item components receive a single item directly. They do NOT redeclare the data structure in their own props.

### Array Element Types: Always Objects with Named Keys

Array elements MUST be objects with named keys. This enables stable item identity (each item can carry its own `id`/`key`), non-breaking extension (new fields can be added later without changing the prop signature), and semantic naming (each value has meaning instead of being an opaque scalar).

**Allowed forms:**

- Inline object literal: `Array<{ key: ValueType, ... }>`
- Named interface where the interface itself is an object with named keys (e.g. `Array<AccordionItem>` is OK because `AccordionItem` is `{ name, content }`)

**Never allowed as the array element:**

- Primitives: `Array<string>`, `Array<number>`, `Array<boolean>`
- Leaf data types from `@wix/editor-react-types`: `Array<Image>`, `Array<Link>`, `Array<Video>`, `Array<Audio>`, `Array<VectorArt>`, `Array<RichText>`. Wrap them in an object instead.

**❌ Wrong:**

```typescript
tags: Array<string>;
prices: Array<number>;
flags: Array<boolean>;
images: Array<Image>;
links: Array<Link>;
```

**✅ Correct:**

```typescript
tags: Array<{ label: string }>;
prices: Array<{ amount: number }>;
flags: Array<{ enabled: boolean }>;
gallery: Array<{ image: Image, caption?: string }>;
links: Array<{ link: Link, label: string }>;
items: Array<AccordionItem>; // AccordionItem is { name, content }
```

### Container Components (Blackbox Content)

When a component specification indicates a "container" or "slot" area where users can add nested content, use `Container` (from `@wix/editor-react-types`) for that content prop. Never use `React.ReactNode` in a prop type.

**When to use `Container`:**

- The specification describes a "container" or "content area"
- Users should be able to add arbitrary nested components
- The component doesn't control what goes inside that area

**RTL Support:** Elements that render `Container` content MUST have `dir="ltr"` to prevent RTL inheritance from the parent component. See [`DIRECTIONALITY.md`](DIRECTIONALITY.md).

### Component Data Types

When creating TypeScript interfaces for component props, use types from `@wix/editor-react-types` for more complex types:

```typescript
import type {
  Link,
  Image,
  Video,
  Audio,
  VectorArt,
  A11y,
  RichText,
  Direction,
  ArrayItems,
  MenuItems,
} from '@wix/editor-react-types';
```

**Common Types Usage:**

- **Text data** → `string`
- **Numeric data** → `number`
- **Boolean flags** → `boolean`
- **Enum options** → `string` union (e.g., `'option1' | 'option2'`)
- **Direction** → `Direction` (= `'rtl' | 'ltr' | 'auto'`)
- **Links** → `Link`
- **Images** → `Image`
- **Videos** → `Video`
- **Audio** → `Audio`
- **Vector graphics** → `VectorArt`
- **Accessibility** → `A11y`
- **Rich text** → `RichText`
- **Arrays/Lists** → `Array<{ key: ValueType, ... }>` — must be an object with named keys; never a primitive or leaf data type (see "Array Element Types" rule below)
- **Menu items** → `MenuItems`

### Component File Splitting

Split logical UI pieces into separate named components. Never write inline JSX blocks for distinct complex UI pieces.

**File structure for complex components (many subcomponents):**

```
ComponentName/
├── components/                 # Subcomponents folder
│   ├── SubComponent1/
│   │   ├── SubComponent1.tsx
│   │   ├── SubComponent1.module.scss
│   │   └── index.ts
│   └── SubComponent2/
│       ├── SubComponent2.tsx
│       └── index.ts
├── hooks/                      # Custom hooks folder
│   ├── index.ts
│   └── useCustomHook.ts
```

**When to extract a sub-component:**

- JSX block represents a logical complex unit (button, control, section, item)
- Component has its own props interface
- Logic is reusable or testable independently
- Block has more than 15-20 lines of JSX

---

## Patterns

### Data-Driven Pattern

**❌ Wrong:**

```typescript
export interface ButtonProps {
  children: React.ReactNode;  // ❌
}
<Button>Click Me</Button>
```

**✅ Correct:**

```typescript
export interface ButtonProps {
  label?: string;
  icon?: string;
}
<Button label={label} icon={icon} />
```

Component controls rendering internally:

```typescript
const List = ({ items }) => (
  <div>
    {items.map(item => (
      <ListItem key={item.id}>{item.label}</ListItem>
    ))}
  </div>
);
```

### Array Props Pattern

Parent defines array structure, child receives single item:

```typescript
// Parent
interface ParentProps {
  items: Array<AccordionItem>;  // Array defined here
}

interface AccordionItem {
  name: string;
  content: Container;
}

// Child receives single item
interface ChildProps {
  item: AccordionItem & { id: string };  // Single item
  isOpen?: BooleanValue;
}

// Parent maps
items.map((item, index) => (
  <Child key={index} item={{ ...item, id: index.toString() }} />
))
```

### Container Components Pattern

For "container" or "slot" areas, use `Container`:

```typescript
interface AccordionItem {
  name: string;
  content: Container;  // Users add any content here
}

// Render
{items.map((item, index) => (
  <div key={index} dir="ltr">
    {typeof item.content === 'function' ? item.content({}) : item.content}
  </div>
))}
```

---

## Common Mistakes

### Using children prop in exported interface

**❌ Wrong:**

```typescript
export interface CardProps {
  children: React.ReactNode;  // ❌ children + React.ReactNode both forbidden
}
<Card><CardHeader>Title</CardHeader></Card>
```

**✅ Correct:**

```typescript
export interface CardProps {
  title: string;
  content: Container; // Blackbox container (from @wix/editor-react-types)
}
<Card title="Title" content={<div>Content</div>} />
```

### Adding elementProps for CSS-only elements

**❌ Wrong:**

```typescript
elementProps?: {
  icon?: { className?: string; }  // ❌ Only className
  separator?: { className?: string; }  // ❌ Only className
}
```

**✅ Correct:**

```typescript
// No elementProps for purely visual elements (including conditionally displayed)
// Style via CSS classes directly
```

**Why:** If element only has `className` (even if it can be hidden/shown via CSS), skip elementProps entirely. Conditional display is controlled via CSS, not React props.

### Using T[] array syntax

Use `Array<T>` over `T[]`.

**❌ Wrong:**

```typescript
interface ComponentProps {
  items: Item[]; // ❌ Wrong syntax
  tags: string[]; // ❌ Wrong syntax
  tags: Array<string>; // ❌ Element must be an object with named keys
}
```

**✅ Correct:**

```typescript
interface ComponentProps {
  items: Array<Item>; // ✅ Correct syntax
  tags: Array<{ label: string }>; // ✅ Element is an object with named keys
}
```

See also: [Array Element Types: Always Objects with Named Keys](#array-element-types-always-objects-with-named-keys) — items must be objects with named keys.
