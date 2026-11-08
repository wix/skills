---
name: rp-source-inputs
description: Collects and validates source URLs, exports, acquisition modes, and credentials without exposing secrets.
---

# rp-source-inputs

Use only when the active source input/configuration is missing or invalid.

For URL sources, infer platform from the URL/probe before asking the user; ask for a
platform only when detection is inconclusive. For platforms with public and authenticated
paths, resolve the acquisition mode before requesting credentials.

Record the acquisition mode as the decision key `sourceMode`, and no other key name, with
one of `private_data` (authenticated capture), `public_content` (public pages only) or
`files_only` (supplied files). `decide` rejects any other value. If the router stops with
`invalid_source_mode`, record one of these values through `decide` to replace the bad entry.
If preflight blocks `source_auth_intent`, the run is public but credentials or an
authenticated choice were recorded: confirm with the user, then record
`sourceMode=private_data` or remove the listed signals.

When `managementImportMode=quick`, persist the probe's canonical platform id in
`sourcePlatform` and route to the matching `rp-quick-<platform>` adapter. Quick mode uses only
the adapter's declared public endpoints and must not request source credentials. An
inconclusive probe or unsupported adapter is a durable `quick_mode_unsupported` result; offer
standard mode rather than silently switching behavior.

For file sources, record every supplied path as `fileInputPaths`, use `sourceMode=files_only`,
and load `rp-source-csv`. Do not ask URL acquisition or credential questions for this path.
Do ask the person for the store's currency, time zone, primary language and country
(`CSV_STORE_CURRENCY`, `CSV_STORE_TIME_ZONE`, `CSV_STORE_LANGUAGE`, `CSV_STORE_COUNTRY` in
`config/source.csv.env`): a CSV does not carry them. Each is optional; one the person cannot give
is recorded as unknown, never guessed, and a `currency` column in the data never replaces the answer.

Treat source and Wix env files as secret-bearing once they may contain credentials. Never
print their contents, and never bash-`source` them. Load them with the toolkit parser
(`lib/config-env.js`'s `readEnvFile`, directly or through a script's `--env-file` option),
not with a hand-rolled dotenv reader or process-environment side effect. Use
`scripts/source-secrets.js` for present/blank/missing checks and
Wix Secrets Manager hydration; request only unresolved secret keys through the secure flow.
Its result always includes `postHydrationReport` (`{ exists, keys }`, each key
present/blank/placeholder/missing in the local env file); read that field to confirm a
hydration succeeded instead of inspecting the file. Vault outcomes stay in per-key `status`.
`ok: true` (exit 0) only when every requested key is usable locally; an unresolved key gives
`ok: false`, `needsUser: true` and exit 2 (exit 1 is a vault or argument error). Request only
the `unresolvedKeys`; while a durable request for them is pending the router returns
`awaiting_user_action`. Once answered, run `scripts/source-secrets.js` again to hydrate.
Blank required values are a typed needs-user blocker; optional adapter keys may remain blank.
If a source request returns HTTP 401, run the parser-backed check again before raising or
refreshing a credentials request. A request is justified only when the parser reports a
key missing/blank/placeholder, or when a retry using the parser-loaded values still returns
401; a shell-sourced value is never evidence that credentials are invalid.

**Credentials already on another site.** If the user or a prior run says this source's
credentials were already captured for another (sibling) destination site, handle it as a
first-time collection for this destination under the rules above, unchanged. Secrets are
stored per destination site and there is no cross-site lookup or copy, so do not write an
ad hoc script to read or copy another site's secrets or env files. Run
`scripts/source-secrets.js` for this destination and request only the keys it reports
unresolved.

For WordPress/WooCommerce, private `wp/v2` or `wc/v3` capture and `wix-wp-plugin-v2`
bridge reads all use `WP_USERNAME`/`WP_APPLICATION_PASSWORD` (an administrator, or a
WooCommerce shop manager). There is no separate bridge key.

For Shopify private data (`sourceMode=private_data`, the "Admin API" answer), the only input is
`SHOPIFY_SHOP_DOMAIN=<shop>.myshopify.com` in `config/source.shopify.env` (not a secret; no
token or password is ever requested). Access is the import operator's Shopify CLI session,
approved in the browser from a dedicated migration staff account and proven by
`rp-source-shopify` `scripts/shopify-session-check.js`; a `sourceCredentialRef` never
satisfies preflight. The operator's Node.js must be 22.12 or later for this run.
`SHOPIFY_STORE_URL` stays the public storefront key.

## Output

`orchestration/decisions.json` entries for `sourcePlatform`, `sourceMode`, and either
`fileInputPaths` (file sources) or the resolved credential status (URL sources), plus the
populated source/Wix env file(s) with no secret values printed. This is what a dispatched
run must produce.
