# Lightbox Examples

Each provider is scaffolded with `wix generate` and registered by it, as [CONTEXT_PROVIDER.md](../CONTEXT_PROVIDER.md) describes. The examples are in this file (a repeater) and [EXAMPLES_CONDITION.md](EXAMPLES_CONDITION.md) (a countdown). Each shows the `.tsx` in full and only the manifest parts the scaffold does not write: `context`, `data` and `resources`.

## Open on a click, with data for the popup

From the request *"I want a repeater with 5 country names. In each item have a button that on click opens a lightbox with a greeting in the country's language."*

The same provider is attached to the opening page and to the popup page. On the opening page, the repeater binds to `countries` and each item's button click to that item's `openGreeting`. On the popup page, the texts bind to `selectedCountry` and `selectedGreeting`. The clicked country reaches the popup only through the payload of `open()`.

**`src/extensions/site/contexts/country-greeting-context/country-greeting-context.tsx`**:

```typescript
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { BooleanValue, Text } from '@wix/editor-react-types';
import { useService } from '@wix/services-manager-react';
import { LightboxDefinition, type ILightboxService } from '@wix/site-service-lightbox/definition';
import { PagesDefinition, type IPagesService } from '@wix/site-service-pages/definition';

type Greeting = { countryName: string; greeting: string };
type CountryItem = Greeting & { id: string; openGreeting: () => void };

function readPayload<T>(lightbox: ILightboxService | undefined): T | undefined {
  // Some Studio 2 hosts only provide getContext, the deprecated name of getPayload.
  return typeof lightbox?.getPayload === 'function'
    ? lightbox.getPayload<T | undefined>()
    : lightbox?.getContext<T | undefined>();
}

export interface CountryGreetingContextType {
  countries: CountryItem[];
  selectedCountry: Text;
  selectedGreeting: Text;
  isSelectionHidden: BooleanValue;
  isEmptyStateHidden: BooleanValue;
  isPopupErrorHidden: BooleanValue;
}

interface CountryGreetingProviderProps {
  children?: ReactNode;
  popupId?: Text;
}

const greetings: Array<Greeting & { id: string }> = [
  { id: 'france', countryName: 'France', greeting: 'Bonjour !' },
  { id: 'spain', countryName: 'Spain', greeting: '¡Hola!' },
  { id: 'germany', countryName: 'Germany', greeting: 'Hallo!' },
  { id: 'italy', countryName: 'Italy', greeting: 'Ciao!' },
  { id: 'japan', countryName: 'Japan', greeting: 'こんにちは！' },
];

const CountryGreetingContext = createContext<CountryGreetingContextType | null>(null);
CountryGreetingContext.displayName = 'CountryGreetingContext';

export function useCountryGreetingContext(): CountryGreetingContextType {
  const context = useContext(CountryGreetingContext);
  if (!context) throw new Error('useCountryGreetingContext must be used within CountryGreetingProvider');
  return context;
}

function useLightbox(): ILightboxService | undefined {
  try {
    return useService(LightboxDefinition);
  } catch {
    return undefined;
  }
}

function usePages(): IPagesService | undefined {
  try {
    return useService(PagesDefinition);
  } catch {
    return undefined;
  }
}

export function CountryGreetingProvider({ children, popupId }: CountryGreetingProviderProps): ReactNode {
  const lightbox = useLightbox();
  const pages = usePages();
  const [selection] = useState(() => readPayload<Greeting>(lightbox));
  const [openFailed, setOpenFailed] = useState(false);

  const openGreeting = (greeting: Greeting): void => {
    const popup = pages?.pages[popupId ?? ''];
    if (!lightbox || !popup?.popup) {
      setOpenFailed(true);
      return;
    }
    setOpenFailed(false);
    lightbox
      .open<Greeting>({
        slug: popup.slug,
        payload: { countryName: greeting.countryName, greeting: greeting.greeting },
        context: { countryName: greeting.countryName, greeting: greeting.greeting },
      })
      .catch(() => setOpenFailed(true));
  };

  const api: CountryGreetingContextType = {
    countries: greetings.map((item) => ({ ...item, openGreeting: () => openGreeting(item) })),
    selectedCountry: selection?.countryName ?? '',
    selectedGreeting: selection?.greeting ?? '',
    isSelectionHidden: selection === undefined,
    isEmptyStateHidden: selection !== undefined,
    isPopupErrorHidden: !openFailed,
  };

  return <CountryGreetingContext.Provider value={api}>{children}</CountryGreetingContext.Provider>;
}

CountryGreetingProvider.displayName = 'CountryGreetingProvider';
export default CountryGreetingProvider;
```

**`context`, `data` and `resources` in `country-greeting-context.extension.ts`**:

```typescript
context: {
  items: {
    countries: {
      dataType: 'arrayItems',
      displayName: 'Countries',
      description: 'Bind to the country repeater.',
      arrayItems: {
        item: {
          dataType: 'data',
          data: {
            items: {
              id: { dataType: 'text', displayName: 'Country ID' },
              countryName: { dataType: 'text', displayName: 'Country name', description: 'Bind to the item country text.' },
              greeting: { dataType: 'text', displayName: 'Greeting' },
              openGreeting: {
                dataType: 'function',
                displayName: 'Open greeting popup',
                description: "Bind to this item's button click. Opens the popup with this country.",
                function: { parameters: [] },
              },
            },
          },
        },
      },
    },
    selectedCountry: { dataType: 'text', displayName: 'Selected country', description: 'On the popup page, bind to the country text.' },
    selectedGreeting: { dataType: 'text', displayName: 'Selected greeting', description: 'On the popup page, bind to the greeting text.' },
    isSelectionHidden: { dataType: 'booleanValue', displayName: 'Selection hidden', description: 'On the popup page, true when it opened with no country. Bind to the greeting content hidden property.' },
    isEmptyStateHidden: { dataType: 'booleanValue', displayName: 'Empty state hidden', description: 'On the popup page, false when it opened with no country. Bind to the empty-state text hidden property.' },
    isPopupErrorHidden: { dataType: 'booleanValue', displayName: 'Popup error hidden', description: 'False when the popup could not open. Bind to an error text hidden property.' },
  },
},
data: {
  popupId: { dataType: 'text', displayName: 'Popup ID', description: 'The ID of the greeting popup page.' },
},
resources: {
  client: { url: './extensions/site/contexts/country-greeting-context/country-greeting-context.tsx' },
  contextSpecifier: { hook: 'useCountryGreetingContext', moduleSpecifier: '@/country-greeting-context' },
  dependencies: { serviceDependencies: ['@wix/site-service-lightbox', '@wix/site-service-pages'] },
},
```

**Final message**: Attach **Country greetings** to the opening page and to the popup page, set its **Popup ID** to the popup's ID, bind the repeater to **Countries** and each item's button to **Open greeting popup**, and bind the popup texts to **Selected country** and **Selected greeting**.
