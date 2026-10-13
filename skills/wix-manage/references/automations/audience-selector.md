---
name: "Automations Audience Selector Inputs"
description: "Fill an action input that uses the AudienceSelector field: list audience providers, build provider entries and audience parameters, and verify participants."
---

# Audience Selector Inputs — `"ui:field": "AudienceSelector"`

An action input whose UI schema has `"ui:field": "AudienceSelector"` holds **who** the action
targets (contacts with a label, a segment, specific contacts, team members by role, or a person
taken from the trigger payload). The builder fills it with an audience picker; through the public
APIs you reproduce what that picker does: list the site's **audience providers**, pick one, and
write its parameters.

**TL;DR**

- Value: `inputMapping[<field>] = {"providers": [{"providerId": "...", "audienceParams": {...}}]}` —
  one entry per audience; the action targets exactly the listed entries.
- `providerId` is a provider `id` returned by **List Audience Providers** (`<appId>_<key>`), or
  `explicitData_<audienceKey>` for a key the field declares in `explicitAudience`.
- Build `audienceParams` from that provider's returned `inputSchema`; get ids from the owning app's
  public API, never from examples or display names.
- The field's `audienceSelectorOptions` decide which providers are allowed (§2).
- Several providers fit, or the user didn't say who → ask. Never guess an audience.

---

## 1. Value shape

```json
{
  "audience": {
    "providers": [
      {
        "providerId": "74bff718-5977-47f2-9e5f-a9fd0047fd1f_labels",
        "audienceParams": { "labelIds": ["custom.vip-customer"] }
      }
    ]
  }
}
```

- `providers` is an array; each entry is `{providerId, audienceParams}`. `audienceParams` is an
  object (use `{}` when the provider's `inputSchema` needs nothing).
- Keep the property name the action's input schema declares (`audience` above is only an example).
- The same entries appear in **Send an email**'s `selectedAudience.audienceSelectors`
  ([Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) §3) — but a new email's audience comes from its initializer, not from this
  guide.

**Explicit recipients from the payload** — only when the field's `audienceSelectorOptions.explicitAudience`
declares an `audienceKey`:

```json
{
  "providerId": "explicitData_<audienceKey>",
  "audienceParams": {
    "participants": [{ "type": "CONTACT", "value": "{{var(\"contactId\")}}" }]
  }
}
```

- `type` is one of `CONTACT`, `EMAIL`, `PHONE`, `WIX_USER`, and must be allowed by that
  `explicitAudience` entry's `filter` (no `filter` = any of them).
- `value` is a `{{var("…")}}` path from the step's aggregated schema ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4)
  whose value matches the type: a contact id for `CONTACT`, an email address for `EMAIL`, a phone
  for `PHONE`, a Wix user id for `WIX_USER`.
- Never use an `explicitData_` id the field does not declare.

## 2. `audienceSelectorOptions` — what each option means for you

| Option | Effect on the value |
| --- | --- |
| `isAdvancedMode` | `true` → list providers with `scope=NON_SPECIFIC_SITE` (account-level, e.g. team roles); `false` or absent → `scope=SPECIFIC_SITE` (this site's contacts). |
| `participantTypes` | Allowed provider `participantType` values (`CONTACT`, `WIX_USER`, `ANONYMOUS`). Absent → all of them. Pass them as the request's `participantTypes`. |
| `whiteListForProviders` | When present, the only `providerId` values you may use. |
| `explicitAudience[]` | `{audienceKey, displayName, mapLabel, filter?}` — each `audienceKey` defines one valid `explicitData_<audienceKey>` id; `filter` lists its allowed participant types. |
| `prioritizedApps`, `origin`, `modalSubtitle`, `displayFormFieldLabel`, `disable` | Presentation only; they don't change the value. |

## 3. APIs

The Audience Service methods are in **beta** (the docs may change). The Set Up Automations scope
covers them.

| Method | Request | Permission |
| --- | --- | --- |
| [List Audience Providers](https://dev.wix.com/docs/api-reference/business-management/notifications/audiences/audience-v1/list-audience-providers) | `GET https://www.wixapis.com/audience-service/v1/list-audience-providers?scope=SPECIFIC_SITE&participantTypes=CONTACT` (both parameters required; repeat `participantTypes` for several) | `AUDIENCE.AUDIENCE_PROVIDER_READ` |
| [List Participants](https://dev.wix.com/docs/api-reference/business-management/notifications/audiences/audience-v1/list-participants) | `POST https://www.wixapis.com/audience-service/v1/participants/list` | `AUDIENCE.PARTICIPANT_READ` |
| [Count Participants](https://dev.wix.com/docs/api-reference/business-management/notifications/audiences/audience-v1/count-participants) | `POST https://www.wixapis.com/audience-service/v1/count-participants` | `AUDIENCE.PARTICIPANT_READ` |

**List Audience Providers** → `audienceProviders[]`, each with `id` (the `providerId` to save),
`displayName`, `participantType`, `inputSchema` (JSON Schema of the `audienceParams`), `appInfo`
`{id, name}`, `implementedMethods.countParticipants` and `scopes[]`. Example entry:

```json
{
  "id": "74bff718-5977-47f2-9e5f-a9fd0047fd1f_labels",
  "displayName": "Contact Labels",
  "participantType": "CONTACT",
  "inputSchema": {
    "type": "object",
    "required": ["labelIds"],
    "properties": { "labelIds": { "type": "array", "items": [{ "type": "string" }] } }
  },
  "appInfo": { "id": "74bff718-5977-47f2-9e5f-a9fd0047fd1f", "name": "Contacts" },
  "implementedMethods": { "countParticipants": true },
  "scopes": ["SPECIFIC_SITE"]
}
```

**List Participants** / **Count Participants** take the same audience under different field names:
`audiences: [{"audienceProviderId": <providerId>, "audienceProviderData": <audienceParams>}]`.

```json
{
  "audiences": [
    {
      "audienceProviderId": "74bff718-5977-47f2-9e5f-a9fd0047fd1f_labels",
      "audienceProviderData": { "labelIds": ["custom.vip-customer"] }
    }
  ],
  "fields": ["ENRICHED"],
  "paging": { "limit": 5 }
}
```

- List Participants → `participants[]` (each with `type` and one identifier, e.g.
  `contactIdentifier`; `contactData` / `wixUserData` with `fields: ["ENRICHED"]`) and
  `pagingMetadata` (`hasNext`, `cursors.next` → next call's `paging.cursor`). Pages go one audience
  at a time.
- Count Participants → `audienceParticipantCount[]` `{audienceProviderId, count, type}`. A provider
  without `countParticipants` returns `count: 1`, not a real size.
- An `audienceProviderId` not in `<appId>_<key>` form fails with `INVALID_PROVIDER_ID`.

## 4. Recipe

1. Read the field's `audienceSelectorOptions` from the action's UI schema (merged with its dynamic UI
   schema, if any — [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §4).
2. List Audience Providers with the scope and participant types from §2.
3. Keep only providers in `whiteListForProviders` when it is set. Add the field's `explicitAudience`
   keys as candidates.
4. Pick the provider that matches the user's intent ("contacts with the VIP label" → a labels
   provider; "the person who booked" → an `explicitData_` key over the booking contact). Decide by
   `displayName`, `appInfo` and `inputSchema`, not by an id you remember — the provider list
   differs per site. Known shapes such as Contacts' `_labels` → `{labelIds}`, `_segments` →
   `{segmentIds}`, `_contacts` → `{ids}` and the roles provider `_CollaboratorRoles` → `{roleIds}`
   are hints only; the returned `inputSchema` is the contract.
5. Fill `audienceParams` exactly per that `inputSchema` (`required`, types, item shapes). Resolve
   ids — label keys, segment ids, contact ids, role ids — with the owning app's public API, as for
   any entity id ([Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §2), or ask the user.
6. Optional check: Count or List Participants with the same audience to confirm it resolves (for
   example that a label has contacts). `explicitData_` entries resolve only at run time and cannot
   be checked this way.
7. Write `{"providers": [...]}` into the field, then Validate as usual
   ([Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §4).

No matching provider, an empty provider list or a failed call means the audience is **unknown** —
say so and ask; never save an empty `providers` array to satisfy a required field.
