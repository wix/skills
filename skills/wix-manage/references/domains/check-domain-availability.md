---
name: "Check Domain Availability"
description: Answer whether a domain name, or several at once, is available to register through Wix — a stand-alone "is example.com available?" question with no request to buy or connect.
---

# Check Domain Availability

Answers one question: **can this domain be registered?** and ends with an offer for the next step. It
never buys, connects, searches for alternatives or prices a domain itself: the offer is only a question.
Every availability lookup goes through this skill, including the one inside
[Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md): that recipe calls the
endpoints and reads the results as written here, and adds its own next steps and wording.

Both endpoints are public: send the request without auth headers or tokens.

## Flow

1. **Normalize each domain**: lowercase, trim whitespace, strip `http://`, `https://`, `www.` and any
   path. Keep the extension the user typed.
   - **No extension** (`mybakery`), asked about on its own: ask which extension they want, or offer
     suggestions through [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md).
     Do not guess one. Inside a list, keep it in the bulk call: the item comes back as `INVALID_DOMAIN`.
   - **Subdomain** (`shop.example.com`): do not check it — a subdomain is not registered separately.
     Check the root domain (`example.com`) only if the user asks about that.
2. **One domain** → single check. **Two or more** → one bulk check, never one single check per domain.
3. Read the result per domain, answer in plain language and end with the offer (table below).
4. Run the check silently — no "let me check". Retry any failed call once, silently. If it fails again:
   a `400` means the input is bad (see the table below and the 60-domain limit); anything else, say
   "Something went wrong on our end. Please try again in a moment."

Never name an endpoint, a field or an error code to the user.

## Single check

```
GET https://www.wixapis.com/domain-search/v2/check-domain-availability?domain=example.com
```

```json
{ "availability": { "domain": "example.com", "available": true, "premium": false,
                    "premiumType": "UNKNOWN_PREMIUM_TYPE" } }
```

## Bulk check

Up to **60** domains per call. A larger list is rejected with `400`; split it into batches of 60.

```
POST https://www.wixapis.com/domain-search/v2/bulk/domain-availabilities/check
Content-Type: application/json

{ "domains": ["example.com", "myshop.ws"] }
```

```json
{ "results": [
    { "itemMetadata": { "id": "example.com", "originalIndex": 0, "success": true },
      "item": { "domain": "example.com", "available": true, "premium": false,
                "premiumType": "UNKNOWN_PREMIUM_TYPE" } },
    { "itemMetadata": { "id": "myshop.ws", "originalIndex": 1, "success": false,
                        "error": { "code": "TLD_NOT_SUPPORTED", "description": "Unsupported tlds" } } } ],
  "bulkActionMetadata": { "totalSuccesses": 1, "totalFailures": 1 } }
```

The call returns `200` even when some items fail. Check `itemMetadata.success` on **every** result;
a failed item has `error` and no `item`.

A name that is not a well-formed hostname, such as `-bad-.com`, is not an item error: it fails the
**whole request** with `400`, naming it as `domains[i]` (the position in your list). Keep that name aside
to report as invalid, resend the list without it, and answer for every name in one list, the invalid
one included, in the order the user gave them.

## Reading the result

| Result | Say | Then offer |
|--------|-----|------------|
| `available: true` | "{domain} is available." | "Would you like to get it for your Wix site?" |
| `premium: true` (with `available` `true` or `false`) | "{domain} is available as a premium domain — it costs more than a standard one." Do not give a price figure. | "Would you like to get it for your Wix site?" |
| `available: false`, `premium: false` | "{domain} is already registered." Nothing more about it. | "If it's yours, I can connect it to your Wix site. Or I can look for similar names that are available." |
| Single check: `400` with `details.applicationError.code` = `DOMAINS_UNSUPPORTED_TLD`; bulk item error `TLD_NOT_SUPPORTED` | "We don't currently support .{extension} domains." | "Want me to look for similar names with a supported extension?" |
| Bulk item error `INVALID_DOMAIN`; bulk request `400` naming `domains[i]`; single check `400` with `details.validationError` | "{input} isn't a valid domain name." Ask for a corrected one. For the bulk `400`, the other names are still checked (see above). | The request for a corrected name is the only follow-up. |

**One offer per reply.** For a single domain, add the offer from its row after the answer. For several
domains, answer one line each, then close with **one** offer that covers only the kinds present, for
example: "Want to get any of the available ones, connect one that's yours, or see similar names?"

- The response has **no price**. Never state or estimate a price figure, for any result.
- `premium: true` marks a **premium domain**: it can be registered, at a higher price than a standard
  domain. The API may report such a domain as `available: false`; read `premium` first. It is a pricing
  tier of the domain, not the Wix Premium plan of a site.
- `premiumType` is always `UNKNOWN_PREMIUM_TYPE` today; ignore it.
- For several domains, answer in one list or table, one line per domain, in the order the user gave them.

## Boundaries

A taken or premium domain gets the answer and offer above and nothing else: no owner, registrar, WHOIS
lookup, valuation or price. The offer is a question. Do not run an ownership lookup, a suggestions search,
a purchase or a connection to make it, and do not ask "do you own it?" beyond the offer's wording.

## Next step

Only after the user answers the offer: buy a domain, connect one they own, or look for similar names →
[Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md) (it also holds the suggestions
step). Inside that flow it decides the reply and the table above does not apply.
