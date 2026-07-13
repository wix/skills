---
name: wix-auth
description: "Authenticate with Wix to obtain an access token for calling Wix APIs. Use when an agent needs a valid Wix access token and has none, or when the stored token is expired."
---

# Wix Auth

Wix supports multiple authentication flows. This skill currently covers:

- [Device Flow](references/device-flow.md) — interactive login via browser, no client secret required. Use when the agent is acting on behalf of a logged-in Wix user.

Other flows (OAuth authorization code, API key) are documented at [https://www.wix.com/skills/docs](https://www.wix.com/skills/docs).
