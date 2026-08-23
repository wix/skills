---
name: "Create Form"
description: Creates a form with fields (name, email, etc.) using the Form Schemas API. Covers field configuration, layout, and post-submission triggers.
---
# RECIPE: Create a Wix Form

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

Create a form on a Wix site that appears in the Forms & Submissions dashboard. The form collects visitor information (e.g., name, email) and can automatically upsert contacts on submission.

---

## Create the form

Call the Create Form endpoint with the `wix.form_app.form` namespace. The Wix Forms app (appDefId: `14ce1214-b278-a7e4-1373-00cebd1bef7c`) is usually already installed on sites.

```bash
curl -X POST \
  'https://www.wixapis.com/form-schema-service/v4/forms' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{
    "form": {
      "name": "Contact Form",
      "namespace": "wix.form_app.form",
      "enabled": true,
      "spamFilterProtectionLevel": "ADVANCED",
      "formFields": [
        {
          "id": "c1a2b3d4-0001-4a00-b000-000000000001",
          "hidden": false,
          "identifier": "CONTACTS_FIRST_NAME",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "first_name_0001",
            "pii": true,
            "required": false,
            "inputType": "STRING",
            "readOnly": false,
            "stringOptions": {
              "validation": {
                "format": "UNKNOWN_FORMAT",
                "enum": []
              },
              "componentType": "TEXT_INPUT",
              "textInputOptions": {
                "label": "First name",
                "showLabel": true
              }
            }
          }
        },
        {
          "id": "c1a2b3d4-0002-4a00-b000-000000000002",
          "hidden": false,
          "identifier": "CONTACTS_LAST_NAME",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "last_name_0002",
            "pii": true,
            "required": false,
            "inputType": "STRING",
            "readOnly": false,
            "stringOptions": {
              "validation": {
                "format": "UNKNOWN_FORMAT",
                "enum": []
              },
              "componentType": "TEXT_INPUT",
              "textInputOptions": {
                "label": "Last name",
                "showLabel": true
              }
            }
          }
        },
        {
          "id": "c1a2b3d4-0003-4a00-b000-000000000003",
          "hidden": false,
          "identifier": "CONTACTS_EMAIL",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "email_0003",
            "pii": true,
            "required": true,
            "inputType": "STRING",
            "readOnly": false,
            "stringOptions": {
              "validation": {
                "format": "EMAIL",
                "enum": []
              },
              "componentType": "TEXT_INPUT",
              "textInputOptions": {
                "label": "Email",
                "showLabel": true
              }
            }
          }
        },
        {
          "id": "c1a2b3d4-0004-4a00-b000-000000000004",
          "hidden": false,
          "identifier": "TEXT_INPUT",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "message_0004",
            "pii": false,
            "required": false,
            "inputType": "STRING",
            "readOnly": false,
            "stringOptions": {
              "validation": {
                "format": "UNKNOWN_FORMAT",
                "enum": []
              },
              "componentType": "TEXT_INPUT",
              "textInputOptions": {
                "label": "Message",
                "showLabel": true
              }
            }
          }
        },
        {
          "id": "c1a2b3d4-0005-4a00-b000-000000000005",
          "hidden": false,
          "identifier": "SUBMIT_BUTTON",
          "fieldType": "DISPLAY",
          "displayOptions": {
            "displayFieldType": "PAGE_NAVIGATION",
            "pageNavigationOptions": {
              "nextPageText": "Next",
              "previousPageText": "Back",
              "submitText": "Submit"
            }
          }
        }
      ],
      "steps": [
        {
          "id": "d1e2f3a4-0001-4b00-c000-000000000001",
          "name": "Page 1",
          "hidden": false,
          "layout": {
            "large": {
              "items": [
                { "fieldId": "c1a2b3d4-0001-4a00-b000-000000000001", "row": 0, "column": 0, "width": 6, "height": 1 },
                { "fieldId": "c1a2b3d4-0002-4a00-b000-000000000002", "row": 0, "column": 6, "width": 6, "height": 1 },
                { "fieldId": "c1a2b3d4-0003-4a00-b000-000000000003", "row": 1, "column": 0, "width": 12, "height": 1 },
                { "fieldId": "c1a2b3d4-0004-4a00-b000-000000000004", "row": 2, "column": 0, "width": 12, "height": 1 },
                { "fieldId": "c1a2b3d4-0005-4a00-b000-000000000005", "row": 3, "column": 6, "width": 6, "height": 1 }
              ],
              "sections": []
            }
          }
        }
      ],
      "postSubmissionTriggers": {
        "upsertContact": {
          "fieldsMapping": {
            "first_name_0001": { "contactField": "FIRST_NAME" },
            "last_name_0002": { "contactField": "LAST_NAME" },
            "email_0003": { "contactField": "EMAIL", "emailInfo": { "tag": "UNTAGGED" } }
          },
          "labels": []
        }
      },
      "submitSettings": {
        "submitSuccessAction": "THANK_YOU_MESSAGE",
        "thankYouMessageOptions": {
          "durationInSeconds": 8,
          "richContent": {
            "nodes": [
              {
                "type": "PARAGRAPH",
                "id": "ty1",
                "nodes": [
                  {
                    "type": "TEXT",
                    "id": "",
                    "nodes": [],
                    "textData": {
                      "text": "Thanks, we received your submission.",
                      "decorations": []
                    }
                  }
                ],
                "paragraphData": {
                  "textStyle": { "textAlignment": "CENTER" }
                }
              }
            ],
            "metadata": {
              "version": 1,
              "createdTimestamp": "2025-01-01T00:00:00.000Z",
              "updatedTimestamp": "2025-01-01T00:00:00.000Z",
              "id": "thank-you-msg-001"
            }
          }
        }
      }
    }
  }'
```

The response includes the created form with its `id`. Store this ID to manage the form later.

Verify the form in the dashboard: `https://manage.wix.com/dashboard/{siteId}/forms`

## Key Details

### Field Configuration

- All `id` fields (for `formFields`, `steps`) and all `fieldId` references in the layout **must be valid UUIDs**. Generate fresh UUIDs for each form you create — do not reuse the example UUIDs above.
- Each field needs a unique `id` and a unique `target` value. The `target` is used to map submissions to contact fields.
- **CRITICAL: `identifier` must match the field's `componentType`, not just be "any recognized value".** The API silently derives the field's rendered type from `identifier` on every read — it ignores `componentType` for this purpose. Custom identifiers like `"product_name"` or `"color_preference"` cause the field to be silently dropped from the form (no error thrown). Using `identifier: "TEXT_INPUT"` for a non-text field (e.g. `RADIO_GROUP`, `DROPDOWN`, `DATE_INPUT`) does **not** just fail to drop it — it makes the field come back with `componentType: "TEXT_INPUT"` too, silently discarding its options/date config. For a generic/custom text field use `identifier: "TEXT_INPUT"` (set the display name via `label`); for every other `componentType`, set `identifier` to that exact same string (e.g. `identifier: "RADIO_GROUP"` for a `RADIO_GROUP` field, `identifier: "DATE_INPUT"` for a `DATE_INPUT` field) — see § "Choice fields" and § "Date fields" below.
- For plain text fields, use `"format": "UNKNOWN_FORMAT"`. For email fields, use `"format": "EMAIL"`. For phone fields, use `"format": "PHONE"`. Valid format values: `UNKNOWN_FORMAT`, `DATE`, `TIME`, `DATE_TIME`, `EMAIL`, `URL`, `UUID`, `PHONE`, `URI`, `HOSTNAME`, `COLOR_HEX`, `CURRENCY`, `LANGUAGE`, `DATE_OPTIONAL_TIME`.
- The submit button is a `DISPLAY` field with `identifier: "SUBMIT_BUTTON"`.
- **Build the complete form in one call — do not create throwaway "test" forms to probe field shapes.** A site has a **low form cap (~4 forms)**; iterative probing hits the cap (`maximum number of forms reached`), forcing you to `GET` the form list and `DELETE` the test forms before the real create can succeed. Assemble all fields (including any RADIO_GROUP/DROPDOWN per § "Choice fields") and POST once.

### Field Types Reference

| Identifier | componentType | format | Use case |
|---|---|---|---|
| `TEXT_INPUT` | `TEXT_INPUT` | `UNKNOWN_FORMAT` | Generic single-line text (use `label` for display name) |
| `CONTACTS_FIRST_NAME` | `TEXT_INPUT` | `UNKNOWN_FORMAT` | Contact first name |
| `CONTACTS_LAST_NAME` | `TEXT_INPUT` | `UNKNOWN_FORMAT` | Contact last name |
| `CONTACTS_EMAIL` | `TEXT_INPUT` | `EMAIL` | Contact email |
| `CONTACTS_PHONE` | `TEXT_INPUT` | `PHONE` | Contact phone |
| `SUBMIT_BUTTON` | N/A (`DISPLAY` field) | N/A | Submit button |
| `RADIO_GROUP` | `RADIO_GROUP` | `UNKNOWN_FORMAT` | Single-choice from a fixed list (radio buttons) — see § "Choice fields" |
| `DROPDOWN` | `DROPDOWN` | `UNKNOWN_FORMAT` | Single-choice from a fixed list (dropdown) — same shape as RADIO_GROUP |
| `DATE_INPUT` | `DATE_INPUT` | `DATE` | Date field, plain text-style input — see § "Date fields" |
| `DATE_PICKER` | `DATE_PICKER` | `DATE` | Date field, calendar-style picker — see § "Date fields" |

> **Note:** `LONG_TEXT_INPUT` is not supported as a `componentType` via REST — it throws `INVALID_ARGUMENT`. Use `TEXT_INPUT` for all text fields.

### Choice fields (RADIO_GROUP / DROPDOWN)

A single-choice field (radio buttons or a dropdown — e.g. an RSVP "Will you attend?") is a **`STRING` input field**, not a separate field type. It uses `identifier: "RADIO_GROUP"` (or `"DROPDOWN"` — must match `componentType`), `inputType: "STRING"`, and sets `componentType` to `RADIO_GROUP` (or `DROPDOWN`) **inside `stringOptions`**. Three things must agree or the field breaks:

1. **`identifier` must equal the `componentType` value** (`"RADIO_GROUP"` or `"DROPDOWN"`). Using `identifier: "TEXT_INPUT"` here does not just risk a fallback — it unconditionally makes the field come back as a plain `TEXT_INPUT`, discarding its options, even though the create call returns 200 and the options are briefly visible in the response's legacy `fields` array.
2. **`stringOptions.validation.enum`** must list every option `value` (an empty `enum` is for free-text only).
3. **`stringOptions.radioGroupOptions.options[]`** carries the rendered choices — each option needs its own **UUID `id`**, a `value`, and a `label`. (For `DROPDOWN`, use `dropdownOptions` with the same `{id, value, label}` shape.)

> **CRITICAL — silent fallback to TEXT_INPUT.** If `identifier` doesn't match `componentType`, or `radioGroupOptions` is missing/malformed (wrong key like `choices` instead of `options`, an option missing its `id`, or an empty `validation.enum`), the API does **not** error — it silently creates the field as a plain `TEXT_INPUT`. If a choice field renders as a text box (or vanishes on the next `GET`), this is why. Build it correctly on the first call; do not probe.

```json
{
  "id": "a1b2c3d4-1002-4e00-8001-000000000002",
  "hidden": false,
  "identifier": "RADIO_GROUP",
  "fieldType": "INPUT",
  "inputOptions": {
    "target": "attending_0002",
    "pii": false,
    "required": true,
    "inputType": "STRING",
    "readOnly": false,
    "stringOptions": {
      "validation": {
        "format": "UNKNOWN_FORMAT",
        "enum": ["Joyfully accepts", "Regretfully declines"]
      },
      "componentType": "RADIO_GROUP",
      "radioGroupOptions": {
        "label": "Will you attend?",
        "showLabel": true,
        "numberOfColumns": "ONE",
        "options": [
          { "id": "c3d4e5f6-3001-4a00-8001-000000000001", "value": "Joyfully accepts", "label": "Joyfully accepts" },
          { "id": "c3d4e5f6-3001-4a00-8001-000000000002", "value": "Regretfully declines", "label": "Regretfully declines" }
        ]
      }
    }
  }
}
```

`numberOfColumns` is a string enum (`"ONE"`, `"TWO"`, `"THREE"`) controlling the radio layout — omit it and the field still works (defaults to one column).

### Date fields (DATE_INPUT / DATE_PICKER)

A date field (e.g. a date of birth) is also a **`STRING` input field** with `inputType: "STRING"`. As with choice fields, `identifier` must equal the `componentType` value — `"DATE_INPUT"` or `"DATE_PICKER"` — or the field is silently created as a plain `TEXT_INPUT` (or dropped, if `identifier` is a custom value) on the next read. Set `stringOptions.validation.format` to `"DATE"`.

```json
{
  "id": "a1b2c3d4-1003-4e00-8001-000000000003",
  "hidden": false,
  "identifier": "DATE_INPUT",
  "fieldType": "INPUT",
  "inputOptions": {
    "target": "date_of_birth_0003",
    "pii": false,
    "required": false,
    "inputType": "STRING",
    "readOnly": false,
    "stringOptions": {
      "validation": {
        "format": "DATE",
        "enum": []
      },
      "componentType": "DATE_INPUT",
      "dateInputOptions": {
        "label": "Date of Birth",
        "showLabel": true
      }
    }
  }
}
```

For a calendar-style picker instead of a text-style date input, use `componentType: "DATE_PICKER"` / `identifier: "DATE_PICKER"` / `datePickerOptions` instead.

### Layout

The `steps[].layout.large.items` array controls how fields are positioned:
- `row` and `column` set the position (0-based grid)
- `width` sets the column span (max 12 for full width, 6 for half)
- `height` is typically 1

### Post-Submission Triggers

The `postSubmissionTriggers.upsertContact` object maps form field targets to contact fields, so each submission automatically creates or updates a contact. The `fieldsMapping` keys must match the `target` values from the form fields.

### Prerequisites

The Wix Forms app (appDefId: `14ce1214-b278-a7e4-1373-00cebd1bef7c`) must be installed on the site. It is usually pre-installed, but if the API returns a "missing installed app" error, install it first using the [Install Wix Apps](../app-installation/install-wix-apps.md) recipe.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Unrecognized value passed for enum` | Invalid `componentType` value (e.g., `LONG_TEXT_INPUT`) | Use only `componentType` values from the schema: `TEXT_INPUT`, `RADIO_GROUP`, `DROPDOWN`, `DATE_TIME`, `PHONE_INPUT`, `DATE_INPUT`, `TIME_INPUT`, `DATE_PICKER`, `PASSWORD` |
| Field silently missing from created form | Custom `identifier` value (e.g., `"product_name"`) not recognized by the API | For a generic text field use `identifier: "TEXT_INPUT"` and set display name via `label`; for any other `componentType`, set `identifier` to that same value (see § "Field Types Reference") |
| Choice/date field silently comes back as `componentType: "TEXT_INPUT"` (options or date config gone) | `identifier` doesn't match `componentType` (most commonly `identifier: "TEXT_INPUT"` used for a `RADIO_GROUP`/`DROPDOWN`/`DATE_INPUT`/`DATE_PICKER` field), or `radioGroupOptions`/`dropdownOptions` malformed (wrong key, option missing `id`, empty `validation.enum`) | Set `identifier` to the exact same string as `componentType`; match the § "Choice fields" / § "Date fields" shape exactly |
| `maximum number of forms reached` / form-cap error | Sites cap at ~4 forms; reached by creating throwaway test forms | `GET form-schema-service/v4/forms` then `DELETE` the unwanted forms; build the real form in one call (don't probe) |
| `Permissions for given namespace not found` | `wix.form_app.form` namespace not active | Ensure the Wix Forms app is installed; try creating a form through the UI first to activate the namespace |
| `missing installed app` | Wix Forms app not installed | Install app `14ce1214-b278-a7e4-1373-00cebd1bef7c` via the [Install Wix Apps](../app-installation/install-wix-apps.md) recipe |

## Related Documentation

- [Form Schemas API Introduction](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/introduction)
- [Create Form API Reference](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form)
- [Form Submissions API](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/introduction)
