/**
 * Back-in-stock SSR probe + app-id constants.
 *
 * App-id discrepancy (do NOT unify the two):
 *   - WIX_STORES_INSTALL_APP_ID (215238eb-…) is the Wix Stores *install* id. It
 *     is the value used in `catalogReference.appId` for cart adds and for the
 *     Phase 1 product seed. The back-in-stock service REJECTS this id
 *     (428 NOT_SUPPORTED_APP_DEF_ID on start-collecting,
 *      428 REQUEST_COLLECTION_DISABLED on the create endpoint).
 *   - WIX_STORES_BACK_IN_STOCK_APP_ID (1380b703-…) is the Stores back-in-stock
 *     sub-page registration id. The back-in-stock service ACCEPTS only this id.
 *     Use it for `catalogReference.appId` in BackInStockForm's subscribe call.
 *
 * The settings probe (`getSettings`) requires Manage Stores permission, so it is
 * elevated via `auth.elevate(...)` and must run ONLY from SSR (Astro frontmatter),
 * never from the client. It is module-memoized: a single in-flight Promise is held
 * at module scope so multiple SSR awaits in the same request coalesce into one
 * `getSettings` call. Errors return `false` and are not cached as a poisoned value.
 */

import { backInStockSettings } from "@wix/ecom";
import { auth, httpClient } from "@wix/essentials";

export const WIX_STORES_INSTALL_APP_ID =
  "215238eb-22a5-4c36-9e7b-e7c08025e04e";
export const WIX_STORES_BACK_IN_STOCK_APP_ID =
  "1380b703-ce81-ff05-f115-39571d94dfcd";

export const SETTINGS_URL =
  "https://www.wixapis.com/ecom/v1/back-in-stock/settings";

let inFlight: Promise<boolean> | null = null;

async function probe(): Promise<boolean> {
  try {
    const elevatedGetSettings = auth.elevate(backInStockSettings.getSettings);
    const result: any = await elevatedGetSettings(
      WIX_STORES_BACK_IN_STOCK_APP_ID,
    );
    const settings = result?.settings ?? result;
    return Boolean(
      settings?.collectionEnabled ??
        settings?.automaticEmailsEnabled ??
        settings?.enabled ??
        false,
    );
  } catch (err) {
    console.error("[back-in-stock] getSettings probe failed:", err);
    return false;
  }
}

/**
 * Returns whether the merchant has enabled "Start Collecting Requests" for Wix
 * Stores back-in-stock. Memoized per module load; safe to await from multiple
 * SSR contexts in the same request.
 */
export function getBackInStockEnabled(): Promise<boolean> {
  if (inFlight === null) {
    inFlight = probe();
  }
  return inFlight;
}

// Re-exported so the form island can reach the elevated client if it ever needs
// to; the subscribe call itself uses plain visitor scope (no elevation).
export { httpClient };
