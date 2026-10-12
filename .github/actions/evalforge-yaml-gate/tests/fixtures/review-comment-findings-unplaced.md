<!-- evalforge-skill-review-action -->
## 🤖 Skill Review · Score: 5/10

<sub>✅ Review job completed · `abcdef1` · 3 files</sub>

`stores/create-bundle` tells the agent to call a tool not every client has.

**🔴 1 blocking, 🟡 2 advisory** — posted as review comments on the changed lines.

> [!NOTE]
> **Not on the changed files** — this PR has no line or file to attach this finding to.
>
> **`skills/wix-manage/references/stores/create-product.md`**
> [line 18](https://github.com/wix/skills/blob/abcdef1234567890/skills/wix-manage/references/stores/create-product.md#L18)
> > Create a product with a name, a price and an image.
>
> Covers the same flow as this skill, so an agent finds two answers to one question.
>
> **Instead:** Fold the image step into `create-product` as an optional first step.
>
> <sub>🟡 **advisory** · [stay-agnostic-to-agent-and-client](https://github.com/wix/skills/blob/main/CONTRIBUTING.md#stay-agnostic-to-agent-and-client)</sub>

_Comment `/review` to review the current commit again._