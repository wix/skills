---
name: custom-blog-wiring
description: "Integration-mode wiring subagent for the blog capability. Connects a brought-in static site's article markup to Wix Blog — replaces hard-coded post cards/snippets with live @wix/blog queries, rendered into the existing DOM template, client-side via @wix/sdk from CDN. Ricos rich content rendered to HTML on the client."
---

# Blog wiring (integration mode)

You wire the **blog capability** into a brought-in static site (`frontend = "custom"`). Replace hard-coded post snippets with live `@wix/blog` posts, rendering into the existing markup. Client-side vanilla JS, `@wix/sdk` from CDN, no build. Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline", and `references/custom/stores/WIRING.md` § "The read-and-render pattern" — blog reuses it; only the entity differs.

## Inputs

- **`appId`** — `OAuthStrategy` `clientId`.
- **Binding-map entries** for `blog.posts` (list and/or `detail`).
- **Seeded post IDs/slugs** (from Seed).

## List

```html
<script type="module">
  import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk@1";
  import { posts } from "https://esm.sh/@wix/blog@1";

  const wix = createClient({ modules: { posts }, auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }) });

  const list = document.querySelector("[data-blog-list], .post-list");   // binding-map anchor
  const tpl  = list?.querySelector(".post-card");                         // binding-map template
  if (list && tpl) {
    try {
      const { posts: items } = await wix.posts.queryPosts().limit(10).find();
      const proto = tpl.cloneNode(true);
      list.replaceChildren(...items.map((post) => {
        const card = proto.cloneNode(true);
        const t = card.querySelector(".title");   if (t) t.textContent = post.title ?? "";
        const ex = card.querySelector(".excerpt"); if (ex) ex.textContent = post.excerpt ?? "";
        const link = card.querySelector("a");      if (link && post.slug) link.href = `/post/${post.slug}`;
        const img = card.querySelector("img");     if (img && post.media?.wixMedia?.image) img.src = post.media.wixMedia.image.url ?? img.src;
        return card;
      }));
    } catch (err) { console.error("[wix-blog] post query failed:", err); }
  }
</script>
```

Apply the binding-map's actual selectors/field paths.

## Detail + Ricos

For a `detail` region (slug from `location.pathname`): `wix.posts.getPostBySlug(slug)` (or `queryPosts().eq("slug", slug)`), bind title/date, and render the post's **rich content**. Ricos content (`post.richContent`) is a structured document — render it to HTML client-side with `@wix/ricos` (`import { RicosViewer } from "https://esm.sh/@wix/ricos@1"` is React-based; for a no-framework site prefer the post's pre-rendered HTML field when available, else mount a minimal Ricos-to-HTML conversion). If rich rendering is heavy for a static site, bind the post's plain `contentText`/HTML excerpt and link out. **Note this tradeoff in the return.**

## Discipline & return

Additive; render into the existing template; inline `appId`; guard calls (samples are the fallback). Return per `shared/RETURN_CONTRACT.md`: files edited, anchors wired, whether full Ricos or excerpt rendering was used.
