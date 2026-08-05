---
name: rp-discovery
description: >-
  Discovers and documents the source platform schema (entities, fields, relationships) for
  a migration project. Use when capturing source structure before mapping to Wix.
---

# rp-discovery

Discover and document the source-platform schema for the active migration project.

## Purpose

Use this skill to inspect the source system, identify entities, relationships, fields, identifiers, media, rich content, and platform-specific constraints. Examples include Shopify, WordPress, WooCommerce, and custom CMS platforms.

This skill owns the **platform-agnostic discovery process and its output contract**
(`source-profile.md` + `source-schema.json`). Platform-specific details — how to capture a
given source, its auth model, REST quirks — live in a dedicated **source adapter** skill,
not here. For WordPress / WooCommerce, that adapter is `rp-source-wordpress`. To support a
new platform, add a sibling adapter (e.g. `rp-source-shopify`) and leave this skill
unchanged.

## Inputs

Expected inputs may include:

- source platform name
- source API docs or exports
- credentials, tokens, or local dump files when available
- current project under `migrations/<project>/`
- project-local config under `migrations/<project>/config/`

## Config gate before capture

Before running source capture, verify the project-local config files created by
`rp-orchestration`:

- `config/wix.env` should always exist with `WIX_SITE_ID` and `WIX_AUTH_TOKEN` keys,
  even though discovery itself may not use Wix credentials yet.
- `config/source.<platform>.env` should exist once the source platform is known. For
  WordPress this is `config/source.wordpress.env`.

If a required key is missing or blank, ask the user for that value and fill the config
file for them before continuing. Ask one value at a time. Never print secret values back
to the user; report only present/missing.

Treat `migrations/<project>/config/*.env` as secret-bearing once they may contain real
values. Do not inspect them with whole-file reads that echo contents into tool output.
Use secret-safe checks only: existence, required key names, and `present` / `blank` /
`missing` status.

## Workflow

1. Confirm the active project under `migrations/<project>/`.
2. Identify the source platform and acquisition method, then select the matching source
   adapter skill (e.g. `rp-source-wordpress` for WordPress / WooCommerce). If no adapter
   exists for the platform, capture entities manually following the same output contract.
3. Run the adapter's capture step to produce a raw, machine-captured dump under
   `<migrations-root>/<project>/data/<source>-discovery/`. For WordPress, the capture
   script lives in `rp-source-wordpress/scripts/` — run it from that skill directory
   (see `rp-source-wordpress` Capture section and `CONVENTIONS.md`). The adapter owns the
   capture mechanics, auth model, and platform quirks; this skill consumes its output.
   - Distinguish **supported** entities (advertised by the source) from **used** entities
     (those with `recordCount > 0`). Entities advertised but empty should be flagged, not
     mapped as if they hold data.
   - A capture made without credentials is usually incomplete (gated entities, private
     fields, PII return 401/403). Do not treat an unauthenticated capture as
     authoritative — the adapter documents what auth a complete run requires.
4. Capture field-level schema details, including type, cardinality, requiredness, and example values.
5. Note operational constraints such as pagination, rate limits, auth model, and incremental sync options.
   If the source base URL or discovered media/file URLs use `localhost`, `127.0.0.1`, or
   another private-only host, record a **media reachability note** in `source-profile.md`.
   Localhost is fine for discovery and local source reads, but Wix Media import is
   URL-based and Wix servers cannot fetch the user's localhost. This is an optional
   preparation step and, as far as we know today, only affects media import. State the two
   acceptable choices:
   - expose the source with a public HTTPS tunnel such as ngrok before live media import
   - skip/defer media import while continuing non-media entities

   Include concise ngrok setup instructions when relevant:

   ```bash
   brew install ngrok
   ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
   ngrok http 8090
   export WP_BASE_URL=https://<id>.ngrok-free.app
   ```
6. Synthesize the raw capture into the normalized artifacts below.

## Artifacts to create or update

- `migrations/<project>/data/<source>-discovery/`: raw machine-captured output from the source adapter. Treated as evidence, not a hand-off artifact — downstream skills reference it for traceability but do not read it wholesale.
- `migrations/<project>/source-profile.md`: source platform, access method, limits, auth, and operational notes. Synthesized from the raw capture. Capture the operational facts the adapter documents (auth model, pagination, rate limits) so `rp-import-codegen` has them without re-deriving.
- `migrations/<project>/source-schema.json`: machine-readable schema for entities and fields. **Synthesized from the raw capture** — this and `source-profile.md` are the canonical hand-off to `rp-mapper`. Include traceability pointers so the mapper can drill into a specific entity's raw file when needed:
  - top-level `rawDiscovery`: relative path to the raw capture dir, e.g. `data/wp-discovery/`.
  - per-entity `rawFile`: file name within that dir, e.g. `wp-v2--posts.md`.
  - per-entity `recordCount` and `inUse` so consumers can distinguish supported vs. actually-used entities.
  - per-entity `relations` derived from the source-declared relationships in the raw capture, so relationships are evidence-backed rather than guessed. Each relation should carry an `evidence` pointer back to the source signal it came from.
  - Follow the adapter's `source-schema.example.json` for the shape (e.g. `rp-source-wordpress/source-schema.example.json`). It is a template to follow, not a strict schema to validate against — keep the platform-agnostic core stable and push platform quirks into each entity's open `sourceMeta` blob.
- Optional supporting notes under `migrations/<project>/research/` if needed.

## Output quality rules

- Separate confirmed facts from assumptions.
- Record per-entity volume (record counts) so downstream skills know what the site actually uses, not just what it supports.
- Preserve source-specific identifiers exactly.
- Include enough detail for downstream mapping and code generation.
- Flag unknowns explicitly instead of inventing structure.
