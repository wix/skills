---
name: "Calendar — Skill Audit"
description: Per-skill audit table for the calendar L1 domain.
---

# Calendar — Skill Audit

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `configure-default-business-hours.md` | Calendar Events API | Likely Yes (production legacy) | No | **Critical distinction: Calendar Events API (correct) vs Site Properties API (incorrect)** for setting base availability. This is the kind of "wrong API would also have worked but doesn't actually do the thing" trap that justifies a skill. | 📦 Legacy flat |
