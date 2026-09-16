<!-- evalforge-skill-review-action -->
## 🤖 Skill Review

<sub>✅ Review job completed</sub>

**1 blocking, 1 fix-before-merge** · `abcdef1` · 3 files

### `skills/wix-manage/references/stores/create-bundle.md`

- 🔴 **blocking** — [line 12](../blob/abcdef1234567890/skills/wix-manage/references/stores/create-bundle.md#L12) · [stay-agnostic-to-agent-and-client](../blob/main/CONTRIBUTING.md#stay-agnostic-to-agent-and-client)
  > call ReadFullDocsArticle to fetch the schema

  An agent without that tool reads an instruction it cannot follow.

- 🟡 **fix-before-merge** — [line 44](../blob/abcdef1234567890/skills/wix-manage/references/stores/create-bundle.md#L44)
  > The response contains the bundle and its items.

  An agent cannot tell which field the next call reads, so it guesses or goes back to the docs for it.

  **Instead:** The response returns `bundle.id`, which the publish call takes as `bundleId`.

_Comment `/review` to review the current commit again._