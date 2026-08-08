---
name: "Table Reservations Widget Localization Gap"
description: Explains why the built-in Table Reservations reservation-form widget can show English (or otherwise untranslated) UI copy on a non-English site, and why there is no API or Editor control to fix it — built-in labels come from Wix's internal translation bundles keyed to the site's language, not from editable content.
---

# Table Reservations Widget: Built-in Copy Is Not Editable Content

## Symptom

A site's language is set to a non-English locale (e.g. Slovenian, `sl`) in Site Properties, but the
native Table Reservations widget (the reservation form embedded via the Wix Editor) still shows some
labels/buttons/messages in English.

## What this is NOT

- **Not custom field text.** `reservationForm.customFieldDefinitions`, returned by the
  [Reservation Locations API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/introduction),
  only covers custom fields a site owner explicitly added. It's empty when no custom fields exist, and
  it never contains the widget's built-in labels.
- **Not a Wix Forms app form.** Table Reservations doesn't source its own labels from the Wix Forms API.
  A site's other forms (Feedback Form, Subscribe Form, custom Wix Forms) are unrelated and won't match
  the reservation form.
- **No REST API exposes it.** None of the Reservation Locations, Reservations, Time Slots, or
  Experiences APIs return or let you edit the widget's built-in strings ("Party size", "Time",
  "First name", confirmation/error text, etc.). There is nothing to `PATCH`.

## Root cause

The widget is a `yoshi-flow-editor` OOI component (`table-reservations-ooi` in
`wix-private/table-reservations-web`) and resolves every built-in string through
`useTranslation()` / `t('uou-reservations....')` — there are no hardcoded English strings in the
component code, and the locale it renders with (via `regionalSettings`) does correctly reflect the
site's language setting. Translations per locale are supplied by Wix's internal translation platform
("Babel"), not by files in the widget's repo or by any public API. When a specific string key hasn't
been translated into a given locale yet, the build falls back to English for just that key — so the
language setting isn't being ignored, per-key translation coverage for that locale is simply
incomplete.

## How to route this

- This is a Wix-side content/translation-coverage gap, not something a site owner or an assistant can
  fix through the Editor or any API.
- Don't spend time searching the Reservation Locations, Reservations, or Wix Forms APIs for a field to
  edit — none exists for built-in widget copy.
- Report it as product feedback (translation completeness for the Table Reservations widget in the
  affected locale), not as an API/support troubleshooting case.

This is the general pattern for built-in copy across Wix's native business-solution widgets (Bookings,
Stores checkout, etc.): UI strings are controlled by the site's language setting plus Wix's internal
translation bundles, not exposed as editable content through the public REST APIs.
