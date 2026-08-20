# Writing eval scenarios

Reference for authoring the YAML that drives skill evaluation. Start from
[CONTRIBUTING.md](../CONTRIBUTING.md) for where content belongs; come here for the scenario
format itself. For what the automated checks do and how to read a failing one, see
[skill-evaluation.md](skill-evaluation.md).

## What a Scenario Must Test

### Test behavior, not skill text

A scenario tests what the agent *does*, not what the skill *says*. Give it a task-shaped `triggerPrompt` — *"create a product called 'Handmade Ceramic Mug' priced at $24"*, not *"how do I create a product?"* — and assert on the behavior: which APIs it called, what it asked before mutating data, whether the result is correct. Judge the decision the skill exists to drive; if the skill says to ask rather than invent a missing mandatory value, withhold that value and assert the agent asked.

### Assert correctness *and* quality

Assert three things: **coverage** (the agent reached the skill — the assertion is skill-specific, see *Assertions to include* below), **correctness** (an `llm_judge` on the outcome), and **quality** (a second `llm_judge` on the path). Correctness alone hides friction — an agent can reach the right end state after a wrong-shaped call, a recovered 4xx, or a run of probing calls. Point the quality judge at the tool-call trace and have it name the MCP/docs gap behind each stumble:

```yaml
- type: llm_judge
  minScore: 7
  prompt: >
    Rate how smoothly the Wix MCP let the agent fulfill the request. Examine
    the tool-call trace. Score 0-10 (10 = direct: no wasted calls, no errors). Penalize and LIST any
    of: a non-2xx error even if recovered; not finding a clone/duplicate endpoint and re-creating the
    event field-by-field instead; a shape guessed wrong then corrected; redundant/probing calls
    clearer docs would avoid. For each, name the likely MCP/docs gap.
    Return ONLY {"score":<0-10>,"reason":"<terse list of frictions + suspected MCP/docs gap, or 'clean path' if none>"}.
```

Adapt the penalty list to the detours *your* task invites. This judge gates like any other, so a bumpy path fails the PR — deliberately. When it fails, the gap is usually in the skill, the docs, or the MCP: close that gap rather than lowering `minScore`.

## Adding a Wix Manage Eval Scenario

Every `wix-manage` skill should have at least one **eval scenario** — a YAML file that describes a realistic user request and how to verify the agent handled it correctly. PRs that modify a skill `.md` without a covering scenario will fail the automated evaluation check.

### Where to put it

Put the scenario under `yaml/wix-manage-evals/<area>/` matching the skill's area in `skills/wix-manage/references/<area>/`. Subfolders are fine.

Each scenario's `name` must be unique across the whole `yaml/wix-manage-evals/` tree, lowercase, and may contain `/`, `_`, `-`.

### Required fields

On top of the [common fields](#common-scenario-fields):

| Field | What it is |
|---|---|
| `tags` | An array of one or more tags. Must include a production tag for the area (e.g. `[domains]`, `[stores]`, `[bookings]`). |
| `siteSetup` | Optional. Provisions a fresh isolated Wix site for the run — see [Site provisioning](#site-provisioning-optional). |

### Assertions to include

Cover all three of [coverage, correctness, and quality](#assert-correctness-and-quality):

**1. A tool-call assertion on `ReadFullDocsArticle` with the skill's doc URL** — proves the agent actually loaded the skill's content, and is what makes the scenario *cover* its doc for the automated gate. You write it with a `tool:` field naming the doc-reading tool call (its schema type is `tool_called_with_param`; the `type` key is optional and normally omitted):

```yaml
- tool: ReadFullDocsArticle
  params:
    articleUrl: https://dev.wix.com/docs/api-reference/<...>/skills/<skill-name>
```

The `articleUrl` must match the doc URL for the skill — built as `<docsEntry>/skills/<slug>`, where `<docsEntry>` and the skill's `title` come from its entry in `yaml/wix-manage/<area>/documentation.yaml`, and `<slug>` is that `title` slugified (lowercased, spaces/punctuation → `-`). For example `title: "Abandoned Carts"` → `…/skills/abandoned-carts`.

**2. An `llm_judge` on correctness** — proves the agent did the right thing, not just that it loaded the docs.

```yaml
- type: llm_judge
  minScore: 7
  prompt: |
    <Pass/fail criteria specific to this scenario>
```

**3. An `llm_judge` on quality** — proves the tool-call path to that outcome was a clean one. See [Assert correctness *and* quality](#assert-correctness-and-quality) for the rubric to adapt.

Beyond these three, you can add other assertions (`api_call`, `cost`, `time_limit`) — see [Assertion Types](#assertion-types) for the full catalog.

### Example

```yaml
name: domains/domain-search-purchase-and-connect
description: Verifies the agent reads the domain-search-purchase-and-connect docs when asked about purchasing a new domain or connecting a domain that the user already owns.
triggerPrompt: I want to purchase a domain and connect it to the Wix site.
tags: [domains]
maxTokens: 25000
assertions:
  - tool: ReadFullDocsArticle
    params:
      articleUrl: https://dev.wix.com/docs/api-reference/account-level/domains/skills/domain-search-purchase-and-connect
  - type: llm_judge
    minScore: 7
    maxTokens: 2048
    prompt: |
      The user's request: "I want to purchase a domain and connect it to the Wix site."
      Intent: brainstorm a domain name, purchase it and / or connect a domain to the Wix site.

      Pass if the response:
      - mentions the domain availability OR
      - suggests domain list OR
      - mentions user's sites list OR
      - domain prices       

      Fail if the response:
      - is generic with no specific endpoints or method names, OR
      - hallucinates endpoints not in the Wix Domains Management API, OR
      - describes a different Wix feature (e.g. domain connection rather than purchase).
```

Top-level `maxTokens` is enforced by this repository's GitHub Actions gate after the PR-vs-production eval comparison finishes. It applies to the PR run's total tokens for the whole scenario. This is different from `llm_judge.maxTokens`, which is passed to the judge model as an output/config limit for that assertion only.

### Site provisioning (optional)

By default a scenario runs against a shared test site. To run against a **fresh, isolated site** instead, add a `siteSetup` block (a **site template**). The site is provisioned before the run, its ID is made available to the agent, and it is torn down afterward.

```yaml
siteSetup:
  mode: template                 # optional — 'template' is the only mode, and the default
  templateId: stores-v3-editor   # Wix template alias or template GUID
  bootstrap:                     # optional — seed data into the fresh site
    steps:
      - label: seed a product
        method: post             # get | post | put | patch | delete
        url: https://www.wixapis.com/stores/v3/products
        body:
          product:
            name: Demo Product
            productType: PHYSICAL
            physicalProperties: {}
            variantsInfo:
              variants:
                - price: { actualPrice: { amount: "42.50" } }
                  physicalProperties: {}
                  visible: true
```

- `siteSetup.templateId` — a Wix template alias (e.g. `stores-v3-editor`, `blank-editor`, `bookings-editor`) or a template GUID.
- `bootstrap.steps` — ordered HTTP calls run against the new site before the agent runs. They are fail-fast: a non-2xx step fails the run.
- Do **not** use a `{{site-id}}` run variable in `triggerPrompt` together with `siteSetup` — the provisioned site supplies the id.

## Adding a Wix App Eval Scenario

Every `wix-app` skill change should be covered by an **eval scenario** — a YAML file describing a realistic build request and how to verify the agent handled it. `wix-app` scenarios are the **source of truth** in the repo and sync to EvalForge on merge (see [wix-app scenarios: sync on merge](skill-evaluation.md#wix-app-scenarios-sync-on-merge)); they're selected by **tag**.

### Where to put it

Put the scenario under `yaml/wix-app-evals/` — flat, or grouped into area subfolders. Each scenario's `name` must be unique across the tree, lowercase, and may contain `/`, `_`, `-`.

### Required fields

On top of the [common fields](#common-scenario-fields):

| Field | What it is |
|---|---|
| `tags` | An array of one or more tags for the reference files / areas the scenario depends on (e.g. `[dashboard-page]`, `[dashboard-plugin]`, `[service-plugin]`, `[editor-react-component]`, `[data-collection]`). Tags drive which scenarios re-run when a reference file changes — see [Tagging](#tagging). |
| `templateId` | Optional **file template** — scaffolds the run's starter project/app from an EvalForge template (id or alias). See [File templates](#file-templates). |

### Tagging

Tags aren't just for grouping — they drive **coverage**. When a reference file under `skills/wix-app/references/**` changes, the eval gate re-runs every scenario carrying that file's tag. Tagging is therefore how the repo knows *which scenarios must run for a given change*.

The convention:

- **One tag per reference file, derived from its filename** — lowercase, `_` → `-`, drop the `.md`. So `references/DASHBOARD_PAGE.md` → `dashboard-page`, `references/SERVICE_PLUGIN.md` → `service-plugin`. Broader area tags (e.g. `data-collection`) are fine on top when a scenario exercises a cross-cutting capability.
- **Tag every reference file the scenario depends on — including files whose behavior it deliberately *avoids*.** This is **many-to-many**: a file maps to many scenarios (all carrying its tag), and a scenario carries many tags. A scenario that must **not** create a dashboard page still tags `[dashboard-page]`, so it re-runs when `DASHBOARD_PAGE.md` changes and proves the "don't create it" path still holds. That's a **negative dependency** — and it's why a plain "the scenario builds X → tag X" rule isn't enough.
- **Whether the file *should* or *shouldn't* be used lives in the assertions, not the tag.** The tag decides *when a scenario runs*; the assertions decide *what passing means*. Require a file was read with `skill_was_called` + `referenceFiles`; require it was **not** read with `negate: true`; and prove the actual behavior with the `llm_judge`.

**Positive dependency** — must build a dashboard page (must use `DASHBOARD_PAGE.md`):

```yaml
tags: [dashboard-page]
assertions:
  - type: skill_was_called
    skillNames: [wix-app]
    referenceFiles: { wix-app: [references/DASHBOARD_PAGE.md] }
  - type: llm_judge
    minScore: 7
    prompt: |
      The app must include a working dashboard page. ...
```

**Negative dependency** — must **not** create a dashboard page, but still re-runs when `DASHBOARD_PAGE.md` changes:

```yaml
tags: [dashboard-page]        # same tag → re-runs on DASHBOARD_PAGE.md changes
assertions:
  - type: skill_was_called    # the skill is still used (for whatever it does build)
    skillNames: [wix-app]
  - type: skill_was_called    # ...but the dashboard-page reference must NOT be used
    skillNames: [wix-app]
    referenceFiles: { wix-app: [references/DASHBOARD_PAGE.md] }
    negate: true
  - type: llm_judge           # the behavioral proof: no dashboard page was created
    minScore: 7
    prompt: |
      The app must NOT contain a dashboard page. ...
```

### Assertions to include

Cover all three of [coverage, correctness, and quality](#assert-correctness-and-quality):

**1. A `type: skill_was_called` assertion** — proves the agent actually invoked the skill:

```yaml
- type: skill_was_called
  skillNames: [wix-app]
  # optionally require specific reference files were read:
  # referenceFiles: { wix-app: [references/DASHBOARD_PAGE.md] }
```

**2. An `llm_judge` on correctness** — proves the agent's output was substantively correct, not just that it loaded the skill.

```yaml
- type: llm_judge
  minScore: 7
  prompt: |
    <Pass/fail criteria specific to this scenario>
```

**3. An `llm_judge` on quality** — proves the path to that output was a clean one. See [Assert correctness *and* quality](#assert-correctness-and-quality) for the rubric to adapt.

Beyond these three, `wix-app` scenarios often add `build_passed`, and you can use `token_count`, `cost`, or `time_limit` — see [Assertion Types](#assertion-types) for the full catalog.

### File templates

A `wix-app` scenario usually scaffolds its starter project from a **file template** — the top-level `templateId`, an EvalForge template (id or alias). It maps to `templateId` on the EvalForge run:

```yaml
templateId: 33f2cb85-054e-4281-b617-3bc21ac0803f
```

This is the **default template all wix-app runs start from**.

(Distinct from the wix-manage **site template**, `siteSetup`, which provisions a live Wix site — see [Site provisioning](#site-provisioning-optional). The current `wix-app` scenarios use only the file template.)

### Example

See [`yaml/wix-app-evals/employee-shift-dashboard.yml`](../yaml/wix-app-evals/employee-shift-dashboard.yml) for a real scenario — it also demonstrates the negative-dependency pattern from [Tagging](#tagging) above (asserting `AUTO_PATTERNS_DASHBOARD.md` and `DATA_COLLECTION.md` were used, and `DASHBOARD_PAGE.md` was not).

## Common Scenario Fields

Every eval scenario — `wix-manage` or `wix-app` — has these fields. Each skill's *Required fields* adds its own `tags` and template rows on top.

| Field | What it is |
|---|---|
| `name` | A stable identifier, conventionally `<area>/<name>`. Must be unique within its evals tree, lowercase, and may contain `/`, `_`, `-`. |
| `description` | One or two sentences describing what the scenario verifies. |
| `triggerPrompt` | The natural-language request you'd expect a real user to make. Minimum 10 characters. |
| `maxTokens` | Optional top-level PR-run token budget for this scenario. If the PR eval run exceeds this total token count, the GitHub Actions gate fails. |
| `assertions` | A non-empty array of assertions that decide whether the scenario passed (schema requires at least one). Combine a coverage assertion with an `llm_judge` on correctness and an `llm_judge` on quality — see [What a Scenario Must Test](#what-a-scenario-must-test) and [Assertion Types](#assertion-types). |

## Assertion Types

Assertions decide whether a scenario passed; the schema requires at least one, and you should combine a coverage assertion with an `llm_judge` on correctness and an `llm_judge` on quality. You can mix any of these in a single scenario:

| Assertion | Skill | What it does |
|---|---|---|
| tool-call (`tool:` field, type `tool_called_with_param`) | `wix-manage` | **Coverage** — asserts the agent invoked the skill via the specific tool call that loads its doc (e.g. `ReadFullDocsArticle`). Substring matching on string values. |
| `type: skill_was_called` | `wix-app` | **Coverage** — proves a skill was invoked by name (`skillNames`); optional `referenceFiles` requires specific reference docs were read. |
| `type: llm_judge` | both | An LLM rubric that scores the run 0–10 against your `prompt`. Use one for correctness and a second for the quality of the tool-call path. Set `browserTools: true` to let the judge drive a provisioned site's published URL. |
| `type: build_passed` | `wix-app` | Runs a build command (`command`, default `npm run build`) and checks the exit code; use when the scenario generates a buildable app. |
| `type: token_count` | `wix-app` | Fails if total LLM token usage exceeds `maxTokens`. |
| `type: api_call` | both | Makes an HTTP request after the scenario runs and validates the response (end-to-end state checks). |
| `type: cost` | both | Fails if the run exceeded a USD cost ceiling. |
| `type: time_limit` | both | Fails if the run exceeded a duration ceiling. |
