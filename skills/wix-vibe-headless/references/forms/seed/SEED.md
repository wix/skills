# Forms — seeding (Form Schemas v4 REST)

Creating a form is an **admin/build-time** job, in six sequential steps. Each has a section below.

1. **Authenticate** — get an elevated credential; the public client ID cannot write.
2. **Install the Wix Forms app** — idempotent, and nothing works until it's there.
3. **Author the form body** — adapt the every-field payload to what the request asks for.
4. **Create the form** — POST each body; a `200` here means almost nothing.
5. **Verify it works** — read the form back, and **submit to it once** for real.
6. **Hand off** — the verified `formId` + field `target`s are written to a file the UI imports.

## API reference

Wix Forms is a **CRM** API, not Business Solutions. Read the page before writing a call you don't
find here — never guess a shape. For anything these pages don't settle — a response shape you didn't
expect, or an operation this doc doesn't cover — use the **`wix-docs`** skill to search + read the
live Wix API reference.

| step | title | page | what it settles |
|---|---|---|---|
| 3 | About Form Fields | https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md | every field-level rule: the identifier/inputType/componentType table, validation, choice fields, contact mapping, layout |
| 3 | Create Form | https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form.md | the create call, plus 10 complete request examples — the source of the payload below |
| 3 | Form object | https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-object.md | each property individually, incl. form-level settings this doc doesn't cover |
| 4 | Form Schemas API | https://dev.wix.com/docs/api-reference/crm/forms/form-schemas.md | every schema method (get, list, delete, enable/disable) |
| 4 | Update Form | https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/update-form.md | revising a form without losing its `formId` |
| 4 | List Forms Providers Configs | https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms-providers-configs.md | the Forms **app's** ceiling on fields and forms — **not** the site's plan cap, which this call cannot tell you (see step 4) |
| 5 | Create Submission | https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission.md | the submission call used to prove the form accepts data |
| 5 | About Submission Values | https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md | the value shape each `inputType` submits — string, array, address object, … |
| 5 | Validation errors | https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/introduction.md#validation-errors | what a rejected submission is telling you |
| — | Form Submissions API | https://dev.wix.com/docs/api-reference/crm/forms/form-submissions.md | every submission method, incl. delete (used to clean up the test submission) |

**⛔ Additive only — never delete, reset, or overwrite existing forms**, even ones that look like the
install's own sample.

**⚠️ Seed BEFORE the form's UI.** Forms is the one vertical that does not run in parallel with the
client: its inputs bind to the schema's field `target`s, so nothing may be built against a form that
hasn't been created *and verified*.

## 1 · Authenticate

Every call in this doc needs an **elevated credential** — a connector/OAuth access token, or a Wix
API key. The public `WIX_CLIENT_ID` cannot write; see the platform doc's seed-auth step. There is
**no helper module** — you make each call yourself with the shapes below.

**Never inline the raw token/API key** into a command — it would end up in the transcript, exec logs,
and shell history. Keep it in a variable and reference it. On Base44 (and any exec-tool platform),
take it from the connector and call with `fetch()` rather than shelling out to curl:

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // stays in memory
```

On any other platform, load it into an env var from your secret manager and don't echo it. Either
way, every call below sends the same three **standard headers** — referred to as such from here on:

```
Authorization: Bearer <token>     // a Wix API key goes in RAW, with no "Bearer"
wix-site-id:   <METASITE_ID>
Content-Type:  application/json
```

## 2 · Install the Wix Forms app

```
POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install
{
  "tenant":      { "tenantType": "SITE", "id": "<METASITE_ID>" },
  "appInstance": { "appDefId": "225dd912-7dea-4738-8688-4b8c6955ffc2", "enabled": true }
}
```

`225dd912-7dea-4738-8688-4b8c6955ffc2` is the Wix Forms app. Until it is installed **every** Form
Schemas call fails with `UNSUPPORTED_FORM_NAMESPACE`, so run this before step 4. The call is
idempotent — re-installing returns `200` — and Base44 sites often don't have the app, so re-running
costs nothing.

## 3 · Author the form body — every field type

There is **one** create call:
`POST https://www.wixapis.com/form-schema-service/v4/forms` with `{ "form": { … } }`.
**You author that body**, starting from the payload below and adapting it to the request.

The payload is one form holding **every field type Wix Forms supports**. Each field block is copied
verbatim from the official Create Form examples, so the `identifier` / `inputType` / `componentType`
triple, the options objects and the validation shapes are the ones Wix actually accepts. (Two
exceptions: **Donation** comes from About Form Fields, and **Custom price** is the one field with no
shipped example — it is composed from the property reference.)

*(Authoring side: which JSON creates each field. The rendering side — which control each one wants
and what its value looks like — is the matching table in `INSTRUCTIONS.md`; they join on
`identifier`.)*

| field                             | `identifier`            | `inputType`  | `componentType`           | submits | requires            |
|-----------------------------------|-------------------------|--------------|---------------------------|---------|---------------------|
| **Text & number**                 |                         |              |                           |         |                     |
| Short answer                      | `TEXT_INPUT`            | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Long answer                       | `TEXT_AREA`             | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Number                            | `NUMBER_INPUT`          | `NUMBER`     | `NUMBER_INPUT`            | number  |                     |
| Rating                            | `RATING_INPUT`          | `NUMBER`     | `RATING_INPUT`            | number  |                     |
| Link                              | `URL_INPUT`             | `STRING`     | `TEXT_INPUT`              | string  |                     |
| **Choice**                        |                         |              |                           |         |                     |
| Dropdown                          | `DROPDOWN`              | `STRING`     | `DROPDOWN`                | string  |                     |
| Single choice                     | `RADIO_GROUP`           | `STRING`     | `RADIO_GROUP`             | string  |                     |
| Multi choice                      | `CHECKBOX_GROUP`        | `ARRAY`      | `CHECKBOX_GROUP`          | array   |                     |
| Tag picker                        | `TAGS`                  | `ARRAY`      | `TAGS`                    | array   |                     |
| Image choice                      | `IMAGE_CHOICE`          | `ARRAY`      | `CHECKBOX_GROUP`          | array   |                     |
| Checkbox                          | `CHECKBOX`              | `BOOLEAN`    | `CHECKBOX`                | boolean |                     |
| **Date & time**                   |                         |              |                           |         |                     |
| Date                              | `DATE_INPUT`            | `STRING`     | `DATE_INPUT`              | string  |                     |
| Date picker                       | `DATE_PICKER`           | `STRING`     | `DATE_PICKER`             | string  |                     |
| Date and time                     | `DATE_TIME_INPUT`       | `STRING`     | `DATE_TIME`               | string  |                     |
| Time                              | `TIME_INPUT`            | `STRING`     | `TIME_INPUT`              | string  |                     |
| **Contact-mapped**                |                         |              |                           |         |                     |
| First name                        | `CONTACTS_FIRST_NAME`   | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Last name                         | `CONTACTS_LAST_NAME`    | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Email                             | `CONTACTS_EMAIL`        | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Phone                             | `CONTACTS_PHONE`        | `STRING`     | `PHONE_INPUT`             | string  |                     |
| Company                           | `CONTACTS_COMPANY`      | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Position                          | `CONTACTS_POSITION`     | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Tax ID → contact `VAT_ID`         | `CONTACTS_TAX_ID`       | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Birthdate                         | `CONTACTS_BIRTHDATE`    | `STRING`     | `DATE_INPUT`              | string  |                     |
| Subscribe checkbox                | `CONTACTS_SUBSCRIBE`    | `BOOLEAN`    | `CHECKBOX`                | boolean |                     |
| Address (single line)             | `CONTACTS_ADDRESS`      | `STRING`     | `TEXT_INPUT`              | string  |                     |
| Address (multi-line)              | `MULTILINE_ADDRESS`     | `ADDRESS`    | `MULTILINE_ADDRESS`       | object  |                     |
| **File (premium)**                |                         |              |                           |         |                     |
| File upload                       | `FILE_UPLOAD`           | `WIX_FILE`   | `FILE_UPLOAD`             | file    | Premium             |
| Signature                         | `SIGNATURE`             | `WIX_FILE`   | `SIGNATURE`               | file    | Premium             |
| **Payment (premium + eCommerce)** |                         |              |                           |         |                     |
| Product                           | `PRODUCT_LIST`          | `PAYMENT`    | `CHECKBOX_GROUP`          | payment | Premium + eCommerce |
| Fixed price                       | `FIXED_PAYMENT`         | `PAYMENT`    | `FIXED_PAYMENT`           | payment | Premium + eCommerce |
| Custom price                      | `PAYMENT_INPUT`         | `PAYMENT`    | `PAYMENT_INPUT`           | payment | Premium + eCommerce |
| Donation                          | `DONATION`              | `PAYMENT`    | `DONATION_INPUT`          | payment | Premium + eCommerce |
| **Scheduling (other Wix apps)**   |                         |              |                           |         |                     |
| Appointment                       | `APPOINTMENT`           | `SCHEDULING` | `APPOINTMENT`             | booking | Wix Meetings        |
| Service picker                    | `SERVICES_DROPDOWN`     | `STRING`     | `SERVICES_DROPDOWN`       | string  | Wix Services        |
| Multi-service picker              | `SERVICES_MULTI_CHOICE` | `ARRAY`      | `SERVICES_CHECKBOX_GROUP` | array   | Wix Services        |
| **Display (collects nothing)**    |                         |              |                           |         |                     |
| Rich content                      | `RICH_TEXT`             | —            | `RICH_CONTENT` *          | —       |                     |
| Submit button                     | `SUBMIT_BUTTON`         | —            | `PAGE_NAVIGATION` *       | —       |                     |

\* A display field sets `fieldType: "DISPLAY"` and has neither an input type nor a
component type — the value shown is its `displayOptions.displayFieldType`.

### **Non-negotiable** rules for adapting the payload

Change the fields, labels, options and targets freely — these seven rules **must** still hold in
whatever you send. Break one and the create still returns `200`; the damage shows up in the
owner's dashboard, or on the first real submission.

- **Every `id` is a lowercase UUID v4, unique within the form** — generate it for each field and every choice `option`.
  Then use those UUIDs where reference to a field or an option is required.
- Use only **form.formFields** for fields, **never `form.fields` - that's legacy API**
- **`steps` must reference every field, including the `SUBMIT_BUTTON`.** Field that is not referenced in any 
  step will not be visible in the business manager.
- **`required` lives at `inputOptions.required`**, never inside a validation block.
- **`validation` is always present**, even as `{}`, and nests under the **`inputType`** options
  object — not the `componentType` one.
- **A choice field declares its options twice** — the component's `options[]` and the validation
  `enum` (`STRING`) or `items.stringOptions.enum` + `itemType` (`ARRAY`) — and the two must agree.
  Get it wrong and the create still returns `200`: the field is created as a **plain text box**,
  losing its choices. Only the 5a component check catches it.
- **`target` is the immutable submission key**: starts with an ASCII letter, letters/digits/`_`
  only, no `__`, unique within the form. Use field's label converted to snake_case with _ and 6 random alphanumeric  
  characters as the field target, e.g. "First name" -> `first_name_a689be`.

```json
{
  "form": {
    "name": "Every field type",
    "namespace": "wix.form_app.form",
    "formFields": [
      {
        "id": "4add0e51-a168-4ab6-76ff-834d782fb4d9",
        "identifier": "TEXT_INPUT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "improve_e62b",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {},
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "What is one thing we could improve?",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "bbecbd37-ca52-4fa6-a92c-90e70aa4ec2a",
        "identifier": "TEXT_AREA",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "message_7634",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {},
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "Your message",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "7e2a15c8-0b34-49df-86a1-c40f9d73e526",
        "identifier": "NUMBER_INPUT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "team_size_9b47",
          "inputType": "NUMBER",
          "numberOptions": {
            "componentType": "NUMBER_INPUT",
            "numberInputOptions": {
              "label": "Team size",
              "showLabel": true
            },
            "validation": {}
          }
        }
      },
      {
        "id": "a5f82c31-7d09-4e6b-b384-0c15fe739a2d",
        "identifier": "RATING_INPUT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "overall_rating_8c46",
          "inputType": "NUMBER",
          "numberOptions": {
            "componentType": "RATING_INPUT",
            "ratingInputOptions": {
              "label": "How would you rate your overall experience?",
              "showLabel": true,
              "defaultValue": 3
            },
            "validation": {}
          }
        }
      },
      {
        "id": "4913d7ab-352a-481b-831f-ee8beb895b64",
        "identifier": "URL_INPUT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "portfolio_d31f",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "format": "URL"
            },
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "Portfolio link",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "3b6d9e21-84c7-4f05-a913-2e7d0c5b48f1",
        "identifier": "DROPDOWN",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "project_type_5c1a",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "enum": [
                "Brand identity",
                "Website redesign"
              ]
            },
            "componentType": "DROPDOWN",
            "dropdownOptions": {
              "label": "Project type",
              "showLabel": true,
              "options": [
                {
                  "id": "32d1d5a1-0ecf-4cff-eb22-c9334fb2f5f8",
                  "label": "Brand identity",
                  "value": "Brand identity"
                },
                {
                  "id": "ff79e749-c49e-4db8-eebb-6062e7aed6c6",
                  "label": "Website redesign",
                  "value": "Website redesign"
                }
              ],
              "customOption": {
                "label": "Other",
                "placeholder": "Tell us about your project"
              }
            }
          }
        }
      },
      {
        "id": "50de5707-06aa-49e7-ba63-cabf0b8bc7e2",
        "identifier": "RADIO_GROUP",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "heard_about_us_3978",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "enum": [
                "Search engine",
                "Social media",
                "A friend"
              ]
            },
            "componentType": "RADIO_GROUP",
            "radioGroupOptions": {
              "label": "How did you hear about us?",
              "showLabel": true,
              "numberOfColumns": "ONE",
              "options": [
                {
                  "id": "89955e02-2f29-4fca-85a9-d026854ec72d",
                  "label": "Search engine",
                  "value": "Search engine"
                },
                {
                  "id": "e6b43c3c-0224-4946-c4cf-5ef4fb34fd37",
                  "label": "Social media",
                  "value": "Social media"
                },
                {
                  "id": "7a1c4d92-8f63-4b05-9e27-3d80fa15c6b4",
                  "label": "A friend",
                  "value": "A friend"
                }
              ]
            }
          }
        }
      },
      {
        "id": "7fe8d8a5-6075-4c81-6678-662fe3ca48e4",
        "identifier": "CHECKBOX_GROUP",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "services_used_21e8",
          "inputType": "ARRAY",
          "arrayOptions": {
            "validation": {
              "items": {
                "itemType": "STRING",
                "stringOptions": {
                  "enum": [
                    "Online store",
                    "Support",
                    "Consultation"
                  ]
                }
              }
            },
            "componentType": "CHECKBOX_GROUP",
            "checkboxGroupOptions": {
              "label": "Which services did you use?",
              "showLabel": true,
              "numberOfColumns": "ONE",
              "options": [
                {
                  "id": "fbcb7e1f-3280-4808-affc-8336efd3e2bf",
                  "label": "Online store",
                  "value": "Online store"
                },
                {
                  "id": "b8a9a269-c622-4de5-2606-3046a3974238",
                  "label": "Support",
                  "value": "Support"
                },
                {
                  "id": "c40e8b17-6a95-42d3-b8f1-05e7d2934ac6",
                  "label": "Consultation",
                  "value": "Consultation"
                }
              ]
            }
          }
        }
      },
      {
        "id": "8c5b3d47-e109-42fa-b6c8-71e4a03f9d52",
        "identifier": "TAGS",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "services_7f30",
          "inputType": "ARRAY",
          "arrayOptions": {
            "validation": {
              "items": {
                "itemType": "STRING",
                "stringOptions": {
                  "enum": [
                    "Logo design",
                    "Copywriting"
                  ]
                }
              }
            },
            "componentType": "TAGS",
            "tagsOptions": {
              "label": "Services you need",
              "showLabel": true,
              "numberOfColumns": "ZERO",
              "options": [
                {
                  "id": "91cbad08-66a2-41dd-f88f-1fad48883076",
                  "label": "Logo design",
                  "value": "Logo design"
                },
                {
                  "id": "451a65af-596b-41be-865f-5e98ce21178f",
                  "label": "Copywriting",
                  "value": "Copywriting"
                }
              ]
            }
          }
        }
      },
      {
        "id": "d419f6b0-5c82-4e17-93ad-6f108b2c7e34",
        "identifier": "IMAGE_CHOICE",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "design_styles_2d68",
          "inputType": "ARRAY",
          "arrayOptions": {
            "validation": {
              "items": {
                "itemType": "STRING",
                "stringOptions": {
                  "enum": [
                    "Minimal",
                    "Editorial"
                  ]
                }
              }
            },
            "componentType": "CHECKBOX_GROUP",
            "checkboxGroupOptions": {
              "label": "Preferred design styles",
              "showLabel": true,
              "numberOfColumns": "TWO",
              "options": [
                {
                  "id": "06a38503-b5a7-4499-c46b-a93c3b305104",
                  "label": "Minimal",
                  "value": "Minimal",
                  "media": {
                    "image": {
                      "id": "8fc025_3ec045fddc7248b0836eed30b4ed1929~mv2.jpg",
                      "url": "https://static.wixstatic.com/media/8fc025_3ec045fddc7248b0836eed30b4ed1929~mv2.jpg",
                      "altText": "Minimal design style"
                    }
                  }
                },
                {
                  "id": "3802532c-6899-40ea-5e30-a3256ad0a1c6",
                  "label": "Editorial",
                  "value": "Editorial",
                  "media": {
                    "image": {
                      "id": "8fc025_b71e4a09cd8f4c1e93b7d05a26fc8e37~mv2.jpg",
                      "url": "https://static.wixstatic.com/media/8fc025_b71e4a09cd8f4c1e93b7d05a26fc8e37~mv2.jpg",
                      "altText": "Editorial design style"
                    }
                  }
                }
              ],
              "optionsMediaSettings": {
                "imageAlignment": "CENTER",
                "imageFit": "COVER"
              }
            }
          }
        }
      },
      {
        "id": "62e0c8f5-9a34-4d61-b7fe-05c9138d24a7",
        "identifier": "CHECKBOX",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "terms_b613",
          "required": true,
          "inputType": "BOOLEAN",
          "booleanOptions": {
            "componentType": "CHECKBOX",
            "checkboxOptions": {
              "label": {
                "nodes": [
                  {
                    "type": "PARAGRAPH",
                    "id": "ipl8z25",
                    "nodes": [
                      {
                        "type": "TEXT",
                        "id": "",
                        "nodes": [],
                        "textData": {
                          "text": "I accept the studio terms and conditions.",
                          "decorations": []
                        }
                      }
                    ],
                    "paragraphData": {
                      "textStyle": {
                        "textAlignment": "AUTO"
                      }
                    }
                  }
                ]
              }
            },
            "validation": {}
          }
        }
      },
      {
        "id": "76976adf-3cc4-453e-863b-577cbb619a45",
        "identifier": "DATE_INPUT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "available_from_4784",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "format": "DATE"
            },
            "componentType": "DATE_INPUT",
            "dateInputOptions": {
              "label": "Available from",
              "showLabel": true,
              "showPlaceholder": false,
              "showDateLabels": true
            }
          }
        }
      },
      {
        "id": "b7c4bc3b-62a7-4746-33bd-c6d46e39ce33",
        "identifier": "DATE_PICKER",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "delivery_date_abfa",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "format": "DATE"
            },
            "componentType": "DATE_PICKER",
            "datePickerOptions": {
              "label": "Preferred delivery date",
              "showLabel": true,
              "firstDayOfWeek": "MONDAY"
            }
          }
        }
      },
      {
        "id": "15fa8e6c-3d71-4b09-a2e5-9c86d4170fb3",
        "identifier": "DATE_TIME_INPUT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "kickoff_call_4e91",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "format": "DATE_TIME"
            },
            "componentType": "DATE_TIME",
            "dateTimeOptions": {
              "label": "Kickoff call date and time",
              "showLabel": true,
              "showPlaceholder": false,
              "showDateLabels": true,
              "use24HourFormat": true
            }
          }
        }
      },
      {
        "id": "905345fa-e7fe-44c0-e114-4999a6e89f79",
        "identifier": "TIME_INPUT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "delivery_time_b37e",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "format": "TIME"
            },
            "componentType": "TIME_INPUT",
            "timeInputOptions": {
              "label": "Preferred delivery time",
              "showLabel": true,
              "showPlaceholder": false,
              "use24HourFormat": true
            }
          }
        }
      },
      {
        "id": "d7665e98-a7c4-4829-c104-fb856883e043",
        "identifier": "CONTACTS_FIRST_NAME",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "first_name_f409",
          "pii": true,
          "contactMapping": {
            "contactField": "FIRST_NAME"
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {},
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "First name",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "740e294e-6ee4-4cda-c902-823002064985",
        "identifier": "CONTACTS_LAST_NAME",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "last_name_b88c",
          "pii": true,
          "contactMapping": {
            "contactField": "LAST_NAME"
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {},
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "Last name",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "19768973-65be-4a6f-b3de-57cfb1da48db",
        "identifier": "CONTACTS_EMAIL",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "email_673d",
          "pii": true,
          "required": true,
          "contactMapping": {
            "contactField": "EMAIL",
            "emailInfo": {
              "tag": "UNTAGGED"
            }
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "format": "EMAIL"
            },
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "Email",
              "showLabel": true,
              "placeholder": "Enter your email"
            }
          }
        }
      },
      {
        "id": "95d528a8-8f3d-4692-7363-44db1f96ca18",
        "identifier": "CONTACTS_PHONE",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "phone_6a4b",
          "pii": true,
          "contactMapping": {
            "contactField": "PHONE",
            "phoneInfo": {
              "tag": "UNTAGGED"
            }
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "format": "PHONE",
              "phoneOptions": {
                "allowedCountryCodes": [
                  "US",
                  "GB",
                  "CA",
                  "AU",
                  "DE",
                  "FR",
                  "IL"
                ]
              }
            },
            "componentType": "PHONE_INPUT",
            "phoneInputOptions": {
              "label": "Phone",
              "showLabel": true,
              "placeholder": "Enter your phone number"
            }
          }
        }
      },
      {
        "id": "7b21e4d6-0a93-4c58-8f37-15d0ba69c284",
        "identifier": "CONTACTS_COMPANY",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "company_5a1c",
          "pii": true,
          "required": true,
          "contactMapping": {
            "contactField": "COMPANY"
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {},
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "Company name",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "e8d3f907-b26a-4715-9c04-3a7e15bd6f82",
        "identifier": "CONTACTS_POSITION",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "position_9f3e",
          "pii": true,
          "contactMapping": {
            "contactField": "POSITION"
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {},
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "Current job title",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "1d64b5c8-3e70-42a9-8b15-c9f207a4e631",
        "identifier": "CONTACTS_TAX_ID",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "tax_id_2b7d",
          "pii": true,
          "contactMapping": {
            "contactField": "VAT_ID"
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {},
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "VAT or tax ID",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "26ce91ce-8ee4-4aa6-2158-7169bcde9b32",
        "identifier": "CONTACTS_BIRTHDATE",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "birthdate_1808",
          "pii": true,
          "contactMapping": {
            "contactField": "BIRTHDATE"
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "format": "DATE"
            },
            "componentType": "DATE_INPUT",
            "dateInputOptions": {
              "label": "Date of birth",
              "showLabel": true,
              "showPlaceholder": false,
              "showDateLabels": true
            }
          }
        }
      },
      {
        "id": "b6c64d1d-f759-40b7-f0ec-3e5cf20ec929",
        "identifier": "CONTACTS_SUBSCRIBE",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "subscribe_d888",
          "contactMapping": {
            "contactField": "SUBSCRIPTION",
            "subscriptionInfo": {
              "subscriptionChannels": [
                "EMAIL"
              ]
            }
          },
          "inputType": "BOOLEAN",
          "booleanOptions": {
            "componentType": "CHECKBOX",
            "checkboxOptions": {
              "label": {
                "nodes": [
                  {
                    "type": "PARAGRAPH",
                    "id": "u7g8s24",
                    "nodes": [
                      {
                        "type": "TEXT",
                        "id": "",
                        "nodes": [],
                        "textData": {
                          "text": "Yes, subscribe me to your newsletter.",
                          "decorations": []
                        }
                      }
                    ],
                    "paragraphData": {
                      "textStyle": {
                        "textAlignment": "AUTO"
                      }
                    }
                  }
                ]
              }
            },
            "validation": {}
          }
        }
      },
      {
        "id": "2ad42412-8663-4b12-4104-05a65db8a4b1",
        "identifier": "CONTACTS_ADDRESS",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "delivery_address_d210",
          "pii": true,
          "required": true,
          "contactMapping": {
            "contactField": "ADDRESS",
            "addressInfo": {
              "tag": "UNTAGGED"
            }
          },
          "inputType": "STRING",
          "stringOptions": {
            "validation": {},
            "componentType": "TEXT_INPUT",
            "textInputOptions": {
              "label": "Delivery address",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "eadbbac7-b883-463f-b205-9b8ffb03a4be",
        "identifier": "MULTILINE_ADDRESS",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "billing_address_bb91",
          "pii": true,
          "contactMapping": {
            "contactField": "ADDRESS",
            "addressInfo": {
              "tag": "UNTAGGED"
            }
          },
          "inputType": "ADDRESS",
          "addressOptions": {
            "validation": {
              "fields": {
                "country": {
                  "required": true
                },
                "addressLine": {
                  "required": true
                },
                "addressLine2": {
                  "required": false
                },
                "city": {
                  "required": true
                },
                "postalCode": {
                  "required": false
                },
                "subdivision": {
                  "required": false
                },
                "streetName": {
                  "required": false
                },
                "streetNumber": {
                  "required": false
                }
              }
            },
            "componentType": "MULTILINE_ADDRESS",
            "multilineAddressOptions": {
              "label": "Billing address",
              "showLabel": true,
              "autocompleteEnabled": false,
              "fieldSettings": {
                "addressLine2": {
                  "show": false
                }
              }
            }
          }
        }
      },
      {
        "id": "6051872d-a37d-4486-5138-e2dd6532cb21",
        "identifier": "FILE_UPLOAD",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "photo_id_2eae",
          "required": true,
          "inputType": "WIX_FILE",
          "wixFileOptions": {
            "componentType": "FILE_UPLOAD",
            "validation": {
              "uploadFileFormats": [
                "IMAGE"
              ],
              "fileLimit": 1
            },
            "fileUploadOptions": {
              "label": "Upload a photo ID",
              "showLabel": true,
              "buttonText": "Upload File",
              "explanationText": "Image files only"
            }
          }
        }
      },
      {
        "id": "cba6b17a-b19c-4c9d-8e37-0e69cb17bbca",
        "identifier": "SIGNATURE",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "signature_3d48",
          "pii": true,
          "required": true,
          "inputType": "WIX_FILE",
          "wixFileOptions": {
            "componentType": "SIGNATURE",
            "validation": {
              "uploadFileFormats": [
                "IMAGE"
              ],
              "fileLimit": 1
            },
            "signatureOptions": {
              "label": "Signature",
              "showLabel": true,
              "imageUploadEnabled": false
            }
          }
        }
      },
      {
        "id": "9d868f4b-bf4c-42da-c18e-72de43337033",
        "identifier": "PRODUCT_LIST",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "products_e817",
          "inputType": "PAYMENT",
          "paymentOptions": {
            "componentType": "CHECKBOX_GROUP",
            "validation": {
              "products": [
                {
                  "id": "db698a17-fa29-47a2-fb96-7b1dc75e2792",
                  "priceType": "FIXED_PRICE",
                  "productType": "DIGITAL",
                  "quantityLimit": {
                    "minimum": 1,
                    "maximum": 1
                  },
                  "fixedPriceOptions": {
                    "price": "25"
                  }
                },
                {
                  "id": "4f2c9a86-31be-4d70-8e15-6b0c73da29f4",
                  "priceType": "FIXED_PRICE",
                  "productType": "DIGITAL",
                  "quantityLimit": {
                    "minimum": 1,
                    "maximum": 1
                  },
                  "fixedPriceOptions": {
                    "price": "40"
                  }
                }
              ]
            },
            "checkboxGroupOptions": {
              "label": "Choose your items",
              "showLabel": true,
              "options": [
                {
                  "id": "e2a84fa5-8ed3-4feb-f30a-bb6c129d37ad",
                  "label": "Digital guide",
                  "value": "db698a17-fa29-47a2-fb96-7b1dc75e2792"
                },
                {
                  "id": "8c317b40-95df-4e26-a103-2f6b8d047e59",
                  "label": "Video course",
                  "value": "4f2c9a86-31be-4d70-8e15-6b0c73da29f4"
                }
              ]
            }
          }
        }
      },
      {
        "id": "8f7023d6-eee0-4288-16c2-87a2aa2c990b",
        "identifier": "FIXED_PAYMENT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "handling_fee_6abe",
          "required": true,
          "inputType": "PAYMENT",
          "paymentOptions": {
            "componentType": "FIXED_PAYMENT",
            "validation": {
              "products": [
                {
                  "id": "e934c5cb-779c-40f1-f60f-ec58aa5a6657",
                  "priceType": "FIXED_PRICE",
                  "productType": "DIGITAL",
                  "quantityLimit": {
                    "minimum": 1,
                    "maximum": 1
                  },
                  "fixedPriceOptions": {
                    "price": "5"
                  }
                }
              ]
            },
            "fixedPaymentOptions": {
              "label": "Handling fee",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "1f0a5c74-3e2b-4a91-8d67-0c5b9e2fa314",
        "fieldType": "INPUT",
        "identifier": "PAYMENT_INPUT",
        "inputOptions": {
          "target": "custom_amount_5c74",
          "inputType": "PAYMENT",
          "paymentOptions": {
            "componentType": "PAYMENT_INPUT",
            "validation": {
              "products": [
                {
                  "id": "5b3d9f21-7c48-4e06-9a1d-8f2c4b70de95",
                  "priceType": "DYNAMIC_PRICE",
                  "productType": "DIGITAL",
                  "quantityLimit": {
                    "minimum": 1,
                    "maximum": 1
                  },
                  "dynamicPriceOptions": {
                    "minPrice": "5"
                  }
                }
              ]
            },
            "paymentInputOptions": {
              "label": "Amount",
              "showLabel": true
            }
          }
        }
      },
      {
        "id": "b7e7755e-fe11-4546-c29d-20d51007b164",
        "fieldType": "INPUT",
        "identifier": "DONATION",
        "inputOptions": {
          "target": "donation_4dee",
          "inputType": "PAYMENT",
          "paymentOptions": {
            "componentType": "DONATION_INPUT",
            "validation": {
              "products": [
                {
                  "id": "b66b1c6c-ec2e-4a69-abb9-37d6bbacc706",
                  "priceType": "FIXED_PRICE",
                  "productType": "DIGITAL",
                  "quantityLimit": {
                    "minimum": 1,
                    "maximum": 1
                  },
                  "fixedPriceOptions": {
                    "price": "10"
                  }
                },
                {
                  "id": "df5faf1a-4b00-4e94-0b64-b4b1f94fc09a",
                  "priceType": "FIXED_PRICE",
                  "productType": "DIGITAL",
                  "quantityLimit": {
                    "minimum": 1,
                    "maximum": 1
                  },
                  "fixedPriceOptions": {
                    "price": "20"
                  }
                }
              ]
            },
            "donationInputOptions": {
              "label": "Donation",
              "showLabel": true,
              "numberOfColumns": "THREE",
              "options": [
                {
                  "value": "b66b1c6c-ec2e-4a69-abb9-37d6bbacc706"
                },
                {
                  "value": "df5faf1a-4b00-4e94-0b64-b4b1f94fc09a"
                }
              ]
            }
          }
        }
      },
      {
        "id": "218260f0-e9b3-4aee-2aed-267cd8f6460f",
        "identifier": "APPOINTMENT",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "consultation_4146",
          "inputType": "SCHEDULING",
          "schedulingOptions": {
            "componentType": "APPOINTMENT",
            "appointmentOptions": {
              "label": "Pick a time for your consultation",
              "showLabel": true,
              "name": "Consultation",
              "durationInMinutes": 30,
              "staffIds": [
                "8cd69332-ea08-45a1-8333-526b623bcec2"
              ],
              "manualApprovalRequired": false,
              "format": "PHONE",
              "phoneOptions": {
                "description": "Phone call"
              }
            }
          }
        }
      },
      {
        "id": "ca7a4f22-31fa-40d3-635b-baad47d53344",
        "identifier": "SERVICES_DROPDOWN",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "service_7374",
          "inputType": "STRING",
          "stringOptions": {
            "validation": {
              "enum": [
                "ecadb257-0be6-4011-a575-a17d2232e278"
              ]
            },
            "componentType": "SERVICES_DROPDOWN",
            "servicesDropdownOptions": {
              "label": "Choose a service",
              "showLabel": true,
              "placeholder": "Select a service",
              "options": [
                {
                  "id": "ecadb257-0be6-4011-a575-a17d2232e278",
                  "label": "Initial consultation",
                  "value": "ecadb257-0be6-4011-a575-a17d2232e278"
                }
              ]
            }
          }
        }
      },
      {
        "id": "02ecf77a-018c-4bb5-202c-58c9e2bb87b2",
        "identifier": "SERVICES_MULTI_CHOICE",
        "fieldType": "INPUT",
        "inputOptions": {
          "target": "add_ons_406f",
          "inputType": "ARRAY",
          "arrayOptions": {
            "validation": {
              "items": {
                "itemType": "STRING",
                "stringOptions": {
                  "enum": [
                    "7d19f3a5-4c82-4e06-b573-91a0dc2e685f"
                  ]
                }
              }
            },
            "componentType": "SERVICES_CHECKBOX_GROUP",
            "servicesCheckboxGroupOptions": {
              "label": "Add-on services",
              "showLabel": true,
              "numberOfColumns": "ONE",
              "options": [
                {
                  "id": "7d19f3a5-4c82-4e06-b573-91a0dc2e685f",
                  "label": "Follow-up session",
                  "value": "7d19f3a5-4c82-4e06-b573-91a0dc2e685f"
                }
              ]
            }
          }
        }
      },
      {
        "id": "9e5b1c73-2f48-4a06-b91d-73c0e8452fa1",
        "identifier": "RICH_TEXT",
        "fieldType": "DISPLAY",
        "displayOptions": {
          "displayFieldType": "RICH_CONTENT",
          "richContentOptions": {
            "richContent": {
              "nodes": [
                {
                  "type": "PARAGRAPH",
                  "id": "wvr3b41",
                  "nodes": [
                    {
                      "type": "TEXT",
                      "id": "",
                      "nodes": [],
                      "textData": {
                        "text": "I confirm that I am participating voluntarily and accept the risks involved.",
                        "decorations": []
                      }
                    }
                  ],
                  "paragraphData": {
                    "textStyle": {
                      "textAlignment": "AUTO"
                    }
                  }
                }
              ]
            }
          }
        }
      },
      {
        "id": "2e56791e-926e-48fd-37d0-0ad60a27736d",
        "identifier": "SUBMIT_BUTTON",
        "fieldType": "DISPLAY",
        "displayOptions": {
          "displayFieldType": "PAGE_NAVIGATION",
          "pageNavigationOptions": {
            "submitText": "Pay"
          }
        }
      }
    ],
    "steps": [
      {
        "id": "0f0e6cfd-3e1a-4a1e-9a3a-4e2b5c6d7e8f",
        "name": "Page 1",
        "layout": {
          "large": {
            "items": [
              {
                "fieldId": "4add0e51-a168-4ab6-76ff-834d782fb4d9",
                "row": 0,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "bbecbd37-ca52-4fa6-a92c-90e70aa4ec2a",
                "row": 1,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "7e2a15c8-0b34-49df-86a1-c40f9d73e526",
                "row": 2,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "a5f82c31-7d09-4e6b-b384-0c15fe739a2d",
                "row": 3,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "4913d7ab-352a-481b-831f-ee8beb895b64",
                "row": 4,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "a0d72e94-6f18-4c3b-85d0-e21739bc6a48",
                "row": 5,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "3b6d9e21-84c7-4f05-a913-2e7d0c5b48f1",
                "row": 6,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "50de5707-06aa-49e7-ba63-cabf0b8bc7e2",
                "row": 7,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "7fe8d8a5-6075-4c81-6678-662fe3ca48e4",
                "row": 8,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "8c5b3d47-e109-42fa-b6c8-71e4a03f9d52",
                "row": 9,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "d419f6b0-5c82-4e17-93ad-6f108b2c7e34",
                "row": 10,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "62e0c8f5-9a34-4d61-b7fe-05c9138d24a7",
                "row": 11,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "76976adf-3cc4-453e-863b-577cbb619a45",
                "row": 12,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "b7c4bc3b-62a7-4746-33bd-c6d46e39ce33",
                "row": 13,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "15fa8e6c-3d71-4b09-a2e5-9c86d4170fb3",
                "row": 14,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "905345fa-e7fe-44c0-e114-4999a6e89f79",
                "row": 15,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "d7665e98-a7c4-4829-c104-fb856883e043",
                "row": 16,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "740e294e-6ee4-4cda-c902-823002064985",
                "row": 17,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "19768973-65be-4a6f-b3de-57cfb1da48db",
                "row": 18,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "95d528a8-8f3d-4692-7363-44db1f96ca18",
                "row": 19,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "7b21e4d6-0a93-4c58-8f37-15d0ba69c284",
                "row": 20,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "e8d3f907-b26a-4715-9c04-3a7e15bd6f82",
                "row": 21,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "1d64b5c8-3e70-42a9-8b15-c9f207a4e631",
                "row": 22,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "26ce91ce-8ee4-4aa6-2158-7169bcde9b32",
                "row": 23,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "b6c64d1d-f759-40b7-f0ec-3e5cf20ec929",
                "row": 24,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "2ad42412-8663-4b12-4104-05a65db8a4b1",
                "row": 25,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "eadbbac7-b883-463f-b205-9b8ffb03a4be",
                "row": 26,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "6051872d-a37d-4486-5138-e2dd6532cb21",
                "row": 27,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "cba6b17a-b19c-4c9d-8e37-0e69cb17bbca",
                "row": 28,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "9d868f4b-bf4c-42da-c18e-72de43337033",
                "row": 29,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "8f7023d6-eee0-4288-16c2-87a2aa2c990b",
                "row": 30,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "1f0a5c74-3e2b-4a91-8d67-0c5b9e2fa314",
                "row": 31,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "b7e7755e-fe11-4546-c29d-20d51007b164",
                "row": 32,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "218260f0-e9b3-4aee-2aed-267cd8f6460f",
                "row": 33,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "ca7a4f22-31fa-40d3-635b-baad47d53344",
                "row": 34,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "02ecf77a-018c-4bb5-202c-58c9e2bb87b2",
                "row": 35,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "9e5b1c73-2f48-4a06-b91d-73c0e8452fa1",
                "row": 36,
                "column": 0,
                "width": 12,
                "height": 1
              },
              {
                "fieldId": "2e56791e-926e-48fd-37d0-0ad60a27736d",
                "row": 37,
                "column": 0,
                "width": 12,
                "height": 1
              }
            ]
          }
        }
      }
    ]
  }
}
```

## 4 · Create the form

One POST per form body, to the **Form Schemas v4** endpoint — a **CRM** API, not Business Solutions,
always on the public host, never `/_api/`:

```
POST https://www.wixapis.com/form-schema-service/v4/forms
{ "form": { … the body from step 3 … } }
```

Read **`form.id`** from the response — that's the `formId` the rest of the run carries. **Record it
the moment it comes back**, before anything else: it is the only way a later attempt can tell a form
this run created from one the owner already had. Forms are independent (no shared revision), so
create them in any order.

**Three things to check before you POST.** The API accepts the first two and loses the field; the
third leaves you with a second form:

- the body has at least one `INPUT` field — a form of nothing but a submit button collects nothing;
- **no two fields share a `target`**. The server keeps one; every other field with that key silently
  stores nothing.
- **no form of this name exists yet** —
  `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form`, comparing
  `name` exactly. Wix does **not** reject a duplicate name; it silently appends a counter (`"Contact"`
  → `"Contact 1"`), so create is **not idempotent** and nothing tells you a retry duplicated a form.
  A name matching a form **this run** created (per the id you recorded above) → reuse that `formId`
  rather than creating again. A name you have no record of creating is the **owner's**: additive
  only, so leave it alone and pick a different name or ask.

An orphan *you* created in this run is yours to clear — `DELETE .../v4/forms/<formId>` is a soft
delete to the trash bin, so it is recoverable. Anything you did not create stays untouched.

**A `200` here proves almost nothing.** Most mistakes in a form body are accepted at create and
surface only in the owner's dashboard or on the first real submission — step 5 is what actually
proves the form works. Two failures worth recognizing before you retry:

- A transient `5xx`, an identity/propagation error right after install, or a timeout leaves you not
  knowing whether the create landed. **Re-list by name before retrying** — never blind-retry the
  POST, because the duplicate it may create is silent. One retry once the list comes back empty;
  never a loop.
- **Plan gates are a hard block, not a note-and-continue.** `FIELDS_COUNT_RESTRICTIONS_ERROR`
  (per-form field cap), `FILE_UPLOAD_RESTRICTIONS_ERROR` (upload/signature/payment below Core) and
  `FORMS_COUNT_RESTRICTIONS_ERROR` (site form cap) each mean **reduce or upgrade** — put the choice
  to the user with their dashboard link and wait for an answer. Never split a form across schemas to
  dodge the field cap, never inline a file as base64, and never create throwaway forms to probe the
  shape.

  **The field cap cannot be read in advance.** `listFormsProvidersConfigs` reports the Forms app's
  ceiling, not the site's plan cap — on a free site it returns `maxFields: 150` while the create is
  rejected with `"Field count reached its limit of 10"`. The cap is per plan, not per app. Treat the
  create as the only authority on the number: budget conservatively while authoring step 3 rather
  than discovering the limit after a full authoring pass, and count every entry in `formFields`, the
  `SUBMIT_BUTTON` included.

**Revising a form later** — add a field, relabel one, tighten a rule:

```
PATCH https://www.wixapis.com/form-schema-service/v4/forms/<formId>
{ "form": { …, "revision": "<the form's current revision>" } }
```

Never delete-and-recreate: a `PATCH` keeps the `formId` the UI already holds and spends no extra slot
against the site's form cap. Re-run step 5 afterwards — an update regresses a layout exactly as a
create can.

## 5 · Verify it works

**All four calls are yours to make**, and the last one needs a submission you compose from *this*
form's schema. All four use the standard headers from step 1.

**A `200` on create means the body parsed — nothing more.** Every mistake below returns `200` and
surfaces only in the owner's dashboard or on the first real submission.

### 5a · Read the form back

```
GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&formIds=<formId>
```

`formIds` narrows the listing to exactly what you created, so you assert against it directly. Then,
against the returned `form.formFields`:

- **Every `target` you sent is there.** One that isn't means the field didn't persist — usually an
  `identifier` Wix doesn't recognize, which is dropped without an error.
- **Every `inputOptions.required` reads back as you sent it.** A `required` key placed inside a
  validation block is accepted and then discarded, so the form ships with nothing mandatory. This
  diff is the only signal you will ever get.
- **Every choice field is still a choice field.** For each `DROPDOWN` / `RADIO_GROUP` /
  `CHECKBOX_GROUP` / `TAGS` you sent, assert the read-back still carries that `componentType`, that
  its `options[]` is non-empty, and that it agrees with the validation `enum`. A malformed options
  block is accepted at create and comes back as a plain text input — `target` intact, `required`
  intact — so every other check in step 5 passes and the field silently loses its choices.
- **Keep the read-back `target`s.** These, not the ones you authored, are what goes into step 6.

### 5b · Check the dashboard view

```
GET https://www.wixapis.com/form-schema-service/v4/forms/<formId>/summary
```

Assert `formSummary.fields` is **non-empty**, with one entry per input field you sent (everything in
`formFields` except the `SUBMIT_BUTTON`). The summary is exactly what the Wix dashboard renders, so a
short or empty count means the form is blank — or partly blank — **for the owner**, even while the
public site submits fine. Non-contact fields count too; don't expect only the contact-mapped ones.

### 5c · Submit to it once, for real

This is the check the other two can't stand in for. An ARRAY field whose `validation.items` is
missing `itemType` passes 5a and 5b and then `400`s **form-wide** — every field, every visitor.
Submitting once is the only proof the form can receive data at all.

**What it does not catch:** a STRING choice field does **not** enforce its `validation.enum` on
submit. A dropdown whose enum and options both read back correctly still accepts `"Not an option"`
with a `200`. So the probe proves the form *receives* data; it will not tell you a choice field's
two declarations have drifted apart. Get those right in step 3 — nothing downstream will catch it
for you.

```
POST https://www.wixapis.com/form-submission-service/v4/submissions
{ "submission": { "formId": "<formId>", "submissions": { "<target>": <value> } } }
```

**Rules for composing `submissions`** — get one wrong and the whole submission fails, not just that
value:

- **Keys are field `target`s from the 5a read-back.** Never a label, never a field `id`. A key that
  isn't a target in the schema fails the entire submission.
- **Include every `required` field** — the server rejects the submission without them — **plus every
  ARRAY field whether required or not**, since the ARRAY shape is the thing you're testing.
- **The value's shape follows the field's `inputType`, not its component:**

  | `inputType` | value | example |
  |---|---|---|
  | `STRING` | a string, formatted per `validation.format` | `"seed-probe@example.com"`, `"2030-01-01"`, `"10:00:00"` |
  | `NUMBER` | a number | `1` |
  | `BOOLEAN` | a boolean | `true` |
  | `ARRAY` | an array of **option values** | `["Option 1"]` |
  | `ADDRESS` | an object, only the subfields the form shows | `{"country":"US","subdivision":"US-NY","city":"New York","postalCode":"10011","addressLine":"235 West 23rd Street"}` |
  | `PAYMENT` | an array of `{productId, price, quantity}` | `[{"productId":"<from validation.products>","price":"25","quantity":1}]` |
  | `SCHEDULING` | `{startDate, endDate, timeZone}` | `{"startDate":"2030-07-02T14:00:00","endDate":"2030-07-02T14:30:00","timeZone":"America/New_York"}` |

- **Use one of the field's own option `value`s** — copy it from the schema rather than retyping the
  label. The server won't reject a value outside the enum (see above), so a typo here quietly proves
  nothing.
- **`country` and `subdivision` are validated against each other**, so send a matching pair or omit
  `subdivision`.
- **A `WIX_FILE` field can't be faked.** If a file upload or signature is `required`, this check
  can't run — say so and have the user submit once through the published site instead of recording a
  pass that never happened.

Assert `200`. A **`400 SUBMISSION_VALIDATION` is a schema bug, not a submission bug** — fix the form
body and re-create it; never bend the value to get through. The error names the field and the reason
under `details.validationError.fieldViolations[].data.errors[]`, each with an `errorPath` (the
`target`) and an `errorType` — `UNKNOWN_VALUE_ERROR` means the key isn't a `target` in this form.

### 5d · Delete the test submission

```
DELETE https://www.wixapis.com/form-submission-service/v4/submissions/<id>
```

The id comes from the 5c response as **`submission.id`**: REST returns `id`, not the `_id` the
reference schema shows (that's the SDK's shape). Do this every time — the owner's inbox is a real
business inbox, and a probe left in it looks like a real enquiry. If a probe ever escapes, find it
with `POST /form-submission-service/v4/submissions/namespace/query` filtered by `formId` +
`namespace`.

## 6 · Hand off

Only once step 5 has passed for every form, write `src/rest/wix-forms.config.js` — one entry per
form, keyed by the form's name lowercased with each run of non-alphanumerics collapsed to a single
`_` (`"Quote request"` → `quote_request`):

```js
// Written by the seed run once step 5 passed. Do not hand-edit, and do not create it early:
// its existence is what proves the form schemas were created AND verified.
export const WIX_FORMS = {
  contact: { formId: "…", name: "Contact", targets: { email: true, message: true } },
};
```

**That file is the handoff, and the gate.** The UI imports `WIX_FORMS` from it; no file means the
seed did not succeed, so nothing may be built against the form yet. So **never write it before step 5
passes**, and never invent a `formId`. If the app's `src/` layout puts its REST layer elsewhere, write
it there instead — the path matters less than the file existing before the UI step.

`targets` is the **read-back** map of immutable submission keys — the one from 5a, not the one you
authored in step 3. Everything else — labels, order, options, validation — the client reads **live
from the schema**, so an owner's dashboard edit shows on the site with no code change.
