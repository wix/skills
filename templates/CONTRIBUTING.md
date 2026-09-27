# Adding a vertical (structure contract)

New verticals follow the same layout under the repository's `templates/` — the deploy script
discovers them automatically (any `templates/<name>/app/` directory is a vertical), and
`node templates/compose.mjs <vertical>` composes its `project/`:

```
templates/<vertical>/
  INSTRUCTIONS.md      # playbook: file map, wiring per stack, what you build, hard rules
  app/                 # framework-agnostic core — disjoint paths so verticals never collide:
    wix/<vertical>/    #   types.ts (DTOs) + data layer (calls via ../sdk, images via ../media)
                       #   + *-store.ts: the state machines, framework-free (ship on every stack)
    hooks/<vertical>/  #   React hooks — thin bindings of the stores (SSR-friendly: accept initial data)
    components/<vertical>/  # routing-free components (plain <a> default + LinkComponent prop)
    styles/global.css  # Tailwind v4 + the @theme design tokens (shared token family)
  app-astro/           # Astro overlay importing ONLY from the core:
    pages/…            #   SSR fetch → DTO props → client:load islands; item pages carry
                       #   wixMetadata + <SEO.Tags>; chrome islands are client:only
                       #   (storefront ships no pages — its INSTRUCTIONS carries their skeletons)
    layouts/…          #   (reuse SiteLayout when it fits)
  seed/                # seed-<vertical>.mjs (REST, mints its own CLI token) + SEED.md
  rest/                # the REST twin of app/wix/<vertical>/: same exports over fetch, importing
                       #   the same *-core.ts (rules + DTO mappers, type-only imports) and types.ts;
                       #   flat ./x.js imports — deploy --stack static composes and strips it
  project/             # composed, not edited: templates/blank/project (the CLI's blank scaffold plus
                       #   its extender's layer) with the vertical deployed and a package-lock.json
```

Core rules the structure encodes: a rule or mapper lives once, in `app/wix/<vertical>/*-core.ts`,
imported by both transports (a call added to `app/` gets its `rest/` twin in the same PR; `tsc`
over both is the parity check); raw API entities never leave the data layer (DTOs only);
client-shared state uses a module-scope store (never React context — it can't span Astro
islands); every image URL is resolved through `src/wix/media.ts`; every money value is a
formatted string by the time a component sees it.
