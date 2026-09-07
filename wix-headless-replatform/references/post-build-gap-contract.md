# Post-build gap analysis and fix contract

The first successful build is a comparison candidate, not the end of the clone.

## Run the result extraction

Start the generated project and keep its local URL available, then run:

```bash
node scripts/post-build-gap.mjs <source-url> \
  --out projects/<project-name> \
  --result-url http://localhost:<port>/
```

The command reuses the capture primitives for the home result route. It captures the result's
desktop/tablet/mobile screenshots, page and section evidence, assets, fonts, SEO, interactions,
design tokens, scene contract, control-state contract, visual assets, layout blueprint, and UI
normalization evidence. Source contracts are read through `extraction/latest.json` and its
immutable frozen manifest; builders and QA do not read or recapture source observations as a
substitute for a missing spec fact. Result evidence is isolated under the numbered gap iteration
and never replaces the frozen extraction.

If Chromium launch is blocked by the execution environment, that is a recovery case before
it is a blocker: rerun the command with the required browser-launch escalation (or from a
normal local shell/session that permits Playwright to launch) before treating the gap run
as failed.

## Deterministic comparison vocabulary

Findings use these categories:

- `dimensions`: full-page/section height, normalized region geometry, important text width,
  line count, and logo size;
- `images`: source image/video/logo identity, count, role, and placement;
- `layout`: route and section coverage, section order, composition, background model, and
  media ownership;
- `text`: visible headings, body copy, labels, tabs, and CTAs;
- `interactions`: source core behavior not observed in the running result.

Severity means:

- `critical`: missing route or identity-bearing brand media;
- `high`: source intent or a major layout/interaction is wrong;
- `medium`: meaningful supporting geometry/style differs beyond tolerance;
- `low`: review or cleanup that does not materially change identity.

Exact requirements and tolerance ranges are embedded in `gap-analysis.json`. Do not turn
this into a universal pixel-diff gate. Consent infrastructure, different video frames,
font antialiasing, timestamps, and small crop/compositing differences are non-blocking unless
they change layout or page intent.

## Required screenshot judgment

The deterministic report creates `screenshotPairs[]` with source and result paths. Open every
pair at original size, at all captured viewports. Review the page section by section and add
only identity-affecting visual findings to the canonical iteration report referenced by
`latest.json.paths.reportJson`, using the same finding schema.

Write `iterations/<NNN>/visual-review.json` using this shape (one record for every pair):

```json
{
  "pairs": [
    {
      "pairId": "home-desktop",
      "viewport": "desktop",
      "observation": "Hero dog is substantially larger than the source and obscures the title.",
      "verdict": "findings-recorded",
      "findingIds": ["gap-041"]
    },
    {
      "pairId": "home-mobile",
      "viewport": "mobile",
      "observation": "Header hierarchy, hero composition, and visible section order match source identity.",
      "verdict": "no-identity-gap",
      "rationale": "Only harmless antialiasing differences remain."
    }
  ]
}
```

After review, run:

```bash
node scripts/finalize-gap-review.mjs <source-url> \
  --out projects/<project-name>
```

The finalizer rejects missing, duplicate, unknown, or incomplete records; verifies linked
finding IDs against the canonical report; synchronizes the canonical report, latest pointers,
and iteration manifest; and recomputes acceptance.

## Gap fix phase

Use `gap-fix-plan.md` in this order:

1. missing page/section;
2. text, logos, and source media;
3. major section composition and background/media ownership;
4. important dimensions, line counts, and responsive geometry;
5. core interactions and initial states;
6. supporting spacing and styling.

Fix the implementation rather than weakening tolerances or editing extracted result evidence.
For a new iteration following open critical/high findings, complete the generated
`visual-progress.json`. It must give every prior blocking finding a named section target plus
the matching canonical source, prior-result, and current-result screenshot paths; record visible
before/after observations and an `improved`, `no-visible-improvement`, or `regressed` verdict.
The finalizer rejects incomplete or untraceable proof, and an accepted resolution requires
`improved`. Build again, rerun `post-build-gap.mjs` to create the next immutable iteration,
inspect its new screenshot queue, and finalize the review. Run at most two fix passes by default.
Each owned extraction gap receives at most two distinct targeted recovery attempts. Repeating
the same tactic without new evidence is not progress. After exhaustion, keep the unit
provisional and continue unrelated work. Report what could not be imported reliably, why, and
the user's post-assembly choices instead of treating a local gap as a global blocker.

Completion requires:

- the latest build succeeds;
- visual review is `reviewed` (or legitimately `not-applicable`);
- no open critical or high findings remain;
- interaction QA passes for core scenes;
- residual medium/low and provisional extraction gaps are summarized rather than hidden;
- `final-report.json` and `.md` identify every unresolved/user-accepted gap;
- local gaps end as `done_with_gaps`; only a global blocker ends as blocked.
