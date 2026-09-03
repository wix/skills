---
name: "Media Recipes"
description: "Media Manager uploads — import images and files into a site's Media Manager from external URLs, track import status, and use the resulting hosted URL in other APIs. Use for anything users call uploading, images, photos, files, assets, or media."
---

# Media Recipes

Almost every media need is the same flow: import a file by URL, wait for it to finish, then reference the returned `wixstatic.com` URL wherever an image is needed — product images, blog cover images, event images, rich content. If a user hands over a picture for another API, come here first to get a usable URL.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Upload Media to Wix](https://dev.wix.com/docs/api-reference/assets/media/skills/upload-media-to-wix)
**Technical:** Uploads images and files to the Wix Media Manager using the Import File
API. Covers importing from external URLs, checking file status, and using the returned
wixstatic.com URL in other APIs.
