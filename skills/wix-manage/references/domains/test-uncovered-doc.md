---
name: "Test Uncovered Doc"
description: Placeholder doc added by test T1 to verify the gate flags missing coverage. Not a real reference.
---
# Test Uncovered Doc

This file exists only to exercise the gate's missing-coverage path. It deliberately has no matching scenario YAML under `yaml/wix-manage-evals/domains/`. The gate should fail the PR and post a Missing Coverage comment pointing at this file.
