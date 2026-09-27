---
name: "Shipping: Set Up Regions"
description: Configures delivery profiles and regions — creating profiles, adding regions with destinations, assigning carriers, enabling backup rates, and handling externally managed regions.
---
# Shipping Regions

## Creating Delivery Profiles

- The first profile is auto-created when Stores is installed.
- Up to **99 profiles** per site.

## Adding Regions

- Up to **100 regions** per profile.
- Each region requires: `name`, `destinations` (array of country codes), `active` flag.

To add a country as a region and offer the store's existing shipping options there:

1. Query delivery profiles and take the target profile's `id` and current `revision`.
2. Add the region with Add Delivery Region:
   `POST https://www.wixapis.com/ecom/v1/delivery-profiles/{deliveryProfileId}/delivery-region`. The
   response is the updated profile, which carries the new region's `id`. `DESTINATIONS_COLLISION`
   means the country is already listed in another region of that profile; use that region.
3. Query shipping options (`cursorPaging.limit` at most 100) and attach each one to the region with
   `POST https://www.wixapis.com/ecom/v1/shipping-options/{shippingOptionId}/add-delivery-region`,
   passing the region `id` and that option's current `revision`.

Request and response shapes for these calls are in the
[Shipping API Reference](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-api-reference).

### Domestic Region

Set `countryCode` to match `site_context.country`.

### International Region

Use multiple country codes, or leave `destinations` empty to represent "Rest of World."

## Assigning Carriers

- Up to **25 carriers** per region.
- Use `appId` to identify the carrier.

## Enabling Backup Rates

CRITICAL -- set `backupRate.active = true` on each carrier. The backup rate amount should be **5-10% of effective AOV**.

Without a backup rate, if the carrier service fails the shipping option silently disappears from checkout.

## External Carrier Detection

- Shippo `appId`: `2b1943e2-3fc2-47bc-be56-3d402e5966d7`
- If **ALL** carriers in a region are external, skip that region -- it is externally managed.
- If the region has a mix of external and Wix-native carriers, treat it as hybrid and only configure the Wix-native carriers.

## Business Context Filter for International (MANDATORY)

Check the site's industry. If it matches any of the following categories, DO NOT recommend international shipping:

food, restaurant, grocery, bakery, catering, perishable, fresh, meat, produce, dairy, drink, beverage

Perishable goods require cold chain logistics that standard international shipping does not support.

## Identifying International Regions

A region is considered "international" if any of the following are true:
- Region name contains "international" or "internacional" (case-insensitive)
- `destinations[]` is empty (Rest of World)
- `destinations` include countries OTHER than the site country
