# Lightbox Examples: Open on a Condition

## Open on a condition, close from code

From the request *"Add a countdown timer that counts down from 10 seconds. When it reaches zero, open a lightbox that says "Time's up!" with a Close button that closes the lightbox."*

The popup's text is fixed, so it is a normal text element on the popup page. The payload of `open()` carries only `timerExpired`, which tells the provider instance on the popup page not to run a second countdown. The open runs once, from an effect, when the countdown reaches zero.

**`src/extensions/site/contexts/countdown-popup-context/countdown-popup-context.tsx`**:

```typescript
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BooleanValue, NumberType, Text } from '@wix/editor-react-types';
import { useService } from '@wix/services-manager-react';
import { LightboxDefinition, type ILightboxService } from '@wix/site-service-lightbox/definition';
import { PagesDefinition, type IPagesService } from '@wix/site-service-pages/definition';

type CountdownPopupContext = { timerExpired: boolean };

function readPayload<T>(lightbox: ILightboxService | undefined): T | undefined {
  // Some Studio 2 hosts only provide getContext, the deprecated name of getPayload.
  return typeof lightbox?.getPayload === 'function'
    ? lightbox.getPayload<T | undefined>()
    : lightbox?.getContext<T | undefined>();
}

export interface CountdownPopupContextType {
  secondsRemaining: NumberType;
  countdownText: Text;
  isPopupErrorHidden: BooleanValue;
  closePopup: () => void;
}

interface CountdownPopupProviderProps {
  children?: ReactNode;
  popupId?: Text;
}

const COUNTDOWN_SECONDS = 10;

const CountdownPopupContextValue = createContext<CountdownPopupContextType | null>(null);
CountdownPopupContextValue.displayName = 'CountdownPopupContext';

export function useCountdownPopupContext(): CountdownPopupContextType {
  const context = useContext(CountdownPopupContextValue);
  if (!context) throw new Error('useCountdownPopupContext must be used within CountdownPopupProvider');
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

export function CountdownPopupProvider({ children, popupId }: CountdownPopupProviderProps): ReactNode {
  const lightbox = useLightbox();
  const pages = usePages();
  const [isPopupPage] = useState(() => readPayload<CountdownPopupContext>(lightbox)?.timerExpired === true);
  const [secondsRemaining, setSecondsRemaining] = useState(COUNTDOWN_SECONDS);
  const [openFailed, setOpenFailed] = useState(false);
  const hasOpened = useRef(false);

  useEffect(() => {
    if (isPopupPage) return undefined;
    const deadline = Date.now() + COUNTDOWN_SECONDS * 1000;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 250);
    return () => clearInterval(interval);
  }, [isPopupPage]);

  useEffect(() => {
    if (isPopupPage || secondsRemaining !== 0 || hasOpened.current) return;
    hasOpened.current = true;
    const popup = pages?.pages[popupId ?? ''];
    if (!lightbox || !popup?.popup) {
      setOpenFailed(true);
      return;
    }
    lightbox
      .open<CountdownPopupContext>({ slug: popup.slug, payload: { timerExpired: true }, context: { timerExpired: true } })
      .catch(() => setOpenFailed(true));
  }, [isPopupPage, secondsRemaining, popupId, pages, lightbox]);

  const api: CountdownPopupContextType = {
    secondsRemaining,
    countdownText: `${secondsRemaining} seconds remaining`,
    isPopupErrorHidden: !openFailed,
    closePopup: () => lightbox?.close(),
  };

  return <CountdownPopupContextValue.Provider value={api}>{children}</CountdownPopupContextValue.Provider>;
}

CountdownPopupProvider.displayName = 'CountdownPopupProvider';
export default CountdownPopupProvider;
```

**`context`, `data` and `resources` in `countdown-popup-context.extension.ts`**:

```typescript
context: {
  items: {
    secondsRemaining: { dataType: 'number', displayName: 'Seconds remaining', description: 'Bind to a number display of the countdown.' },
    countdownText: { dataType: 'text', displayName: 'Countdown text', description: 'Bind to the countdown text element.' },
    isPopupErrorHidden: { dataType: 'booleanValue', displayName: 'Popup error hidden', description: 'False when the popup could not open. Bind to an error text hidden property.' },
    closePopup: {
      dataType: 'function',
      displayName: 'Close popup',
      description: "On the popup page, bind to the Close button's click.",
      function: { parameters: [] },
    },
  },
},
data: {
  popupId: { dataType: 'text', displayName: 'Popup ID', description: 'The ID of the popup page to open when the countdown ends.' },
},
resources: {
  client: { url: './extensions/site/contexts/countdown-popup-context/countdown-popup-context.tsx' },
  contextSpecifier: { hook: 'useCountdownPopupContext', moduleSpecifier: '@/countdown-popup-context' },
  dependencies: { serviceDependencies: ['@wix/site-service-lightbox', '@wix/site-service-pages'] },
},
```

**Final message**: Add a new text for the countdown and bind it to **Countdown text**; attach **Countdown popup** to that page and to the popup page and set its **Popup ID** to the popup's ID; on the popup page, add a "Time's up!" text and a Close button bound to **Close popup**; and turn off the popup's automatic opening on page load.
