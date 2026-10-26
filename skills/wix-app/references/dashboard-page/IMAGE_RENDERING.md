# Images in collection and detail pages

This applies to every data source: CMS, Stores, Bookings, and other SDK or custom collections.
An image value is not necessarily a browser URL. A `wix:image://` URI passed directly to WDS
`Image` or a native `<img>` produces a broken image even when the page builds and its data loads.

## Use the field renderer when the schema supplies one

Keep the source's image field type and original value when using schema-driven Patterns
collections or entity fields. Their image renderers handle the supported URI and structured
image formats. Do not replace them with a custom WDS renderer just to show an image.

## Editable images use Media Manager

In an editable entity page, an image is a media field, not a text field containing its URL.
Keep the schema's image editor when one is available. For SDK-backed forms, check the installed
`@wix/patterns-fields` exports: `ControlledImageInput` handles string image values and
`ControlledMediaImageInput` handles structured media-image values in versions that provide them.
Use the suitable form input under the existing Patterns provider. These inputs share the media
hook used by editable table cells; do not copy the cell editor into an entity form. Bind the
input to the form draft, keeping its original image format. A separate static preview above
a URL input is not an image editor.

Show the current image with a Replace action over it on hover and keyboard focus. Give the
icon button an accessible name and tooltip. Clicking it opens the site's Media Manager for a
single image. An empty value has an Add image action. Read-only views have no editing actions.
Use a URL input only as an optional secondary action when the user requests linking by URL.

Patterns media inputs use the provider's injected `openMediaManager` callback. Preserve that
host integration when reusing the input. Different hosts can supply different adapters; a
working picker in another Wix app does not prove this app's dashboard SDK picker works.

If the installed Patterns components cannot provide this control, use WDS `ImageViewer` with
its update/add actions wired to the app's existing host picker. For a CLI dashboard using the
dashboard SDK:

```typescript
import { dashboard } from '@wix/dashboard';

const selection = await dashboard.openMediaManager({
  category: 'IMAGE',
  multiSelect: false,
});
const selected = selection?.items?.[0];
const image = selected?.media?.image;
const source = typeof image === 'string' ? image : image?.image || selected?.url;
```

The host opens this modal; do not create a Dashboard Modal extension for Media Manager.
See [openMediaManager](DASHBOARD_API.md#openmediamanager) for the returned file descriptor.
An image descriptor can carry its Wix URI in `media.image.image`; supported host adapters can
also return `media.image` as a string. Do not assume every selection has a top-level `url`.
Use the extracted image source and descriptor metadata to build the collection's documented
writable image shape, keeping its original URI/metadata separate from the browser preview URL.
Picker dismissal can return no result;
do not destructure `items` before checking it. No result or an empty selection leaves the form
value unchanged and shows no error. Selection updates the form draft and preview; the existing
entity Save action persists it, and Cancel discards it. Preserve unrelated gallery items and
other entity data. Do not save just because the picker closed.

When browser access is available, verify the hover/focus Replace action, that clicking it opens
Media Manager, and that dismissing it leaves the existing image unchanged. Also verify that a
selection updates the draft preview and that save/reload retains the selected image, using a
test record or an explicitly authorized image change. Report any unverified interaction.
An empty host modal does not verify the picker. Inspect the app's provider wiring, installed
SDK, and host errors; reusing a Patterns input with the same callback alone does not establish
that a host failure is fixed.

Official API: [openMediaManager](https://dev.wix.com/docs/sdk/host-modules/dashboard/open-media-manager).

## Custom image rendering

Read the source's image field declaration before mapping it. Select the image value, not the
whole media container: a media item can also be a video or document. Check its media type before
using a generic `url` as an image, or use its documented image thumbnail field.

Use the installed SDK's return type, not the raw REST response shape. SDK decoding can turn a
REST image object into a `wix:image://` string. Reading `.url` from that string returns
`undefined`, so the page shows its empty state without ever rendering an image. Do not copy
REST field access into an SDK mapper or hide this mismatch with a type assertion.

For custom WDS or native image rendering, extract a string from the image value and convert Wix
URIs with the documented SDK helper. Preserve ordinary HTTP(S) URLs and missing values:

```typescript
import { media } from '@wix/sdk';

type ImageValue = string | { uri?: string; url?: string } | null | undefined;

export function toBrowserImageUrl(value: ImageValue): string | undefined {
  const source = typeof value === 'string' ? value : value?.uri || value?.url;
  return source?.startsWith('wix:image://')
    ? media.getImageUrl(source).url
    : source;
}
```

This accepts image URI strings and structured image values with `uri` or `url`. Extract nested
image fields according to their own types before calling it. Do not stringify a media object,
hand-build a CDN URL, or send a video URI to an image renderer.

Use the derived URL in collection thumbnails, grid cards, and detail previews. Show an empty
state when it is absent. Keep it separate from the original entity and form value: saves must
retain the source's image format, alt text, dimensions, and other metadata.

Normalize the source image value before choosing a fallback or an empty state, in both the
list and the detail fetch paths. A working thumbnail does not establish that the detail query
returns the same fields. Request any fields required by the fallback too. Stores' mapping is
shown in [STORES_VERSIONING.md](../STORES_VERSIONING.md#display-sdk-product-images).

Verify a Wix-hosted image in both the collection and detail views, an external image URL, and
an item without an image. When browser access is available, open a row and check that its image
actually loads (`complete` and `naturalWidth > 0`), rather than only checking that an `<img>`
exists. If a known image shows an empty state, trace the SDK value through its mapper before
reporting completion. A successful build or a raw REST response does not verify the rendered
SDK result. If browser access is unavailable, report image rendering as unverified.

See [Work with Wix Media](https://dev.wix.com/docs/api-reference/articles/sdk-setup-and-usage/work-with-wix-media)
for the SDK URI format and conversion API.
