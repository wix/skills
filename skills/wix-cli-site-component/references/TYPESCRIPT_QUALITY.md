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
interface ProfileCardProps {
  // Required system props
  className: string;
  id: string;
  wix?: Wix;

  // Optional component data (from editorElement.data)
  columns?: number;
  layout?: 'grid' | 'list' | 'masonry';
  showDetails?: boolean;

  // Optional element props (from elements definitions)
  elementProps?: {
    image?: {
      photo?: Image;
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
  photo?: Image;
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
const ProfileCard: React.FC<ProfileCardProps> = ({
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

## Validation Checklist

- [ ] All props interfaces use optional (`?`) for data properties
- [ ] Component functions have explicit return types
- [ ] useState calls have explicit type parameters
- [ ] useRef calls specify element types
- [ ] useEffect dependencies include all used values
- [ ] Optional chaining used for nested property access
- [ ] No `any` types used anywhere
- [ ] No `@ts-ignore` or `@ts-expect-error` comments
- [ ] All imports have correct types
- [ ] Generic types used appropriately for reusable components
