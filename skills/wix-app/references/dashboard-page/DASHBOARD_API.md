# Dashboard API Reference

Reference for the `@wix/dashboard` host module. This reference is in four files:

| Methods | File |
|---|---|
| `navigate()`, `observeState()`, `showToast()`, `openModal()`, `closeModal()` | This file |
| Page IDs for `navigate()` | [DASHBOARD_API_PAGE_IDS.md](DASHBOARD_API_PAGE_IDS.md) |
| `navigateBack()`, `getPageUrl()`, `getSiteInfo()`, `onBeforeUnload()`, `setPageTitle()`, `onLayerStateChange()` | [DASHBOARD_API_PAGE_HELPERS.md](DASHBOARD_API_PAGE_HELPERS.md) |
| `openMediaManager()`, `addSitePlugin()` | [DASHBOARD_API_MEDIA_AND_PLUGINS.md](DASHBOARD_API_MEDIA_AND_PLUGINS.md) |

## navigate()

Host Module '@wix/dashboard' 'navigate()' method for navigating between dashboard pages.

**Method parameters:**
- `destination`: Destination
- `options?`: NavigationOptions

**Destination object:**
- `pageId` (string): ID of the page to navigate to
- `relativeUrl` (string): Optional. URL segment appended to the base page URL. Can include path segments, query string, and fragment.

**Navigation options:**
- `displayMode` ("main" | "overlay" | "auto"): How to display the destination page. "auto" (default) loads in current context.
- `history` ("push" | "replace"): Optional. Whether to push a new history entry or replace the current one.

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';
// Navigate to your own app's page with some internal state
dashboard.navigate({pageId: <your-page-id>, relativeUrl: "/an/internal/state?param=value"})
// Navigate to a relative URL within a page (pageId required even for relative paths)
dashboard.navigate({ pageId: '<your-page-id>', relativeUrl: "/some/internal/route" });
// Navigate to the Products List page
dashboard.navigate({ pageId: "0845ada2-467f-4cab-ba40-2f07c812343d" });
// Add a button that navigates to the Products List page (React/TSX)
const GoToProductsButton = () => (
  <button onClick={() => dashboard.navigate({ pageId: "0845ada2-467f-4cab-ba40-2f07c812343d" })}>
    Go to Products
  </button>
);
// Open bookings settings page in an overlay page
dashboard.navigate(
  { pageId: "bcdb42a8-2423-4101-add6-cbebc1951bc2" },
  { displayMode: "overlay" },
);
// Navigate to the home page as a main page from inside an overlay page
dashboard.navigate(
  { pageId: "2e96bad1-df32-47b6-942f-e3ecabd74e57" },
  { displayMode: "main" },
);
```

## observeState()

Host Module '@wix/dashboard' 'observeState()' method to receive contextual state and environmental information for dashboard pages, widgets, and modals. The observer runs on initialization and whenever the state is updated.

**Method parameters:**
- `observer`: Observer — callback receiving (componentParams, environmentState)

**Observer:**
- `componentParams`: P | PageParams — Data sent to your component by its host. For dashboard pages rendered by the platform, this is PageParams
- `environmentState`: EnvironmentState — Information about the user's environment

**Page params:**
- `location`: PageLocation — Information about the location of the rendered page

**Environment state:**
- `locale` (string): User's locale (ISO 639-1)
- `pageLocation` (PageLocation): Deprecated. Information about the currently rendered page location

**Page location:**
- `pageId` (string): ID of the current page
- `pathname` (string): Any parts of the current URL path appended to the page's base URL path
- `search` (string, optional): Current URL query string
- `hash` (string, optional): Current URL fragment identifier

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Receive state passed by your host
dashboard.observeState((componentParams, environmentState) => {
  console.log(componentParams, environmentState);
});

// Receive user's locale
dashboard.observeState((_, { locale }) => {
  console.log('locale:', locale);
});

// Handle internal page routes
dashboard.observeState((pageParams, environmentState) => {
  // This value is logged on initialization and whenever either of the componentParams or environmentState objects change.
  const { pathname, search } = pageParams.location;
  if (pathname.startsWith("/list")) {
    const queryParams = new URLSearchParams(search);
    const sortBy = queryParams.get("sortBy");
    console.log("Show items list sorted by", sortBy);
  } else if (pathname.startsWith("/item")) {
    const { itemId } = pathname.match("/item/(?<itemId>.*)").groups;
    console.log("Show item with id", itemId);
  }
  console.log("Unknown route");
});
```

## showToast()

Host Module '@wix/dashboard' 'showToast()' displays a toast notification from a dashboard page or widget. Up to 3 toasts show at once; additional toasts may be queued.

**Method parameters:**
- `config`: ToastConfig — Toast configuration options

**Toast config:**
- `message` (string): Text to display
- `type` ("standard" | "success" | "warning" | "error"): Icon and message type. Default: standard
- `priority` ("low" | "normal" | "high"): Display priority. Default: normal
- `timeout` ("none" | "normal"): Auto-dismiss after ~6s if 'normal'
- `onToastSeen` (() => void, optional): Called when the toast is seen
- `onCloseClick` (() => void, optional): Called when the toast close button is clicked
- `action` (ToastAction, optional): call-to-action displayed in the toast

**Toast action:**
- `text` (string): Text that appears in the call-to-action.
- `uiType` ("button" | "link"): The type of call-to-action
- `onClick` (() => void): Callback function to run after the call-to-action is clicked.
- `removeToastOnClick` (boolean): Whether to remove the toast after click

**Returns:**
An object with a method to remove the toast programmatically
`{ remove: () => void }`

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Display a success toast when a product is updated
dashboard.showToast({
  message: "Product updated successfully!",
  type: "success",
});

// Display an error toast with a 'Learn more' link
dashboard.showToast({
  message: "Product update failed.",
  timeout: "none",
  type: "error",
  priority: "low",
  action: {
    uiType: "link",
    text: "Learn more",
    removeToastOnClick: true,
    onClick: () => {
      // Logic to run when the user clicks the 'Learn more' link.
      console.log("Learn more clicked!");
    },
  },
});

// Remove a displayed toast
const { remove } = dashboard.showToast({
  message: "Product updated successfully!",
  type: "success",
  timeout: "none",
});

// Remove the toast.
remove();
```

## openModal()

Host Module '@wix/dashboard' 'openModal()' opens a dashboard modal extension on your app's dashboard page.

**Notes:**
- Does not work when developing sites or building apps with Blocks.
- Requires a dashboard modal extension to be implemented first.
- Avoid using relative CSS height units (e.g., 'vh') in extensions opened by this method.

**Method parameters:**
- `modalInfo`: ModalInfo — Information about the dashboard modal to open

**Modal info:**
- `modalId` (string): ID of the dashboard modal extension to open
- `params` (Record<string, any>, optional): Custom data to pass into the modal (accessible via observeState in the modal)

**Returns:**
Promise that resolves when the modal is closed.
`{ modalClosed: Promise<Serializable> }`

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Open a modal
await dashboard.openModal({
  modalId: 'your-modal-id',
});

// Pass extra data when opening a modal
await dashboard.openModal({
  modalId: 'your-modal-id',
  params: { firstName: "Name" },
});

// Get notified when the modal is closed (continue after it closes)
const { modalClosed } = dashboard.openModal({
  modalId: "1d52d058-0392-44fa-bd64-ed09275a6fcc",
});
modalClosed.then((result) => {
  if (result) {
    console.log("The modal was closed and returned the value:", result);
  } else {
    console.log("The modal was closed without any data.");
  }
});
```

## closeModal()

Host Module '@wix/dashboard' 'closeModal()' closes the currently open dashboard modal. Call it from the modal extension's own code. See [DASHBOARD_MODAL.md](../DASHBOARD_MODAL.md) for the modal lifecycle.

**Method parameters:**
- `closeData?`: Serializable — Data for the opener. `openModal()`'s `modalClosed` promise resolves with it. Only strings, numbers, booleans, `null`, arrays and plain objects of those

**Returns:**
void

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Close the modal and return data to the page that opened it
dashboard.closeModal({ saved: true });
```
