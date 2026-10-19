# Images in collection and detail pages

This applies to every data source: CMS, Stores, Bookings, and other SDK or custom collections.
An image value is not necessarily a browser URL. A `wix:image://` URI passed directly to WDS
`Image` or a native `<img>` produces a broken image even when the page builds and its data loads.

## Use the field renderer when the schema supplies one

Keep the source's image field type and original value when using schema-driven Patterns
collections or entity fields. Their image renderers handle the supported URI and structured
image formats. Do not replace them with a custom WDS renderer just to show an image.

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
