# Discovery — integration mode (custom)

Reached when `frontend === "custom"` — the user brought a finished, working site (Claude Design or any tool) and wants it connected to Wix. The shared mode-detection (Wave 0) + CLI-auth pre-flight live in `DISCOVERY.md`; this file is the integration discovery (parse → infer → light plan → approval). Run FLOW (when/order/gate) is owned by `PLAN-integration.md`.

**Input processing:** the brought-in site — parsed, not interviewed. **Plan shape:** a light plan (detected-site summary + what to wire/add + apps), not the astro Design-Direction card.

Discovery here **parses the site instead of interviewing**, then hands off to the integration flow (`references/custom/INSTRUCTIONS.md`). Do **not** run brand suggestions, vibe, imagery, the Designer, or the scaffold.

After the Pre-flight auth check (`DISCOVERY.md` § "Pre-flight"), run integration discovery:

## 1 · Read the site (primary signal)

Read the entry HTML (and other pages) — markup, copy, headings/`<title>`, `<form>`s, repeated structures, and the CSS custom-property token block (`:root { --… }`). **Opportunistic enrichment:** if a Claude-Design handoff bundle is present (`README.md`, `chats/` transcript), read it to sharpen intent — but never require it; the inference must stand on markup alone.

## 2 · Infer the domain → capability

Map the site's purpose to the Wix capability + apps using the table in `references/custom/INSTRUCTIONS.md` § "Always connect" (wedding invite → RSVP/Wix Forms; store mock → Wix Stores; etc.). **Always connect:** if the site has no dynamic region, pick the connected feature its purpose implies; the universal floor is a Wix Forms contact/lead form. Also infer the **brand** (from `<title>`/copy) for `.wix/site.json` and any seeded-content naming.

## 3 · Present a light plan, then approval

Same discipline as the astro path (`DISCOVERY-regular.md` § "Step 3" / `PLAN-regular.md`): **present the plan as its own message first, then ask for approval as a separate step.** The integration plan is *light* (no Design Direction — the user already designed it), but it still shows the user what will happen before they commit. Structure:

- **What I found** — one line: the site's type/purpose + the pages/regions detected (e.g. *"A static wedding invitation — hero, date, venue, closing. No RSVP, no dynamic content."*).
- **What I'll connect** — what you'll **wire** (existing dynamic regions → a Wix entity) and what you'll **add** (the connected component the purpose implies), plus the **apps** to install. (e.g. *"I'll install Wix Forms and add an RSVP form styled to match the invitation."*)

Then, as a separate step, ask for approval (`AskUserQuestion`): *"Ready to connect it?"* — Options: **Yes, connect it** / **Adjust something**. If the user adjusts (different capability, skip the augmentation, etc.), handle it conversationally and re-present.

> Example combined shape — present this as the plan message, then ask the approval question:
> *"This is a wedding invitation with no RSVP. I'll install Wix Forms, add an RSVP form styled to match, and publish it live."*

## 4 · After approval — write `.wix/site.json`

Write `.wix/site.json` via `init-site-json.mjs --frontend custom`:

```bash
mkdir -p .wix
node "<SKILL_ROOT>/scripts/init-site-json.mjs" \
    "$(pwd)" "<inferred brand>" "<one-line site summary>" "<capabilities-csv>" \
    --frontend custom
```

- `--frontend custom` is what makes the conductor skip `wix build` at release (`release` is inline, no-build).
- `<capabilities-csv>` = the inferred capability set (e.g. `"forms"`, or `"stores,ecom"`), recorded as `verticals`.
- The script writes a slim `.wix/site.json` (`{brand, frontend, verticals}`; `siteId`/`appId` patched in by the integration flow's init step). It refuses to overwrite an existing file; surface a stale one rather than `rm`-ing it.

Then hand to `BUILD-integration.md`. The frontend-track playbook is `references/custom/INSTRUCTIONS.md`; `PLAN-integration.md` owns the pre-approval routing.
