---
name: Verify Rawdocs Second Dummy Skill
description: Second test fixture for proving that PR validation fails when a branch adds more than one skill.
---
# Verify Rawdocs Second Dummy Skill

Use this only for validating PR-level skill-count behavior. It is intentionally small and separate from the rawdocs commit-hash override fixture so a test PR can include two changed skills.

## Expected Agent Behavior

When asked to test the second rawdocs dummy skill:

1. Identify this as the second dummy skill in the PR.
2. Explain that it exists to trigger validation that rejects PRs adding more than one skill.
3. Avoid treating this as production Wix eCommerce guidance.
