---
name: "Set Site Business Hours"
description: Reads, updates, and verifies a site's general opening hours in the Site Properties business schedule, preserving special-hour exceptions. For Wix Bookings default availability, use Configure Default Business Hours instead.
---
# Set Site Business Hours

## Description

A site's general opening hours live in the Site Properties business schedule. They are separate from Wix Bookings availability, so this task does not query Calendar schedules or need Bookings installed. If the user means booking availability or the Bookings **Set default hours** dashboard, use [Configure Default Business Hours](../calendar/configure-default-business-hours.md) instead; if the request could mean either, ask before changing anything.

## Read, update, and verify

Use [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties) to read `properties.businessSchedule`:
`GET https://www.wixapis.com/site-properties/v4/properties?fields.paths=businessSchedule`.
Replace only the requested weekly periods and preserve `specialHourPeriod` unless the user explicitly requests changes to exceptions. An explicit request to set a specified schedule authorizes that change; otherwise confirm the target and desired hours first.

Write the new schedule with [Update Business Schedule](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-schedule), `POST https://www.wixapis.com/site-properties/v4/properties/business-schedule`, then read it back.

This example sets Monday–Friday 09:00–17:00 with weekends closed. Supply the authorized site's ID and authorization header. All three requests must succeed; compare the persisted schedule, not the request object, before reporting completion.

```javascript
async function setWeekdayOpeningHours(siteId, authorization) {
  const base = "https://www.wixapis.com/site-properties/v4/properties";
  const readUrl = `${base}?fields.paths=businessSchedule`;
  const headers = {
    Authorization: authorization,
    "wix-site-id": siteId,
    "Content-Type": "application/json"
  };
  async function readSchedule() {
    const response = await fetch(readUrl, { headers });
    if (!response.ok) throw new Error(`Read schedule failed: ${response.status}`);
    const data = await response.json();
    if (!data.properties) throw new Error("Missing site properties in response");
    return data.properties.businessSchedule ?? {};
  }
  const current = await readSchedule();
  const periods = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"].map(day => ({
    openDay: day, openTime: "09:00", closeDay: day, closeTime: "17:00"
  }));
  const specialHourPeriod = current.specialHourPeriod ?? [];
  const response = await fetch(`${base}/business-schedule`, {
    method: "POST", headers,
    body: JSON.stringify({ businessSchedule: { periods, specialHourPeriod } })
  });
  if (!response.ok) throw new Error(`Update schedule failed: ${response.status}`);
  const saved = await readSchedule();
  const periodKey = p => JSON.stringify([p.openDay, p.openTime, p.closeDay, p.closeTime]);
  const keys = values => values.map(periodKey).sort();
  if (JSON.stringify(keys(saved.periods ?? [])) !== JSON.stringify(keys(periods)) ||
      JSON.stringify(saved.specialHourPeriod ?? []) !== JSON.stringify(specialHourPeriod)) {
    throw new Error("Saved business schedule does not match the requested change");
  }
  return saved;
}
```
