---
name: rp-source-inputs
description: Collects and validates source URLs, exports, acquisition modes, and credentials without exposing secrets.
---

# rp-source-inputs

Use only when the active source input/configuration is missing or invalid.

For URL sources, infer platform from the URL/probe before asking the user; ask for a
platform only when detection is inconclusive. For platforms with public and authenticated
paths, resolve the acquisition mode before requesting credentials.

When `managementImportMode=quick`, persist the probe's canonical platform id in
`sourcePlatform` and route to the matching `rp-quick-<platform>` adapter. Quick mode uses only
the adapter's declared public endpoints and must not request source credentials. An
inconclusive probe or unsupported adapter is a durable `quick_mode_unsupported` result; offer
standard mode rather than silently switching behavior.

For file sources, record every supplied path as `fileInputPaths`, use `sourceMode=files_only`,
and load `rp-source-csv`. Do not ask URL acquisition or credential questions for this path.

Treat source and Wix env files as secret-bearing once they may contain credentials. Never
print their contents. Use `scripts/source-secrets.js` for present/blank/missing checks and
Wix Secrets Manager hydration; request only unresolved secret keys through the secure flow.
Blank required values are a typed needs-user blocker; optional adapter keys may remain blank.
