# TypeScript Quality Guidelines

Strict TypeScript standards for production-quality site components with zero compilation errors.

## Core Principles

### Strict Configuration

Generated code MUST compile with zero TypeScript errors under strict settings:
- `strict: true`
- `noImplicitAny: true`
- `strictNullChecks: true`
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true`

### Type Safety First

- Prefer type-narrowing and exhaustive logic over assertions
- Avoid non-null assertions (`!`) and unsafe casts (`as any`)
- Treat optional values, refs, and array indexing as possibly undefined
- Use exhaustive checks for unions with never type guards
- Return total values (no implicit undefined)

## Type Definitions

### Component Props Interface

```typescript
// ✅ Correct - strict typing with optional data props
interface ProductCardProps {
  // Required system props
  className: string;
  id: string;
  wix?: Wix;

  // Optional component data (from editorElement.data)
  columns?: number;
  layout?: 'grid' | 'list' | 'masonry';
  showPrices?: boolean;

  // Optional element props (from elements definitions)
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
        price?: { priceAmount?: number; currency?: string };
        button?: { buttonText?: string; buttonLink?: Link };
      };
    };
  };
}

// ❌ Wrong - using any or missing optionals
interface BadProps {
  className: string;
  id: string;
  data: any; // Never use any
  title: string; // Should be optional
}
```

### Data Type Mappings

```typescript
// Runtime value types for manifest data types
interface DataTypeMapping {
  text: string;
  textEnum: string;
  number: number;
  booleanValue: boolean;
  localDate: string; // YYYY-MM-DD format
  localTime: string; // hh:mm format
  webUrl: string;
  richText: string; // HTML string
  link: Link;
  image: Image;
  video: Video;
  vectorArt: VectorArt;
  arrayItems: Array<unknown> | Array<Record<string, unknown>>;
  menuItems: Array<MenuItem>;
}

// Wix system types
interface Link {
  href: string;
  target?: string;
  rel?: string;
}

interface Image {
  uri: string;
  url: string;
  name?: string;
  alt?: string;
  width?: number;
  height?: number;
}

type REMOVED = 'REMOVED';

interface Wix {
  elementsRemovalState?: Record<string, REMOVED>;
}
```

### Sub-Component Props

```typescript
// ✅ Correct - explicit props with defaults
interface TitleProps {
  titleText?: string;
  className: string;
}

interface ButtonProps {
  buttonText?: string;
  buttonLink?: Link;
  variant?: 'primary' | 'secondary' | 'outline';
  className: string;
}

interface ImageProps {
  productImage?: Image;
  className: string;
  loading?: 'lazy' | 'eager';
}

// ✅ Array item props
interface FeatureItemProps {
  title?: string;
  description?: string;
  icon?: VectorArt;
  className: string;
}
```

## Function Signatures

### Component Functions

```typescript
// ✅ Correct - explicit return type
const ProductCard: React.FC<ProductCardProps> = ({
  className,
  id,
  columns = 1,
  layout = 'grid',
  elementProps,
  wix
}): React.JSX.Element => {
  // Implementation
  return <div>...</div>;
};

// ✅ Sub-component with explicit return
const Title: React.FC<TitleProps> = ({
  titleText = 'Default Title',
  className
}): React.JSX.Element => (
  <h2 className={className}>{titleText}</h2>
);

// ❌ Wrong - implicit return type
const BadComponent = (props: any) => {
  return <div>...</div>;
};
```

### Event Handlers

```typescript
// ✅ Correct - explicit event types
const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
  e.preventDefault();
  // Handle click logic
};

const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
  setValue(e.target.value);
};

const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
  e.preventDefault();
  // Handle form submission
};

// ✅ Custom event handlers
interface CustomHandlers {
  onItemSelect?: (item: Item) => void;
  onItemRemove?: (id: string) => void;
  onStateChange?: (state: ComponentState) => void;
}
```

### Hook Usage

```typescript
// ✅ Correct - explicit state types
const [selectedIndex, setSelectedIndex] = useState<number>(0);
const [items, setItems] = useState<Array<Item>>([]);
const [isLoading, setIsLoading] = useState<boolean>(false);
const [error, setError] = useState<string | null>(null);

// ✅ Ref typing
const containerRef = useRef<HTMLDivElement>(null);
const inputRef = useRef<HTMLInputElement>(null);

// ✅ Effect with proper dependencies
useEffect((): void => {
  if (autoPlay && duration && !isLoading) {
    const timer = setTimeout(() => {
      setSelectedIndex(prev => (prev + 1) % items.length);
    }, duration);

    return (): void => {
      clearTimeout(timer);
    };
  }
}, [autoPlay, duration, isLoading, items.length]);
```

## Type Guards and Narrowing

### Null/Undefined Checks

```typescript
// ✅ Correct - explicit null checks
const renderTitle = (elementProps?: ElementProps): React.JSX.Element | null => {
  if (!elementProps?.title?.titleText) {
    return null;
  }

  return <h2>{elementProps.title.titleText}</h2>;
};

// ✅ Optional chaining with fallbacks
const getImageUrl = (image?: Image): string => {
  return image?.url ?? '/default-image.jpg';
};

// ✅ Array length checks
const renderItems = (items?: Array<Item>): React.JSX.Element => {
  if (!items || items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div>
      {items.map((item, index) => {
        if (!item?.id || !item?.title) {
          return null;
        }
        return <ItemCard key={item.id} item={item} />;
      })}
    </div>
  );
};
```

### Union Type Handling

```typescript
// ✅ Correct - exhaustive union handling
type ButtonVariant = 'primary' | 'secondary' | 'outline';

const getButtonClasses = (variant: ButtonVariant): string => {
  switch (variant) {
    case 'primary':
      return 'btn btn--primary';
    case 'secondary':
      return 'btn btn--secondary';
    case 'outline':
      return 'btn btn--outline';
    default:
      // Exhaustive check with never
      const _exhaustive: never = variant;
      return _exhaustive;
  }
};

// ✅ Layout type with proper handling
type LayoutType = 'grid' | 'list' | 'masonry';

const getLayoutClasses = (layout: LayoutType = 'grid'): string => {
  const baseClass = 'product-grid';

  switch (layout) {
    case 'grid':
      return `${baseClass} ${baseClass}--grid`;
    case 'list':
      return `${baseClass} ${baseClass}--list`;
    case 'masonry':
      return `${baseClass} ${baseClass}--masonry`;
    default:
      const _exhaustive: never = layout;
      return _exhaustive;
  }
};
```

### Type Predicates

```typescript
// ✅ Type predicate functions
const isValidImage = (image: unknown): image is Image => {
  return (
    typeof image === 'object' &&
    image !== null &&
    'url' in image &&
    typeof (image as Image).url === 'string'
  );
};

const isValidLink = (link: unknown): link is Link => {
  return (
    typeof link === 'object' &&
    link !== null &&
    'href' in link &&
    typeof (link as Link).href === 'string'
  );
};

// Usage with type narrowing
const renderImage = (image: unknown): React.JSX.Element | null => {
  if (!isValidImage(image)) {
    return null;
  }

  // image is now typed as Image
  return <img src={image.url} alt={image.alt || 'Image'} />;
};
```

## Error Handling

### Safe Property Access

```typescript
// ✅ Correct - safe property access
const getNestedValue = (
  elementProps?: ElementProps
): string | undefined => {
  return elementProps?.content?.elementProps?.title?.titleText;
};

// ✅ Safe array access
const getFirstItem = <T>(items?: Array<T>): T | undefined => {
  return items?.[0];
};

// ✅ Safe object access with defaults
const getConfigValue = (
  config?: Record<string, unknown>,
  key: string,
  defaultValue: string = ''
): string => {
  const value = config?.[key];
  return typeof value === 'string' ? value : defaultValue;
};
```

### Runtime Validation

```typescript
// ✅ Runtime validation with type guards
const validateComponentProps = (
  props: unknown
): props is ProductCardProps => {
  if (typeof props !== 'object' || props === null) {
    return false;
  }

  const p = props as Record<string, unknown>;

  return (
    typeof p.className === 'string' &&
    typeof p.id === 'string'
  );
};

// ✅ Safe parsing with error handling
const parseJsonSafely = <T>(
  json: string,
  fallback: T
): T => {
  try {
    const parsed = JSON.parse(json);
    return parsed as T;
  } catch {
    return fallback;
  }
};
```

## Generic Types

### Reusable Component Types

```typescript
// ✅ Generic list component
interface ListProps<T> {
  items?: Array<T>;
  renderItem: (item: T, index: number) => React.JSX.Element;
  keyExtractor: (item: T) => string;
  className: string;
  emptyMessage?: string;
}

const List = <T,>({
  items = [],
  renderItem,
  keyExtractor,
  className,
  emptyMessage = 'No items found'
}: ListProps<T>): React.JSX.Element => {
  if (items.length === 0) {
    return <div className={`${className}__empty`}>{emptyMessage}</div>;
  }

  return (
    <div className={className}>
      {items.map((item, index) => (
        <div key={keyExtractor(item)} className={`${className}__item`}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
};

// ✅ Generic data fetching hook
interface UseDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const useData = <T>(
  fetcher: () => Promise<T>,
  dependencies: Array<unknown> = []
): UseDataResult<T> => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async (): Promise<void> => {
      try {
        setLoading(true);
        setError(null);
        const result = await fetcher();

        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return (): void => {
      cancelled = true;
    };
  }, dependencies);

  return { data, loading, error };
};
```

## Utility Types

### Component-Specific Utilities

```typescript
// ✅ Extract element props type
type ElementProps<T> = T extends { elementProps?: infer E } ? E : never;

// ✅ Make properties required
type RequiredProps<T, K extends keyof T> = T & Required<Pick<T, K>>;

// ✅ Component with required className
type ComponentWithClassName<T> = RequiredProps<T, 'className'>;

// ✅ Extract data properties
type DataProps<T> = Omit<T, 'className' | 'id' | 'wix' | 'elementProps'>;

// ✅ Element removal state helper
type RemovalState = Record<string, 'REMOVED'>;

const isElementRemoved = (
  removalState: RemovalState | undefined,
  elementKey: string
): boolean => {
  return removalState?.[elementKey] === 'REMOVED';
};
```

## Common Patterns

### Conditional Rendering with Types

```typescript
// ✅ Type-safe conditional rendering
interface ConditionalProps {
  condition?: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

const Conditional: React.FC<ConditionalProps> = ({
  condition = false,
  children,
  fallback = null
}): React.JSX.Element | null => {
  return condition ? <>{children}</> : <>{fallback}</>;
};

// Usage
<Conditional condition={!isElementRemoved(removalState, 'title')}>
  <Title {...elementProps?.title} />
</Conditional>
```

### Array Mapping with Safety

```typescript
// ✅ Type-safe array mapping
const renderItems = <T extends { id: string }>(
  items: Array<T> | undefined,
  renderFn: (item: T) => React.JSX.Element
): Array<React.JSX.Element> => {
  if (!items || items.length === 0) {
    return [];
  }

  return items
    .filter((item): item is T => Boolean(item?.id))
    .map(renderFn);
};
```

## Validation Checklist

- [ ] All props interfaces use optional (`?`) for data properties
- [ ] Component functions have explicit return types
- [ ] Event handlers have proper event types
- [ ] useState calls have explicit type parameters
- [ ] useRef calls specify element types
- [ ] useEffect dependencies include all used values
- [ ] Union types handled exhaustively with never checks
- [ ] Optional chaining used for nested property access
- [ ] Array access checked for length before mapping
- [ ] No `any` types used anywhere
- [ ] No `@ts-ignore` or `@ts-expect-error` comments
- [ ] All imports have correct types
- [ ] Generic types used appropriately for reusable components
