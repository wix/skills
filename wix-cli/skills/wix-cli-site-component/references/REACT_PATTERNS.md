# React Component Patterns

Guidelines for building production-quality React components that integrate seamlessly with Wix Editor manifests.

## General Instructions

### File Structure and Imports

- Import `./style.css` at the top of the component file
- Component must be a pure function, SSR-safe (no browser APIs at module scope, guard hooks)
- Declare types at top of file, include wix prop in interface
- Use default export for the main component

### Root Element Pattern

- Apply `className` and `id` to root element: `<div className={\`my-component ${className}\`} id={id}>`
- Top-level className MUST match manifest `editorElement.selector`
- Pattern: `className={\`base ${className}\`}` where `base` = selector without the dot
- Example: If selector is `.product-card`, then: `className={\`product-card ${className}\`}`

### Synchronization Requirements

- Sync component with manifest (props ↔ data keys, classNames ↔ selectors)
- Component MUST react to prop changes - if state is initialized from props, update it when props change using useEffect with prop dependencies
- Conditionally render ALL elements per `wix.elementsRemovalState` (all removable)

### Content and Data

- **All user-facing content must come from props** - text, media, links, labels, arrays should be controlled by manifest data
- Hardcoded values are ONLY for fallback defaults when props are undefined
- Links/media from manifest only, never hardcode URLs
- Map a11y props to DOM attributes when applicable

### Code Quality

- Default export required
- No TypeScript errors, unused variables, or TODOs
- Code must compile and pass linting on first try

## Component Hierarchy

### Three Component Types

**1. Leaf Components** - Render content only, no children:
```typescript
type LeafComponent<TProps> = (props: TProps & { className: string }) => React.JSX.Element;
```

**2. Container Components** - Render child sub-components:
```typescript
type ContainerComponent<TProps> = (
  props: TProps & {
    className: string;
    elementProps?: Record<string, any>;
    wix?: Wix;
  }
) => React.JSX.Element;
```

**3. Root Component** - The exported default, receives all builder props:
```typescript
type RootComponent<TProps> = (
  props: TProps & {
    id?: string;
    className: string;
    elementProps?: Record<string, any>;
    wix?: Wix;
  }
) => React.JSX.Element;
```

## Standard Props Structure

### Always Present Props

```typescript
interface BaseProps {
  className: string;  // CSS classes - MUST apply to root element
  id: string;        // Unique identifier - MUST apply to root element
  wix?: Wix;         // Wix system props including elementsRemovalState
}
```

### Wix System Props

```typescript
type REMOVED = 'REMOVED';

interface Wix {
  elementsRemovalState?: Record<string, REMOVED>;
}
```

### Element Props Structure

```typescript
interface ElementProps {
  [dataKey: string]: DataType;                    // Data from element
  elementProps?: Record<string, ElementProps>;    // Nested child elements
  wix?: Wix;                                      // Element-level removal state
}
```

### Complete Props Example

```typescript
interface ProductCardProps extends BaseProps {
  // Component-level data (from editorElement.data)
  columns?: number;
  layout?: 'grid' | 'list';

  // Element props (from elements definitions)
  elementProps?: {
    image?: {
      productImage?: Image;
      wix?: Wix;
      elementProps?: {
        badge?: {
          badgeText?: string;
          badgeColor?: string;
        };
      };
    };
    content?: {
      wix?: Wix;
      elementProps?: {
        title?: { titleText?: string };
        price?: { priceAmount?: number };
        button?: {
          buttonText?: string;
          buttonLink?: Link;
        };
      };
    };
  };
}
```

## Sub-Component Pattern

### Extract Every Distinct UI Unit

Create named sub-components for:
- **Manifest elements** - matching keys in manifest elements
- **Logical units** - buttons, icons, controls, sections
- **Reusable pieces** - any distinct JSX block

### Sub-Component Rules

1. **Unique nickname** (valid CSS classname, matches manifest element key)
2. **Pass nickname as className**
3. **Separate function component** for each element
4. **Single spread** for data props: `{...elementProps?.['childKey']}`
5. **Self-contained** - complete units, never wrap with semantic elements

### Example Implementation

```typescript
// Title sub-component
interface TitleProps {
  titleText?: string;
  className: string;
}

const Title: FC<TitleProps> = ({
  titleText = 'Default Title',
  className
}) => (
  <h2 className={className}>{titleText}</h2>
);

// Price sub-component
interface PriceProps {
  priceAmount?: number;
  currency?: string;
  className: string;
}

const Price: FC<PriceProps> = ({
  priceAmount = 0,
  currency = 'USD',
  className
}) => (
  <span className={className}>
    {new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(priceAmount)}
  </span>
);

// Button sub-component
interface ButtonProps {
  buttonText?: string;
  buttonLink?: Link;
  className: string;
}

const Button: FC<ButtonProps> = ({
  buttonText = 'Click Here',
  buttonLink,
  className
}) => {
  const handleClick = (e: React.MouseEvent) => {
    if (!buttonLink?.href || buttonLink.href === '#') {
      e.preventDefault();
    }
  };

  return (
    <a
      href={buttonLink?.href || '#'}
      target={buttonLink?.target}
      rel={buttonLink?.rel}
      className={className}
      onClick={handleClick}
    >
      {buttonText}
    </a>
  );
};

// Main component
const ProductCard: FC<ProductCardProps> = ({
  className,
  id,
  columns = 1,
  elementProps,
  wix
}) => {
  const removalState = wix?.elementsRemovalState || {};

  return (
    <div
      className={`product-card ${className}`}
      id={id}
      style={{ '--columns': columns } as React.CSSProperties}
    >
      {!removalState['image'] && (
        <div className="product-card__image">
          <img
            src={elementProps?.image?.productImage?.url || '/default-image.jpg'}
            alt={elementProps?.image?.productImage?.alt || 'Product'}
            className="product-card__img"
          />
          {!removalState['badge'] && elementProps?.image?.elementProps?.badge && (
            <span className="product-card__badge">
              {elementProps.image.elementProps.badge.badgeText}
            </span>
          )}
        </div>
      )}

      {!removalState['content'] && (
        <div className="product-card__content">
          {!removalState['title'] && (
            <Title
              className="product-card__title"
              {...elementProps?.content?.elementProps?.title}
            />
          )}

          {!removalState['price'] && (
            <Price
              className="product-card__price"
              {...elementProps?.content?.elementProps?.price}
            />
          )}

          {!removalState['button'] && (
            <Button
              className="product-card__button"
              {...elementProps?.content?.elementProps?.button}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default ProductCard;
```

## Props and State Management

### Default Handling

**Default each field independently**, never the entire element object:

```typescript
// ✅ Correct - individual field defaults
const titleText = elementProps?.title?.titleText || 'Default Title';
const priceAmount = elementProps?.price?.priceAmount || 0;

// ❌ Wrong - defaulting entire object
const titleProps = elementProps?.title || { titleText: 'Default' };
```

**For arrays, check length:**
```typescript
const items = (props?.items?.length > 0) ? props.items : DEFAULT_ITEMS;

// With safety checks in map
{items?.map((item, index) => {
  if (!item?.title) return null;
  return <div key={index}>{item.title}</div>;
})}
```

### State Synchronization

**Component MUST react to prop changes:**

```typescript
const [selectedTab, setSelectedTab] = useState(props.defaultTab);

// Sync state when props change
useEffect(() => {
  setSelectedTab(props.defaultTab);
}, [props.defaultTab]);
```

### Type Definitions

**All data props must be optional:**
```typescript
interface ComponentProps {
  // Required system props
  className: string;
  id: string;
  wix?: Wix;

  // Optional data props (use ?)
  title?: string;
  description?: string;
  items?: Array<Item>;
  config?: ConfigObject;
}
```

## Conditional Rendering

### Element Removal State

**All elements must be conditionally rendered:**

```typescript
const removalState = wix?.elementsRemovalState || {};

return (
  <div className={`component ${className}`} id={id}>
    {!removalState['header'] && (
      <Header {...elementProps?.header} />
    )}

    {!removalState['content'] && (
      <Content {...elementProps?.content} />
    )}

    {!removalState['footer'] && (
      <Footer {...elementProps?.footer} />
    )}
  </div>
);
```

### Nested Element Removal

```typescript
// Check removal state at each level
{!removalState['content'] && (
  <div className="content">
    {!elementProps?.content?.wix?.elementsRemovalState?.['title'] && (
      <Title {...elementProps?.content?.elementProps?.title} />
    )}
  </div>
)}
```

## Links and Media Handling

### Link Pattern

```typescript
interface LinkProps {
  buttonText?: string;
  buttonLink?: Link;
  className: string;
}

const LinkButton: FC<LinkProps> = ({ buttonText, buttonLink, className }) => {
  const handleClick = (e: React.MouseEvent) => {
    if (!buttonLink?.href || buttonLink.href === '#') {
      e.preventDefault();
    }
  };

  return (
    <a
      href={buttonLink?.href || '#'}
      target={buttonLink?.target}
      rel={buttonLink?.rel}
      className={className}
      onClick={handleClick}
    >
      {buttonText || 'Click Here'}
    </a>
  );
};
```

### Image Pattern

```typescript
interface ImageProps {
  productImage?: Image;
  className: string;
}

const ProductImage: FC<ImageProps> = ({ productImage, className }) => (
  <img
    src={productImage?.url || '/default-image.jpg'}
    alt={productImage?.alt || 'Product'}
    width={productImage?.width}
    height={productImage?.height}
    className={className}
  />
);
```

### Rich Text Pattern

**Note**: `dangerouslySetInnerHTML` and inline `<style>` tags are **forbidden** by ESLint rules. For rich text content, use CSS variables or the inline `style` prop for dynamic values.

```typescript
interface RichTextProps {
  content?: string;
  className: string;
}

// For simple formatted text, parse and render safely
const RichTextContent: FC<RichTextProps> = ({ content, className }) => (
  <div className={className}>
    {/* Render plain text or use a sanitized rendering approach */}
    {content || 'Default content'}
  </div>
);
```

**IMPORTANT**: If rich text HTML rendering is absolutely required, consult with the Wix CLI team for approved sanitization methods.

## Array Handling

### Safe Array Mapping

```typescript
interface ListProps {
  items?: Array<ListItem>;
  className: string;
}

const ItemList: FC<ListProps> = ({ items, className }) => {
  const safeItems = (items?.length > 0) ? items : DEFAULT_ITEMS;

  return (
    <ul className={className}>
      {safeItems.map((item, index) => {
        // Safety check for each item
        if (!item?.title) return null;

        return (
          <li key={item.id || index} className="item">
            <h3>{item.title}</h3>
            {item.description && <p>{item.description}</p>}
          </li>
        );
      })}
    </ul>
  );
};
```

### Default Arrays

```typescript
// Define outside component to prevent re-creation
const DEFAULT_FEATURES = [
  { id: '1', title: 'Feature 1', description: 'Description 1' },
  { id: '2', title: 'Feature 2', description: 'Description 2' },
  { id: '3', title: 'Feature 3', description: 'Description 3' }
];

const FeatureList: FC<FeatureListProps> = ({ features }) => {
  const displayFeatures = (features?.length > 0) ? features : DEFAULT_FEATURES;

  return (
    <div className="features">
      {displayFeatures.map(feature => (
        <FeatureCard key={feature.id} {...feature} />
      ))}
    </div>
  );
};
```

## TypeScript Best Practices

### Strict Typing

```typescript
// ✅ Proper type definitions
interface Image {
  uri: string;
  url: string;
  name?: string;
  alt?: string;
  width?: number;
  height?: number;
}

interface Link {
  href: string;
  target?: string;
  rel?: string;
}

// ✅ Union types for enums
type LayoutType = 'grid' | 'list' | 'masonry';
type ButtonVariant = 'primary' | 'secondary' | 'outline';

// ❌ Avoid any
const handleData = (data: any) => { ... }; // Wrong

// ✅ Use proper typing
const handleData = (data: ComponentData) => { ... }; // Correct
```

### Event Handlers

```typescript
// ✅ Proper event typing
const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.preventDefault();
  // Handle click
};

const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setValue(e.target.value);
};

// ✅ Custom event handlers
interface CustomHandler {
  onItemSelect?: (item: Item) => void;
  onItemRemove?: (id: string) => void;
}
```

## ESLint Compliance

### Critical ESLint Rules

1. **No unused vars/params/imports** (`@typescript-eslint/no-unused-vars`)
2. **No external images**: `img` `src` not `https://...` (allowed: local imports, `wixstatic.com`, variables)
3. **SSR-safe**: No `window`/`document` at module scope/constructor, guard browser APIs in `useEffect`/handlers
4. **No `dangerouslySetInnerHTML` or inline `<style>` tags** - use CSS variables or inline `style` prop for dynamic values
5. **No `window.fetch`** (`no-restricted-properties`)
6. **Hooks `exhaustive-deps`**: ALL values from component scope used inside `useEffect`/`useCallback` MUST be in dependency array
   - Functions used in `useEffect`: declare inside the hook and wrap in `useCallback`, or include in dependency array
   - Event handlers (e.g., `handleMouseMove`, `handleClick`) used in effects MUST be wrapped in `useCallback` or included in dependency array
   - Props/state/functions from component scope must be in dependency array
7. **Use `const`/`let` (no `var`)**, no unknown JSX properties

### Dependency Arrays

```typescript
// ✅ Include all dependencies
useEffect(() => {
  const handleResize = () => {
    setDimensions({ width: window.innerWidth, height: window.innerHeight });
  };

  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []); // No dependencies needed

// ✅ Include prop dependencies
useEffect(() => {
  if (autoPlay && duration) {
    const timer = setTimeout(() => {
      nextSlide();
    }, duration);
    return () => clearTimeout(timer);
  }
}, [autoPlay, duration, nextSlide]); // All used values included
```

### useCallback for Event Handlers

```typescript
// ✅ Wrap handlers used in effects
const handleMouseMove = useCallback((e: MouseEvent) => {
  setPosition({ x: e.clientX, y: e.clientY });
}, []);

useEffect(() => {
  document.addEventListener('mousemove', handleMouseMove);
  return () => document.removeEventListener('mousemove', handleMouseMove);
}, [handleMouseMove]); // Include in dependencies
```

### No External Images

```typescript
// ❌ External URLs not allowed
<img src="https://example.com/image.jpg" alt="Example" />

// ✅ Use assets or wixstatic.com
import { defaultImage } from './assets/defaultImages';
<img src={defaultImage} alt="Default" />

// ✅ Or wixstatic.com URLs
<img src="https://static.wixstatic.com/media/example.jpg" alt="Example" />
```

## Performance Considerations

### Avoid Re-renders

```typescript
// ✅ Memoize expensive calculations
const expensiveValue = useMemo(() => {
  return items.reduce((acc, item) => acc + item.value, 0);
}, [items]);

// ✅ Memoize components when needed
const MemoizedItem = React.memo<ItemProps>(({ item }) => (
  <div className="item">{item.title}</div>
));
```

### Lazy Loading

```typescript
// ✅ Lazy load heavy components
const HeavyChart = lazy(() => import('./HeavyChart'));

const Dashboard: FC<DashboardProps> = ({ showChart }) => (
  <div>
    {showChart && (
      <Suspense fallback={<div>Loading chart...</div>}>
        <HeavyChart />
      </Suspense>
    )}
  </div>
);
```
