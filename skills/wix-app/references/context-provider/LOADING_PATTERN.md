# Loading Pattern: The Complete Provider

> **Read the page's own context first.** This example fetches a Bookings service with the SDK only to show the loading pattern. When the data belongs to Stores, Blog, Bookings or Events and the site already provides that context ([VERTICAL_CONTEXTS.md](VERTICAL_CONTEXTS.md)), read the hook instead: no SDK call and no `serviceId` field. A provider that only reads a vertical hook still exposes the loading pair, derived from the loading and error fields that context lists (for example `isLoading` and `hasError`). Use this pattern for data no context provides.

## The Pattern

One provider, complete. Everything after this section explains a decision visible in it — read the code first, then the rules.

From the request *"On my service page, show the name and price of the service from Wix Bookings, and show a grey placeholder bar in place of each while it loads. The Contact Us button and the header image should stay visible the whole time. Use context providers and native components, do not create an editor react component."*

`@wix/bookings` appears only because this is a Bookings example — the pattern does not depend on it. Substitute whatever data source the request names. The one package the pattern itself requires is `@wix/react-use-promise-polyfill`, for `use()`.

**`src/extensions/site/contexts/booking-service-context/booking-service-context.tsx`**:

```typescript
import React, {
  Suspense,
  createContext,
  useContext,
  useRef,
  useState,
} from 'react';
import { use } from '@wix/react-use-promise-polyfill';
import { services } from '@wix/bookings';
import type { BooleanValue, Text } from '@wix/editor-react-types';

// Use the SDK's own exported entity type. Do NOT derive one from the method —
// see "Name the entity type, do not derive it" below.
type ServiceDetails = services.Service;

export interface BookingServiceContextType {
  serviceName: Text;
  servicePrice: Text;
  isPlaceholderHidden: BooleanValue;
  isContentHidden: BooleanValue;
  showService: (serviceId: string) => void;
}

export interface BookingServiceProviderProps {
  children?: React.ReactNode;
  serviceId: Text;
}

interface BookingServiceInternalProps {
  children?: React.ReactNode;
  initialServicePromise: Promise<ServiceDetails | null>;
}

const BookingServiceContext = createContext<BookingServiceContextType | null>(null);
BookingServiceContext.displayName = 'BookingServiceContext';

export function useBookingServiceContext(): BookingServiceContextType {
  const context = useContext(BookingServiceContext);
  if (!context) {
    throw new Error(
      'useBookingServiceContext must be used within a BookingServiceContextProvider',
    );
  }
  return context;
}

// The only place the SDK is called, and it never rejects — see "The fetch
// wrapper must never reject" for why, and why the id guard is there.
const fetchService = (serviceId: string): Promise<ServiceDetails | null> => {
  if (!serviceId) {
    return Promise.resolve(null);
  }
  return services.getService(serviceId).catch((): null => null);
};

// Every key the manifest declares, at placeholder values — a missing key breaks its binding.
const placeholderApi = (): BookingServiceContextType => ({
  serviceName: '',
  servicePrice: '',
  isPlaceholderHidden: false,
  isContentHidden: true,
  showService: () => {},
});

// Keeps children rendered while the initial promise is pending. No spinner here —
// the treatment lives in the bound elements.
function BookingServiceContextFallback({
  children,
}: { children?: React.ReactNode }): React.ReactNode {
  return (
    <BookingServiceContext.Provider value={placeholderApi()}>
      {children}
    </BookingServiceContext.Provider>
  );
}

BookingServiceContextFallback.displayName = 'BookingServiceContextFallback';

// Outer — owns the boundary AND the initial promise. It never calls use(), so it
// never suspends and its state survives. The default export the runtime loads.
export function BookingServiceContextProvider({
  children,
  serviceId,
}: BookingServiceProviderProps): React.ReactNode {
  const [initialServicePromise] = useState(() => fetchService(serviceId));

  return (
    <Suspense
      fallback={<BookingServiceContextFallback>{children}</BookingServiceContextFallback>}
    >
      <BookingServiceContextInternal initialServicePromise={initialServicePromise}>
        {children}
      </BookingServiceContextInternal>
    </Suspense>
  );
}

// Internal — suspends on the initial promise under the boundary above. It
// consumes the promise and never creates one.
function BookingServiceContextInternal({
  children,
  initialServicePromise,
}: BookingServiceInternalProps): React.ReactNode {
  const initialService = use(initialServicePromise);

  const [service, setService] = useState<ServiceDetails | null>(initialService);
  const [isFetching, setIsFetching] = useState(false);
  // A ref, not state — this guard must never trigger a re-render.
  const latestRequest = useRef(0);

  const showService = (nextServiceId: string): void => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setIsFetching(true);
    fetchService(nextServiceId).then((nextService) => {
      // A slower earlier request must not overwrite a newer one.
      if (latestRequest.current !== requestId) {
        return;
      }
      // A failed fetch settles to null. Writing that would discard the service
      // already on screen, so only a real result replaces it.
      if (nextService !== null) {
        setService(nextService);
      }
      setIsFetching(false);
    });
  };

  // Derived at render time from the state — never stored in a second state value.
  const serviceName = service?.name ?? '';
  const servicePrice = service?.payment?.fixed?.price?.formattedValue ?? '';

  const api: BookingServiceContextType = {
    serviceName,
    servicePrice,
    isPlaceholderHidden: !isFetching,
    // Independent of isPlaceholderHidden, not its complement — during a refetch both are false.
    isContentHidden: service === null,
    showService,
  };

  return (
    <BookingServiceContext.Provider value={api}>{children}</BookingServiceContext.Provider>
  );
}

BookingServiceContextInternal.displayName = 'BookingServiceContextInternal';
BookingServiceContextProvider.displayName = 'BookingServiceContextProvider';
export default BookingServiceContextProvider;
```

**`context`, `data` and `contextSpecifier` in `src/extensions/site/contexts/booking-service-context/booking-service-context.extension.ts`** (the rest of the file is generated by `wix generate`):

```typescript
context: {
  items: {
    serviceName: {
      dataType: 'text',
      displayName: 'Service name',
      description: 'Name of the service currently being shown. Bind to the service name text element content.',
    },
    servicePrice: {
      dataType: 'text',
      displayName: 'Service price',
      description: 'The service price, already formatted in the site currency. Bind to the price text element content.',
    },
    isContentHidden: {
      dataType: 'booleanValue',
      displayName: 'Content is hidden',
      description: 'True when no service is loaded. Bind to the hidden property of the name and price elements.',
    },
    isPlaceholderHidden: {
      dataType: 'booleanValue',
      displayName: 'Loading placeholders are hidden',
      description: 'True when no fetch is in progress. Bind to the hidden property of the grey placeholder bars.',
    },
    showService: {
      dataType: 'function',
      displayName: 'Show a different service',
      description: 'Loads another service and swaps it in without blanking the page. Bind to a service link or button click handler.',
      function: {
        parameters: [
          {
            dataType: 'text',
            displayName: 'Service ID',
            description: 'ID of the service to show.',
          },
        ],
        async: false,
      },
    },
  },
},
data: {
  serviceId: {
    dataType: 'text',
    deprecated: false,
    displayName: 'Service ID',
  },
},
resources: {
  contextSpecifier: {
    hook: 'useBookingServiceContext',
    moduleSpecifier: '<moduleSpecifierPrefix>booking-service-context',
  },
},
```

### What the Site Owner Binds

Each text element's content goes to `serviceName` or `servicePrice` (the platform converts `text` to rich text at the binding), and both elements' `hidden` property to `isContentHidden`. The grey placeholder bars bind their `hidden` property to `isPlaceholderHidden`. The **Contact Us button and header image are bound to nothing** — no visibility binding, so they stay visible throughout.
