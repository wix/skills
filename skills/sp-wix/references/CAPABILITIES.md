# Capability map

The skill's own **what** table — the single source the other steps key off. Each capability names: the **app to install** (Setup), the **content to seed** + the wix-manage **capability phrase** to search (Seed), and the **SDK package(s) + docs link** to hand off (Handoff). It deliberately carries **no API request shapes or call snippets** — request shapes are wix-manage's job (found by the capability phrase); frontend call shapes are the live SDK docs' job (the Handoff links to them, never reproduces them). This is the *what*; wix-manage and the SDK docs are the *how*.

| Capability | Install (appDefId) | Seed — *what* | wix-manage capability phrase | SDK package(s) | SDK docs (for the Handoff) |
|---|---|---|---|---|---|
| **stores** | Wix Stores `215238eb-22a5-4c36-9e7b-e7c08025e04e` | `intent.stores.productCount` products fitting `brand`; the named categories in `intent.stores.categoriesNamed` (none if empty) | *"set up an online store catalog and bulk-create products"* | `@wix/stores` (+ `@wix/ecom @wix/redirects` for cart/checkout) | dev.wix.com/docs/sdk/business-solutions/stores.md (cart: …/ecom.md) |
| **blog** | Wix Blog `14bcded7-0066-7c35-14d7-466cb3f09103` | `intent.blog.postCount` posts on `intent.blog.topics` (else brand-derived) | *"create blog posts (bulk)"* | `@wix/blog` (+ `@wix/ricos` for rich content) | dev.wix.com/docs/sdk/business-solutions/blog.md |
| **forms** | Wix Forms `225dd912-7dea-4738-8688-4b8c6955ffc2` | one form per `intent.forms.forms` entry; fields from each entry | *"create a Wix form"* | `@wix/forms` | dev.wix.com/docs/sdk/business-solutions.md (locate forms/submissions) |
| **cms** | **none** — Wix Data is core (no install) | one collection per `intent.cms.collections` entry + `itemCount` items, content from `brand`; **public-read** | *"create a CMS collection schema"* + *"insert CMS collection items"* | `@wix/data` | dev.wix.com/docs/sdk/business-solutions/data.md |

Always-on package (every capability): **`@wix/sdk`** (provides `createClient` + `OAuthStrategy`).

## Notes that are genuinely the skill's *what* (not recipe *how*, not SDK-usage)

- **stores** — products are **text-only** (no imagery sourced); use the recipe's documented no-image/placeholder path. Categories: create exactly `intent.stores.categoriesNamed`; **if empty, create none** (overrides any recipe default).
- **blog** — text-only (no cover imagery). Bulk-create when `postCount ≥ 2`.
- **cms** — collections are **public-read** (a visitor token has no per-user identity; data is shared/public — surface this to the host in the handoff). Frontend reads are visitor-safe; visitor writes go through Forms.
- **forms** — `purpose` ("contact"/"lead"/"signup") drives the form name; the Wix Forms app is installed in Setup, so the seed step does not reinstall.

## Intent → capability resolution (used by DISCOVERY)

Map the user's words to the set above. The floor is **forms** (a contact/lead form) when nothing richer fits:

| Signal in intent | Capabilities |
|---|---|
| sell / shop / products / catalog / store | `stores` (+ cart via ecom packages) |
| blog / posts / articles / publication / news | `blog` |
| collection / directory / portfolio / structured content / "persist my app's data" | `cms` |
| contact / RSVP / lead / signup / waitlist / "let people reach me" | `forms` |
| nothing dynamic named | `forms` (contact-form floor) |

Multiple signals → multiple capabilities. On ambiguity pick the first row that matches, top-to-bottom.
