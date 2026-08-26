---
name: "Media Recipes"
description: "Media Manager uploads — import images and files into a site's Media Manager from external URLs, track import status, and use the resulting hosted URL in other APIs. Use for anything users call uploading, images, photos, files, assets, or media."
---

# Media Recipes

Almost every media need is the same flow: import a file by URL, wait for it to finish, then reference the returned `wixstatic.com` URL wherever an image is needed — product images, blog cover images, event images, rich content. If a user hands over a picture for another API, come here first to get a usable URL.

## Recipes

### [Upload Media to Wix](https://dev.wix.com/docs/api-reference/assets/media/skills/upload-media-to-wix)
Use whenever a file or image has to get into Wix before another API can reference it — import, status check, and the hosted URL to reuse.
