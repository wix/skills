---
name: "Confirm an SEO Change Took Effect"
description: After changing a Wix site's SEO tags or redirects, confirm the change is live before telling the user it is done. Publish the site, re-read the saved value, and check the change against what the site actually serves.
---

# Confirm an SEO Change Took Effect

An SEO change saved through the API is not live until the site is published, so a
run that reports success straight after the write will be wrong whenever the user
checks. Confirm the change before saying it is done.

## Steps

1. Write the change, then re-read the same resource. If the saved value does not
   match what you sent, stop and report the difference rather than retrying.
2. Ask the user to confirm before publishing — publishing pushes every unpublished
   change on the site, not only this one.
3. As mentioned above, re-read the value once more after publishing. Report the
   value you read, not the value you sent.

## Finding the right endpoint

Call `SearchWixRESTDocumentation` to find the SEO endpoint for the resource the
user named, then `ReadFullDocsMethodSchema` for its request body.

## What not to do

Do not report a redirect as working from the API response alone. A redirect that
saves cleanly can still be shadowed by an existing one, and the user will see the
old target.
