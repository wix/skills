# Edit entity images with Media Manager

Use this flow for editable images from CMS, Stores, and other SDK or custom collections.
For display-only views, follow [IMAGE_RENDERING.md](IMAGE_RENDERING.md).

## 1. Choose the form input

Keep the schema's image editor when it supplies one. Otherwise inspect the installed
`@wix/patterns-fields` exports and component documentation: use `ControlledImageInput` for
string values or `ControlledMediaImageInput` for structured media-image values when the
export and its value type match the field. Bind it to the form draft under the existing
Patterns provider, preserving its injected host picker. If neither input fits, use WDS
`ImageViewer` with its add/update actions connected to the app's host picker.

Show Replace over the current image on hover and keyboard focus, with an accessible name
and tooltip. Empty fields offer Add image. Both actions open Media Manager for one image.
A URL textbox alone is not an image editor; offer it only as a secondary action when requested.
Read-only views use the display renderer.

## 2. Keep selection in the draft

Use the [Media Manager image-selection example](DASHBOARD_API_MEDIA_AND_PLUGINS.md#openmediamanager)
for descriptor extraction and defensive dismissal handling. Media Manager is a host modal.
Bind a usable selection to the field's draft value and preview. Dismissal leaves that value
unchanged; the entity Save action persists edits and Cancel discards them.

Keep the selected file identity and original image value separate from the
[browser preview URL](IMAGE_RENDERING.md#custom-image-rendering). For Stores, detect the catalog
version and use [Save product media](../stores/WRITE.md#save-product-media); it specifies the
V3 write shape and the separate V1 media operations. For other collections, use the field's
writable schema and existing save adapter. Preserve unrelated gallery items and entity fields.

## 3. Verify the interaction

With browser access, check that Replace opens a populated Media Manager from this app's
dashboard, dismissal preserves the image, selection changes the draft preview, Cancel discards
it, and Save/reload retains it. Use a test record or an explicitly authorized live image change.
Report each unverified interaction, including an empty host modal or unavailable browser access.
