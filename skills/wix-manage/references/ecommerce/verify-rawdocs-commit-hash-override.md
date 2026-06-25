---
name: Verify Rawdocs Commit Hash Override
description: Test fixture for checking that rawdocs can load eCommerce article content from a specific commit hash and that an MCP docs override can surface that content.
---
# Verify Rawdocs Commit Hash Override

Use this only for validating docs override behavior. It is intentionally small so a PR can prove that changed skill content and YAML metadata are served from the override commit.

## Rawdocs Request Under Test

Use this rawdocs request as the known target:

```text
https://dev.wix.com/rawdocs/api/get-article-content?articleUrl=https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/introduction&repo=wix-private/ecom&commitHash=c7cfe260f71533ebeac80e7ae88e610ddbd7d083
```

## Expected Agent Behavior

When asked to test the eCommerce rawdocs commit-hash override:

1. Preserve the exact `articleUrl`, `repo`, and `commitHash` values from the request.
2. Explain that the response should come from `wix-private/ecom` at commit `c7cfe260f71533ebeac80e7ae88e610ddbd7d083`.
3. State whether the article content loaded successfully, or report the rawdocs error without substituting main-branch docs content.
4. If used through MCP override testing, mention the override commit or PR SHA that supplied this skill content.
