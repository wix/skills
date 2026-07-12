# AI features — text, chat & embeddings (opt-in, all project types)

Add **generative-AI features** to a headless app using the **Wix AI APIs** (`www.wixapis.com`): LLM
text/chat completions and text embeddings, through the same `$TOKEN`/`$SITE_ID` call shape as every
other Wix call. Wix fronts the model providers (OpenAI, Anthropic) and handles auth + billing, so
you never hold a provider key. **For image generation, see `IMAGE_GENERATION.md`** — same gateway,
same auth, covered there; this file is text + embeddings and the rules that apply to *all* AI calls.

**Opt-in, by intent** — only build AI features when the intent calls for them (a support chatbot, AI
product descriptions, semantic search, summarization…). Like imagery, it's off by default; there's
no fixed slot list. **Status: Developer Preview** — the API shape can change; confirm models with
`/models` (below) rather than trusting a hardcoded list.

## The one hard rule: AI runs server-side only

**Every AI call must be made from server code with an authorized identity. Never from the browser.**
This is enforced at two layers, both verified:

- A **visitor / anonymous token** (the identity a headless frontend holds in the browser) gets
  **`403 Permission denied`** from the gateway. Site **members** are visitor-class too — same denial.
- The `@wix/ai` SDK **throws in browser environments** (*"AI calls from browser code are not
  supported. Move your AI logic to backend code."*) and **elevates** every call to the app/owner
  identity server-side (`auth.elevate`).

So the AI call always sits **behind a server boundary** — a Wix serverless/web-method backend
(managed), or the app's own server (self-managed/stripe). The browser calls *your* endpoint; your
endpoint calls Wix. This boundary is also where you enforce credits/abuse controls (see **Credits &
cost control**) — it is not optional plumbing, it is the security and billing perimeter.

On a **Wix-managed backend** (Astro-on-Wix serverless / web methods) the call is authenticated for
you. On a **self-managed** backend, pass an authenticated `WixClient` (`AppStrategy` or
`ApiKeyStrategy`) — see the SDK path below. Either way the browser only ever calls *your* server
route; that route calls Wix.

> **Building a Wix app** (rather than a site) needs the **`Invoke AI Models`** permission on the app —
> see [About the Wix AI APIs](https://dev.wix.com/docs/api-reference/articles/ai-tools/ai-apis/about-the-wix-ai-apis).

## Call shape (REST — primary)

The gateway is a **transparent pass-through** to each provider: base URL is
`https://www.wixapis.com/{provider}/v1/...` and the **request/response bodies are the provider's
native shape** — model params, streaming, tool calls all follow the provider's own docs, not a Wix
schema. Use the skill's universal call shape (`SETUP.md` §1) with the server-side `$TOKEN`/`$SITE_ID`:

```bash
curl -sS -X POST "https://www.wixapis.com/{provider}/v1/{path}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" \
  -d '<provider-native body>'
```

(`wix-site-id` is accepted-but-not-required for AI calls — the token is already site-scoped — but
include it for consistency with every other call in the skill.)

## Text & chat generation

| Provider | Path | Body / docs |
|---|---|---|
| OpenAI | `POST /openai/v1/responses` | OpenAI **Responses API** (`{ "model", "input" }`) |
| OpenAI | `POST /openai/v1/chat/completions` | OpenAI **Chat Completions** (`{ "model", "messages":[…] }`) |
| Anthropic | `POST /anthropic/v1/messages` | Anthropic **Messages** (`{ "model", "max_tokens", "messages":[…] }`) |

```bash
# OpenAI chat
curl … -X POST "https://www.wixapis.com/openai/v1/chat/completions" \
  -d '{"model":"gpt-5-nano","messages":[{"role":"user","content":"Write a 1-line product tagline"}]}'

# Anthropic messages — NOTE the required version header
curl … -H "anthropic-version: 2023-06-01" \
  -X POST "https://www.wixapis.com/anthropic/v1/messages" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}'
```

- **Anthropic requires the `anthropic-version: 2023-06-01` header.** Omitting it → `400 anthropic-version:
  header is required` (the public doc's curl example omits it — don't copy that).
- **Streaming**: set `"stream": true` — the response is SSE (`data:` lines), provider-native. Only
  useful if your server streams to the client (e.g. SSE/Response stream); a one-shot seed/build call
  doesn't need it.

## Embeddings (semantic search, similarity)

```bash
curl … -X POST "https://www.wixapis.com/openai/v1/embeddings" \
  -d '{"model":"text-embedding-3-small","input":"The food was delicious but the waiter was rude."}'
# → data[0].embedding : number[]  (text-embedding-3-small = 1536 dims)
```

`input` may be a string or an array of strings (batch). Store vectors in a Wix Data/CMS collection
(or an external vector store) and compare with cosine similarity for search/recommendations.

## Models — query, don't hardcode

`GET /{provider}/v1/models` is the **source of truth** (Anthropic needs the version header). New
provider models land on Wix a few days after release; some ids are **date-stamped**. Tested-current
picks (verify with `/models`):

- **OpenAI text**: `gpt-5.2`, `gpt-5.2-pro`, `gpt-5.1`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`,
  `gpt-4.1-mini`, `gpt-4.1-nano`.
- **OpenAI embeddings**: `text-embedding-3-small` (1536), `text-embedding-3-large`, `text-embedding-ada-002`.
- **Anthropic**: `claude-opus-4-8`, `claude-sonnet-5`, `claude-opus-4-7`, `claude-sonnet-4-6`,
  **`claude-haiku-4-5-20251001`** — the *dated* id. **`claude-haiku-4-5` (undated) → `400 Unsupported
  model`**; use the dated id `/models` returns.

## SDK path (`@wix/ai` — typed alternative, backend only)

Built on the [Vercel AI SDK](https://ai-sdk.dev). Same gateway, same permission model — just typed
and with elevation handled for you. **Backend only** (it throws in the browser).

```bash
npm install @wix/ai "ai@>=6.0.26" "zod@>=4.1.8"
```

```js
// Wix-managed backend (Astro-on-Wix serverless / web method): auth is elevated automatically
import { generateText } from "ai";
import { openai } from "@wix/ai";              // or: anthropic, runware
const { text } = await generateText({ model: openai("gpt-5.2"), prompt: "…" });

// Self-managed / stripe: pass an authenticated client (needs the Invoke AI Models scope)
import { createOpenAI } from "@wix/ai";
import { createClient, AppStrategy } from "@wix/sdk";  // or ApiKeyStrategy
const client = createClient({ auth: AppStrategy({ appId, appSecret, instanceId }) });
const openai = createOpenAI({ client });
```

Methods (from `ai`): `generateText` / `streamText` (text), `embed` / `embedMany` (embeddings),
`generateImage` (images). `@wix/ai` exports `openai`, `anthropic`, `runware` (ambient, Wix-managed)
and `createOpenAI`, `createAnthropic`, `createRunware` (client-injected, self-managed). **Exact model
selectors** (verified — don't guess the method names):

- **Text:** `openai("gpt-5.2")` or `openai.responses(id)` / `openai.chat(id)`; `anthropic("claude-…")`.
- **Embeddings:** `openai.embeddingModel("text-embedding-3-small")` — **not** `textEmbeddingModel` (that
  method doesn't exist and throws). Returns `embeddings[i]` as `number[]` (1536 dims for `3-small`).
- **Images:** `runware.image("<air-id>")`. `generateImage` returns `{ image }` with `image.base64` +
  `image.mediaType` — build a data URL (`data:${mediaType};base64,${base64}`) or import to Wix Media.
  In `ai` v7 the fn may be exported as `experimental_generateImage`; fall back to it if `generateImage`
  is undefined.

> **Runware via the SDK — model gotcha (verified):** `google:4@2` (Nano Banana) **fails via the SDK**
> ("Unknown Runware API error" — the Vercel provider injects params it rejects), even though it works
> on the raw REST proxy. Use **`bfl:5@1`** (FLUX.2 Pro) or **`runware:100@1`**. Runware is also
> **intermittently flaky** — wrap image calls in a **retry + model fallback** (`bfl:5@1` → `runware:100@1`)
> so a transient blip doesn't surface to the user. See `IMAGE_GENERATION.md` for the REST path.

**REST vs SDK:** prefer **REST** to stay consistent with the rest of the skill's `curl` flow and for
seed/build-time calls; reach for the **SDK** when the frontend is a JS/TS server (Astro-on-Wix, Node)
that already uses `@wix/*` and wants typed calls + auto-elevation. **Wiring to the browser:** expose a
**server route (or action) that returns plain JSON** and have the browser `fetch` it — the AI runs in
that route; the browser never touches the gateway.

## Credits & cost control — the gap you MUST design for

**AI usage is billed to the site *owner's* account, never to the end user.** This is structural, not
a setting:

- AI credits belong to the **account's Premium plan**, shared across the whole account; monthly
  allowance by tier, **no rollover** (free plan ≈ 30/day, 120/mo). Each call ≈ **1 credit** (varies
  by model/size); the platform meters every call and **blocks when the account balance runs out**.
- Because every AI call is **elevated to the owner/app identity** (that's the only identity the
  gateway accepts), **there is no per-visitor or per-member credit pool.** A visitor who triggers an
  AI feature spends the *owner's* credits.

**Consequence:** any AI feature exposed to end-users (a public chatbot, "generate my bio", etc.) lets
anonymous traffic **drain the owner's credits** — and gives you no built-in way to attribute or cap
usage per end-user. The platform will not solve this for you. **The app must own a metering layer.**

When AI is exposed to end-users, build these into the **server boundary** (the same endpoint that
holds `$TOKEN`) — don't ship AI to end-users without them:

1. **Gate access** — require an authenticated member (or your own key) for anything that costs
   credits; don't wire AI to a fully-open public route by default.
2. **Rate-limit & quota per identity** — track calls per member/session/IP in a Wix Data/CMS
   collection; **check-and-decrement before the AI call**, reject over quota (re-check after, since
   the credit balance is account-wide).
3. **Cap inputs** — bound prompt/`max_tokens`/`input` size; large requests cost more credits.
4. **Cache / dedupe** — memoize identical prompts (product description for the same product, etc.);
   many "AI features" are computed once at seed/build time, not per request — prefer that when the
   content is static.
5. **Fail soft** — on `403`/quota/`insufficient credits`, degrade gracefully (cached/canned copy),
   never hard-error the page; surface cost transparently to the owner.

> If the user wants true **per-end-user AI budgets** (e.g. "each member gets N generations/month"),
> that is an **applicative feature to build** — a usage-ledger collection keyed by member, enforced
> server-side — because Wix bills only the owner and offers no per-visitor pool. Call this out to the
> user rather than implying the platform meters end-users.

## Failure ladder

| Symptom | Cause → fix |
|---|---|
| `403 Permission denied` | Called with a visitor/member token, or from the browser. **Move the call server-side** with an authorized identity. |
| `403 Forbidden` (server identity) | Building a Wix **app**: add the `Invoke AI Models` permission to the app (see the AI-APIs doc). |
| `400 anthropic-version: header is required` | Add `-H "anthropic-version: 2023-06-01"`. |
| `400 Unsupported model` | Use the exact id from `/{provider}/v1/models` (Anthropic ids are often date-stamped, e.g. `claude-haiku-4-5-20251001`). |
| `Unknown Runware API error` (images) | Transient, or the model rejects SDK params (`google:4@2`). Retry + fall back to `bfl:5@1` / `runware:100@1`. |
| insufficient credits / quota | Account is out of AI credits — degrade soft; tell the owner. |

## See also
- `IMAGE_GENERATION.md` — image generation (Runware) via the same gateway/auth.
- Live docs: `dev.wix.com/docs/api-reference/articles/ai-tools/ai-apis/about-the-wix-ai-apis` (+ `…/set-up-the-wix-ai-sdk`).
- Provider request/response params: OpenAI & Anthropic API references (the gateway is pass-through).
