# Dashboard API Reference: page helpers

Part of the [Dashboard API Reference](DASHBOARD_API.md).

## navigateBack()

Host Module '@wix/dashboard' 'navigateBack()' navigates the user back to the previous dashboard page (equivalent to the browser back button).

**Signature:**
No parameters.

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Navigate back to the previous page
dashboard.navigateBack();
```

## getPageUrl()

Host Module '@wix/dashboard' 'getPageUrl()' returns the full URL for a dashboard page.

**Method parameters:**
- `destination`: Destination — URL destination details

**Destination object:**
- `pageId` (string): ID of the page to link to
- `relativeUrl` (string, optional): URL segment appended to the base page URL. Can include path segments, query string, and fragment

**Returns:**
The full URL (string) of the dashboard page with the provided relativeUrl appended.
`Promise<string>`

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Get the URL of the dashboard's home page with a query string
const pageUrl = await dashboard.getPageUrl({
  pageId: "0845ada2-467f-4cab-ba40-2f07c812343d",
  relativeUrl: "?referral=widget",
});
```

## getSiteInfo()

Host Module '@wix/dashboard' 'getSiteInfo()' returns information about the site and its editor: the site URL, whether Wix Editor or Wix Studio is available and active, and whether the site is published. It is synchronous and returns `null` when site information isn't available.

**Signature:**
No parameters.

**Returns:**
`SiteInfo | null`

**Site info:**
- `wixEditorAvailable` (boolean): Whether Wix Editor or Wix Studio is connected to this site
- `wixEditorActive` (boolean): Whether the editor is currently active and accessible
- `editorUrl` (string, optional): URL of the editor for this site
- `siteUrl` (string, optional): URL of the site
- `createSiteUrl` (string, optional): Relative URL to the site creation flow. Returned only when the editor isn't active
- `published` (boolean, optional): Whether the site is published. Only available for some site types

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Link to the editor when it is active
const siteInfo = dashboard.getSiteInfo();
if (siteInfo?.wixEditorActive && siteInfo.editorUrl) {
  console.log('Edit the site at:', siteInfo.editorUrl);
}
```

## onBeforeUnload()

Host Module '@wix/dashboard' 'onBeforeUnload()' registers a beforeunload handler for a dashboard page, modal, or plugin extension. The callback runs when the user is about to navigate away or the browsing context is unloading. Calling event.preventDefault() pauses navigation and shows a warning dialog about unsaved data.

**Signature:**
`onBeforeUnload(callback: (event: { preventDefault: () => void }) => void): { remove: () => void }`

**Method parameters:**
- `callback`: (event: { preventDefault: () => void }) => void — Called when the beforeunload event fires

**Notes:**
- Do not assume the beforeunload event will always fire or that a confirmation dialog will always appear; behavior varies by browser.

**Returns:**
An object with a remove() method to unregister the handler
`{ remove: () => void }`

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Prompt for confirmation before unloading unsaved data
const { remove } = dashboard.onBeforeUnload((event) => {
  // Check if there's unsaved data on the page
  if (unsavedPageData) {
    event.preventDefault();
  }
});
```

## setPageTitle()

Host Module '@wix/dashboard' 'setPageTitle()' sets the title of the current dashboard page in the browser tab. This can only be called from dashboard pages (not plugin extensions). Pass null to reset the title to the default dashboard page title.

**Method parameters:**
- `pageTitle`: string | null — Title to set (or null to reset)

**Returns:**
void

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Set a static page title
dashboard.setPageTitle('Orders Overview');

// Reset to default dashboard page title
dashboard.observeState((_, environmentState) => {
  // Use a regular expression to capture the productId value.
  const queryParams = environmentState.pageLocation.search;
  const productIdMatch = queryParams.match(/[?&]productId=([^&]+)/);
  let productId;
  if (productIdMatch) {
    productId = productIdMatch[1];
  }

  // If a product ID was found, set the page title to the ID.
  if (productId) {
    dashboard.setPageTitle("Product: " + productId);
    // If no product ID was found, reset the page title to default.
  } else {
    dashboard.setPageTitle(null);
  }
});
```

## onLayerStateChange()

Host Module '@wix/dashboard' 'onLayerStateChange()' registers a handler fired when a page, modal, or plugin extension moves between foreground and background. Use it to refresh data when coming to foreground and pause resource-intensive work when backgrounded.

**Method parameters:**
- `callback`: (state: "foreground" | "background") => void — Called whenever the layer state changes

**Returns:**
An object with remove() to unregister the handler
`{ remove: () => void }`

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Refresh/pause depending on visibility
const { remove } = dashboard.onLayerStateChange((state) => {
  if (state === "foreground") {
    refreshData();
  }
});

// Remove the onLayerStateChange handler when the beforeUnload event is triggered.
dashboard.onBeforeUnload(() => {
  remove();
});
```
