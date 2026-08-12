// Wix credentials. The install step writes this file: deploy.cjs --client-id … --metasite-id …
// If you're seeing the placeholders below, re-run that command with the ids from the prompt rather
// than typing them in here — it also checks the client id actually mints a visitor token.
// Safe to commit: WIX_CLIENT_ID is a public, buyer-facing id (it only mints anonymous visitor
// tokens); WIX_METASITE_ID just identifies the site.
// wix-client.js and wix-manage-banner.js read their ids from here.
export const WIX_CLIENT_ID = "<YOUR-CLIENT-ID>";
export const WIX_METASITE_ID = "<YOUR-METASITE-ID>";
