# Seed — create the backend content

For each capability, create the backend content its *what* names. This step carries **only the *what*** (entities, count source, policy); the **API *how*** is found by searching the in-context `wix-manage` recipes. **No endpoints, payloads, field templates, caps, or batching mechanics live in this file** — if you find yourself writing one, it belongs to a recipe.

## How it runs

First, **load the recipe library**: invoke `Skill(name="wix-manage")` **once** — this brings the recipe files into context (a directory path is not a substitute). The token is already in `/tmp/wix_token` from Setup. The capabilities are **independent** — no ordering or data dependency between them. For each one:

1. **Find the recipe** by its capability phrase (`references/CAPABILITIES.md` → "wix-manage capability phrase") against the in-context recipe index. **Fail loud** if no recipe matches a required capability — a missing recipe is a real error, not a cue to guess.
2. **Read the matched recipe** and build request bodies from `intent.<cap>` + `brand`. The recipe is the source of truth for URL/method/body.
3. **Execute** against `wixapis.com` with the call shape in `references/AUTHENTICATION.md` (Bearer from `/tmp/wix_token` + `wix-site-id`).
4. **Collect the created IDs** into a `seeded` map keyed by capability.

> **Text-only seed.** Use each recipe's documented no-image/placeholder path; don't source imagery. The host's app demonstrates the data *shape*, not a full media catalog.

## Per-capability *what*

Each block states only the entities, where their count/content comes from, the policy that is genuinely the skill's call, and the IDs to keep. The capability phrase (CAPABILITIES.md) finds the recipe that supplies the rest.

- **stores** — *A product catalog.* `intent.stores.productCount` products whose names/prices fit `brand`. If `intent.stores.categoriesNamed` is non-empty, create exactly those categories and assign products into them; **if empty, create none** (skill policy — overrides any recipe default). Text-only. **Keep:** `productIds[]`, `categoryIds[]`, and product `slug`s (the frontend links by slug).
- **blog** — *Initial posts.* `intent.blog.postCount` posts on `intent.blog.topics` (or brand-derived topics). Text-only (no covers). Bulk-create when `postCount ≥ 2`. **Keep:** `postIds[]`, post `slug`s.
- **cms** — *Content collections.* One collection per `intent.cms.collections` entry; `itemCount` items each, content from `brand`. Collections are **public-read** (visitor reads on the frontend). **Keep:** `collectionIds{<name>}`, `itemIds{<name>:[]}`, and each collection's field keys (the frontend binds by them).
- **forms** — *Lead-capture forms.* One form per `intent.forms.forms` entry; fields from the entry; `purpose` names the form. **Keep:** `formIds[]`, and each form's field **`target`** keys (the frontend sets input `name` = target).

## Aggregate

Hold a `seeded` map in scratch — `seeded[<capability>] = { …kept IDs… }`. This is the producer for the handoff (`SDK_HANDOFF.md`), which inlines the IDs so the host can bind immediately. Whether to also write a sidecar file is a host-preference choice (default: return-only, in the handoff message).

On a per-capability error, keep the other capabilities' results and surface the failing recipe-call response verbatim; partial state is fine — a targeted re-run is bounded.

## Proceed to Handoff

With `seeded` populated, continue to **`SDK_HANDOFF.md`** to produce the document the host wires from.
