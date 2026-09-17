---
name: "Find Site by Name"
description: Look up a Wix site from the name the user typed. STEP 1 calls the account site search with the name as a substring query, STEP 2 reads displayName and editUrl off each hit, STEP 3 asks the user which one they meant when more than one comes back, then returns the metaSiteId for the chosen site.
---
# Find Site by Name

Resolves a site the user referred to by name into the `metaSiteId` that every other site-level call needs.

## When to use this

The user names a site in words — *"my kintsugi store"* — and the task needs an id before anything else can run.

## Orchestration

1. Search by the name the user gave, as a substring.
2. If exactly one site comes back, use it.
3. If several come back, list their `displayName` values and ask which one they meant. Do not guess.
4. If none come back, say so rather than searching again with a shortened name.

## The call

```bash
curl 'https://manage.wix.com/account/sites/api/sites/search?query=kintsugi&getCount=true' \
  -H 'Authorization: <AUTH>'
```

The response carries one entry per match:

| Field | What it is |
|---|---|
| `metaSiteId` | The id every other site-level call takes |
| `displayName` | The name shown in the dashboard, and what to show the user |
| `editUrl` | Relative; prefix with `https://manage.wix.com` to open the editor |

## Notes

Substring matching is case-insensitive, so `kintsugi` matches *Kintsugi Ceramics*. A name with no match is a real answer — report it instead of retrying with fewer characters.
