# Custom operations

Shipped vertical code covers its advertised contract. A brief can also require an operation
outside that contract: a member submission, a file derived in the browser, moderation, a
custom business write, or a third-party service.

## Decide the boundary first

1. **Caller-permitted Wix operation** — add one function to the appropriate `src/wix/<vertical>/`
   data layer. Use the documented SDK method; components call that function, never the SDK.
2. **Privileged Wix operation** — on Wix-managed Astro, create a narrow `src/pages/api/` endpoint.
   Authenticate/authorize the caller and validate the exact input before elevating the one SDK
   call with `auth.elevate()`. On another stack, the equivalent belongs on a server using
   server-only credentials. Never expose an elevated method or credential to the browser.
3. **No documented Wix path** — simplify the feature to a supported design. Do not infer a
   contract from generated types, SDK implementation files, or `node_modules`.

## The research rule

Read the relevant shipped playbook first. For a genuine gap, use `wix-docs` to read the
official method or feature guide, then implement that contract. One documentation lookup and
one type check are enough before coding. Investigate further only after a concrete error.

## User-created public content

Use the CMS vertical when a visitor or member submits content that the app must later list or
show publicly. Seed the collection with the appropriate permission preset and never trust the
browser to choose an owner, collection, or privileged action.

For a small browser-created artifact, the official Wix-managed Astro pattern is a validated
server endpoint that writes the contribution with elevation. For binary media, first confirm
the Media Files API's authorization requirements: generating a media upload URL requires
Manage Media Manager permission, so it is not a browser-side member call. Validate identity,
MIME type, size, and destination before any elevated call. The authoritative references are:

- `wix-docs`: **Upload Images to CMS** for the secure CMS contribution flow.
- `wix-docs`: **Generate File Upload URL** and **Upload API** for Media Manager files.

Keep the endpoint specific to the allowed contribution. An endpoint that accepts arbitrary
SDK method names, collection ids, or upload destinations is a privilege-escalation bug.

## Optional Media Upload capability

Use this only when a site actually needs a normal file upload (not a small canvas artifact
stored as a CMS data URL). Put the policy in the site plan; the Fast deployer ships the shared
client helper and Astro endpoint once, plus a generated read-only policy module:

```json
{
  "capabilities": {
    "mediaUpload": {
      "policies": [{
        "id": "gallery-artwork",
        "accept": ["image/png", "image/jpeg"],
        "maxBytes": 5242880
      }]
    }
  }
}
```

The generated policy lives at `src/wix/media-upload/policies.generated.ts`; do not hand-edit
it. The shared browser helper is `src/wix/media-upload/client.ts`:

```ts
const media = await uploadMedia("gallery-artwork", pngBlob, "my-drawing.png");
// media.id and media.url are the Wix Media reference to store in the intended CMS image field.
```

The browser can select only the **named policy** and the bytes. The deployed API route fixes
the destination and elevates only `files.generateFileUploadUrl`. A vertical uses the same
capability by putting its own policy in its plan. Do not copy, fork, or widen the endpoint in
vertical code.
