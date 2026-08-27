---
name: rp-preflight
description: Validates the selected source and destination configuration before discovery.
---

# rp-preflight

Run the deterministic preflight helper before discovery:

```bash
node skills/wix-replatform/scripts/orchestration-preflight.js <projectDir>
```

Use its structured result as authority. When it reports missing source configuration or
credentials, route to `rp-source-inputs`; when it reports a destination issue, route to
`rp-destination`. Do not begin discovery with a blocked preflight.
