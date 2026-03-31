# Recipe: AI Image Generation + Wix Media Import

Generate images using OpenAI DALL-E and import them into Wix Media.
This is a **pure utility** — it generates an image and returns the
result. The calling skill owns prompt construction and entity attachment.

> **Conditional:** This section only applies when Wix MCP tools
> are available. If the user declines to provide an API key,
> skip all image generation — products/posts/pages work fine without images.

> **For callers:** This recipe MUST be invoked by the calling skill — do not
> skip it silently. The user should always be asked whether they want to
> provide an API key. Only skip if the user explicitly says no.

## Step 1: Get API Key

Resolve the key in this order — stop at the first hit:

1. **Session context** — if the key was already obtained earlier in this session, reuse it (hold in conversation context)
2. **`.env.local`** — check the project root for `OPENAI_API_KEY=...` and load it
3. **Ask the user** — prompt:

> "I can generate on-brand images for your [products/blog posts/site].
> This requires an OpenAI API key. Would you like to provide one?"
> - Yes — I'll paste my key
> - Skip — I'll add images later

When the user provides a new key:
- Store it for the current session using `export`:
  `export OPENAI_API_KEY="<key>"`
- Persist to `.env.local` for future sessions — use sed to replace any existing value:
  `grep -q '^OPENAI_API_KEY=' .env.local 2>/dev/null && sed -i '' 's/^OPENAI_API_KEY=.*/OPENAI_API_KEY=<key>/' .env.local || echo "OPENAI_API_KEY=<key>" >> .env.local`

**Never echo or log the key.**

## Step 2: Generate Image

Use the exported `$OPENAI_API_KEY` variable in the Authorization header.
The command must start with `curl` so it auto-matches the `Bash(curl:*)` permission.

    curl -s https://api.openai.com/v1/images/generations \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -d '{
        "model": "dall-e-3",
        "prompt": "<PROMPT>",
        "n": 1,
        "size": "1024x1024",
        "quality": "standard",
        "response_format": "url"
      }'

Extract `data[0].url` from the JSON response. This is a temporary
URL (valid ~1 hour) — import to Wix Media immediately.

## Step 3: Import to Wix Media

    CallWixSiteAPI: POST /site-media/v1/files/import
    body: {
      "url": "<temporary-dalle-url>",
      "mimeType": "image/png",
      "displayName": "<descriptive-name>.png"
    }

## Returns

The Wix Media import response contains a `file` object. The calling
skill receives two values:

| Field | Value | Use For |
|-------|-------|---------|
| `file.url` | Full permanent `wixstatic.com` URL | Product media, `<img>` tags, CSS `background-image`, CMS Image fields |
| `file.fileUrl` | File ID (e.g., `9a9cdf_abc123~mv2.png`) | Blog post `media.wixMedia.image.id` field |

The calling skill is responsible for attaching the image to
whatever entity it belongs to (product, blog post, page element).

## Prompt Guidelines

Every prompt should incorporate the full brand context available
from the discover and design phases. Never generate generic images.

### Prompt Structure

1. **Subject** — what the image shows
2. **Brand aesthetic** — the design direction from brand discovery
3. **Color guidance** — reference the brand palette (e.g., "warm cream
   and forest green tones" not generic colors)
4. **Style/mood** — photography style, lighting, composition
5. **Constraints** — always include "no text, no watermarks"

### Context Sources

| Source | What to Extract |
|--------|----------------|
| Discovery plan | Business type, brand name, industry, target audience |
| Design Step 1 (brand discovery) | Aesthetic direction, mood, personality |
| Design Step 2 (design system) | Color palette hex codes from `global.css` |
| Entity being created | Product name/description, blog post title/topic, page purpose |

### Anti-Patterns (NEVER do these)

- Generic prompts without brand context ("a product photo")
- Ignoring the color palette established in global.css
- Using stock-photo language ("diverse team of professionals")
- Requesting text in images (AI-generated text is garbled)
- Same prompt style across different brand aesthetics

## Error Handling

| Error | Action |
|---|---|
| Invalid key (401/403) | Tell user their key is invalid, skip images |
| Rate limit (429) | Wait 10s, retry once. If still failing, skip. |
| Generation fails | Skip this image, continue with others |
| Wix Media import fails | Skip this image, entity gets no image |
| All images fail | Proceed without images |

**Never block the main flow on image generation failure.**
