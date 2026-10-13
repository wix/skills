---
name: "Scan a Wix Site for Accessibility Issues"
description: Run a Wix accessibility scan for a full site, one page, or every page in any supported page collection, including products, blog posts, booking services, events, and restaurant pages. Poll the asynchronous scan to completion, report failed pages separately, retrieve prioritized findings, and use the returned fix guidance to help the user resolve and verify issues.
---

# Scan a Wix Site for Accessibility Issues

Use the public **Accessibility Scans API** to scan the authenticated Wix site and
turn the results into an actionable accessibility report. The API selects the
site from the caller's authorization context; never ask for or send a site ID.

Starting a scan requires the **Manage Accessibility Scans** permission. Reading
collections or previous results does not prove that the caller can start new
work.

## Choose the target

Match the user's words to one target:

| User intent | Target |
|---|---|
| "Scan my site" | Full-site scope |
| "Scan this page" or a specific URL/page | One page, identified by its URL or page ID |
| "Scan all products/blog posts/menu pages/etc." | One supported page collection |

For a generated vertical page, prefer its page URL unless a unique Wix page ID
is already available. The caller never needs to know the page type.

For a collection request, first call **List Accessibility Scan Page
Collections** and match the user's intent to a returned display name. Pass its
`collectionId` unchanged to the scan. Never hardcode a list of verticals or
invent a collection ID: installed apps determine what the site currently
supports.

If the target is ambiguous, ask one short question before starting. An explicit
request to scan, check, or audit is already confirmation to create the scan job.

## Run and read the scan

1. Generate one UUID for this intended scan.
2. Call **Run Accessibility Scan** once and keep the returned scan ID. Reuse the
   UUID only when retrying this exact request; use a new UUID for a new scan.
3. Poll **Get Accessibility Scan** with that scan ID. Respect each response's
   suggested polling interval until the status is terminal.
4. On `COMPLETED` or `PARTIALLY_COMPLETED`, read:
   - the scan summary for totals and executed-rule coverage;
   - **List Accessibility Scan Page Summaries** for every discovered page,
     including clear pages and pages that failed to scan;
   - **List Accessibility Scan Findings** for actionable issues. Follow cursor
     paging for the result set the user requested.
5. On `FAILED`, report the public failure guidance. Do not request findings or
   present the scan as clean.

Use a findings filter when the user asks about one page, rule, severity, or
accessibility category. Do not issue a separate findings request for every page.

## Present actionable results

Lead with the scan status and aggregate totals. Then:

- Report failed pages separately. A failed page with zero findings is
  **unknown**, not clean.
- Prioritize findings by severity, then page and rule.
- For each useful finding, include the affected page and element reference,
  what failed, why it matters, WCAG criteria, remediation summary, and the
  ordered fix and verification steps.
- Use the returned collection and item IDs to identify the owning business
  entity when a generated page must be updated through another public Wix API.
- If `humanInputRequired` is true, explain the decision needed and ask the user
  instead of guessing content, intent, or design.

The scan API reports issues but does not edit the site. Get confirmation before
applying fixes through another API or editor capability. After fixes, run the
same target again with a **new** idempotency key and compare the results.

## Recovery rules

- **Permission denied when starting a scan:** stop after the first `403` or
  `PERMISSION_DENIED`. Do not retry with another URL, request shape, target, or
  site. Explain that the current Wix identity cannot start accessibility scans
  and must be reconnected or authorized with **Manage Accessibility Scans**.
  Never imply that collection discovery means the scan ran.
- **Scan already in progress:** poll the existing scan ID returned by the error;
  do not start a duplicate.
- **Scan state unknown:** read the returned scan ID until its state is known;
  do not start another scan.
- **Rate limited or transient retry:** wait, then retry the same intended run
  with the same idempotency key.
- **Target unavailable:** ask for a valid page or refresh the collection list.
- **Scan size limit exceeded:** never imply the site was fully scanned. Narrow
  the target, preferably into supported page collections, and report the limit.
- **Partially completed:** return the usable findings and clearly list every
  failed page and its failure guidance.
- **Results expired:** start a new scan only when the user still wants fresh
  results.

Load the current public API reference before constructing requests so field
names, filters, permissions, and error schemas come from the live contract.
