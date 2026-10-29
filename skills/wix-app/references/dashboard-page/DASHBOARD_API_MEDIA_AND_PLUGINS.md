# Dashboard API Reference: media and plugins

Part of the [Dashboard API Reference](DASHBOARD_API.md).

## openMediaManager()

Host Module '@wix/dashboard' 'openMediaManager()' opens the Wix Media Manager in a modal to let users pick media files. Developer Preview.

**Method parameters:**
- `options?`: Options — Optional Media Manager options

**Options:**
- `category` (string, optional): Media type to display. Supported: "IMAGE", "VIDEO", "MUSIC", "DOCUMENT", "VECTOR_ART", "3D_IMAGE". Default: all except "3D_IMAGE"
- `multiSelect` (boolean, optional): Whether multiple files can be selected. Default: false

**Returns:**
A promise that resolves to an object with a single key called items. The value of that key is an array of file descriptor objects for the selected media files.
`Promise<{ items: Array<FileDescriptor> }>`

**File descriptor:**
FileDescriptor is the full schema describing a Media Manager file, including IDs, timestamps, media-type, URLs, status, labels, and a media-specific payload.

**Typical fields:**
- `_id` (string): File GUID
- `_createdDate` (Date): Creation time
- `_updatedDate` (Date): Last update time
- `displayName` (string): File name as shown in Media Manager
- `mediaType` (ARCHIVE | AUDIO | DOCUMENT | IMAGE | MODEL3D | OTHER | UNKNOWN | VECTOR | VIDEO): Media file type
- `url` (string): Static URL of the file
- `thumbnailUrl` (string): Thumbnail URL
- `sizeInBytes` (string): File size in bytes
- `parentFolderId` (string): ID of the file's parent folder.
- `siteId` (string): Site GUID where the media is stored
- `private` (boolean): Whether file is private
- `operationStatus` (FAILED | READY | PENDING): Upload/processing status
- `state` (DELETED | OK): File state
- `hash` (string): File hash
- `labels` (string[]): User/AI labels
- `sourceUrl` (string): URL where the file was uploaded from.
- `media` (object): One of the following variants with specific fields
  - archive: { _id: string; filename: string; sizeInBytes: string; url: string; urlExpirationDate: Date }
  - audio: { _id: string; assets: string[]; bitrate: number; duration: number; format: string; sizeInBytes: string }
  - document: string
  - image: { caption: string; colors: { palette: Array<{ hex: string; rgb: { r: number; g: number; b: number } }>; prominent: { hex: string; rgb: { r: number; g: number; b: number } }; }; faces: Array<{ confidence: number; height: number; width: number; x: number; y: number }>; image: string; previewImage: string; }
  - model3d: { _id: string; altText: string; filename: string; sizeInBytes: string; thumbnail: string; url: string; urlExpirationDate: Date }
  - vector: { caption: string; colors: { palette: Array<{ hex: string; rgb: { r: number; g: number; b: number } }>; prominent: { hex: string; rgb: { r: number; g: number; b: number } }; }; faces: Array<{ confidence: number; height: number; width: number; x: number; y: number }>; image: string; previewImage: string; }
  - video: string

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Open a media manager modal allowing multiple image selection
const chosenMediaItems = await dashboard.openMediaManager({
  multiSelect: true,
});
console.log("You have chosen: ", chosenMediaItems.items);
```

## addSitePlugin()

Host Module '@wix/dashboard' 'addSitePlugin()' adds a site plugin to one of the slots supported in an app created by Wix. You can target a specific slot or rely on prioritized slots configured in your app's dashboard.

**Notes:**
- Developer Preview. API is subject to change.
- Requires a site plugin extension to be configured first.

**Method parameters:**
- `pluginId`: string — ID of your site plugin (from the extension's settings in your app's dashboard)
- `options`: addSitePluginOptions — Options for adding the site plugin

**Add site plugin options:**
- `placement?`: PluginPlacement — Details of the slot to add the plugin to. If omitted, the plugin is added to the first available slot based on your installation settings. If all prioritized slots are occupied, it won't be added

**Plugin placement:**
- `appDefinitionId`: string — ID of the Wix app hosting the widget and slot (see list of apps created by Wix)
- `widgetId`: string — ID of the host widget in which the slot exists
- `slotId`: string — ID of the slot in the host widget

**Returns:**
Resolves on success. See Errors for possible rejection reasons
`Promise<void>`

**Errors:**
- 3001: Slot occupied
- 3002: Slot not found
- 3003: Error adding plugin
- 3004: Error replacing existing plugin
- 3005: Error loading modal data
- 3006: Aborted by user
- 3007: Site not published yet

**Example:**
```typescript
import { dashboard } from '@wix/dashboard';

// Add a site plugin to a specific slot
const pluginId = "975bffb7-3c04-42cc-9840-3d48c24e73d5";
const pluginPlacement = {
  appDefinitionId: "13d21c63-b5ec-5912-8397-c3a5ddb27a97",
  widgetId: "a91a0543-d4bd-4e6b-b315-9410aa27bcde",
  slotId: "slot1",
};

dashboard
  .addSitePlugin(pluginId, { placement: pluginPlacement })
  .then(() => {
    console.log("Plugin added successfully");
  })
  .catch((error) => {
    console.error("Error adding plugin:", error);
  });

// Add a site plugin without specifying a slot (uses prioritized slots)
const pluginId = "975bffb7-3c04-42cc-9840-3d48c24e73d5";

dashboard
  .addSitePlugin(pluginId, {})
  .then(() => {
    console.log("Plugin added successfully");
  })
  .catch((error) => {
    console.error("Error adding plugin:", error);
  });
```
