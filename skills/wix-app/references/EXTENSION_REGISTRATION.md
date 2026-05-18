
# Extension Registration

`src/extensions.ts` is the single entry point that tells the build system which extensions exist. Without a `.use()` call for an extension, it does not load.

## Registration is automatic via the CLI

For every CLI-supported extension type, `wix generate --params` updates `src/extensions.ts` for you — you do NOT need to write the import or the `.use()` call by hand. Verify the file was updated after each `wix generate` invocation.

## Extension types that require manual registration

| Type | Why manual |
| --- | --- |
| **Backend API** | Astro endpoints under `src/pages/api/` are auto-discovered by the runtime. They do not need to be added to `src/extensions.ts`. |

Every other extension type is wired up automatically by the CLI.

## Naming Conventions (for reading existing code)

The CLI generates export names following `{extensiontype}{CamelCaseName}`:

- `dashboardpageCartPopupManager`
- `dashboardpluginBlogPostsBanner`
- `dashboardmenupluginExportPosts`
- `embeddedscriptCouponPopup`
- `customelementwidgetCountdownWidget`
- `sitepluginProductBadge`
- `ecomshippingratesCustomShipping`

The type prefix is the extension type in lowercase with no separators. Useful when reading or debugging an existing `extensions.ts`.

## Manual recovery (when the CLI output drifts)

Edit `src/extensions.ts` directly only when:

- The CLI failed mid-run and left the file out of sync
- A user hand-edited the file and broke the chain
- You're adding a Backend API helper (uncommon)

Pattern:

```typescript
import { app } from "@wix/astro/builders";
import { dashboardpageMyPage } from "./extensions/dashboard/pages/my-page/extensions.ts";
import { eventContactCreated } from "./extensions/backend/events/contact-created/extensions.ts";

export default app()
  .use(dashboardpageMyPage)
  .use(eventContactCreated);
```

Re-run `wix generate --params` whenever possible — manual edits drift faster than CLI-generated ones.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Extension not appearing at all | Missing `.use()` call | Re-run `wix generate --params`; if that's not possible, add the import + `.use(extensionName)` |
| "Cannot find module" on build | Wrong import path | Verify the path matches the actual file location (relative to `src/`) |
| Extension registered but not working | Export name mismatch | Ensure the exported name in the extension file matches the import in `extensions.ts` |
| Multiple extensions, only some work | Incomplete chain | Check every extension has both an import and a `.use()` call |
| TypeScript error on `.use()` | Wrong builder method | Ensure the extension file uses the correct builder (e.g., `extensions.dashboardPage()` not `extensions.embeddedScript()`) |
