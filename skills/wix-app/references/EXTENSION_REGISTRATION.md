
# Wix App Registration

After creating any extension file, you must update the main `src/extensions.ts` file to register the extension with the app.

## Why Registration Matters

The Wix CLI discovers extensions through the `src/extensions.ts` file — it's the single entry point that tells the build system which extensions exist. Without registration:

- Dashboard pages won't appear in the sidebar
- Site widgets won't show in the Wix Editor
- Service plugins won't be called during checkout flows
- Event handlers won't receive webhook deliveries
- Embedded scripts won't be injected into site pages

The most common cause of "my extension isn't working" is a missing `.use()` call in this file.

## Simple Pattern (Recommended for Small Apps)

**`src/extensions.ts`** - Import and register extensions directly:

```typescript
import { app } from "@wix/astro/builders";
import { dataExtension } from "./extensions/data/extensions.ts";
import { dashboardpageMyPage } from "./extensions/dashboard/pages/my-page/extensions.ts";
import { embeddedscriptMyScript } from "./extensions/site/embedded-scripts/my-script/extensions.ts";

export default app()
  .use(dataExtension)
  .use(dashboardpageMyPage)
  .use(embeddedscriptMyScript);
```

**Steps for each new extension:**

1. Import the extension from its `extensions.ts` file
2. Add `.use(extensionName)` to the app chain
3. Chain multiple extensions together

## Advanced Pattern (For Large Apps)

**`src/index.ts`** - Re-export all extensions:

```typescript
export { dashboardpageMyPage } from "./extensions/dashboard/pages/my-page/extensions";
export { embeddedscriptMyScript } from "./extensions/site/embedded-scripts/my-script/extensions";
export { dataExtension } from "./extensions/data/extensions";
```

**`src/extensions.ts`** - Register all extensions programmatically:

```typescript
import { app } from "@wix/astro/builders";
import * as allExtensions from "./index";

const extensionList = Object.values(allExtensions);

const appBuilder = app();
extensionList.forEach((extension) => {
  appBuilder.use(extension);
});

export default appBuilder;
```

## Extension Types Without Registration

The following extension types do **not** require `extensions.ts` files:

- **Backend API** - Astro server endpoints are auto-discovered

## Naming Conventions

Extension export names follow this pattern: `{extensiontype}{CamelCaseName}`

Examples:

- `dashboardpageCartPopupManager`
- `dashboardpluginBlogPostsBanner`
- `dashboardmenupluginExportPosts`
- `embeddedscriptCouponPopup`
- `sitewidgetCountdownWidget`
- `sitepluginProductBadge`
- `ecomshippingratesCustomShipping`

The type prefix is the extension type in lowercase with no separators.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Extension not appearing at all | Missing `.use()` call | Add import and `.use(extensionName)` to `src/extensions.ts` |
| "Cannot find module" on build | Wrong import path | Verify the path in your import matches the actual file location (relative to `src/`) |
| Extension registered but not working | Export name mismatch | Ensure the exported name in the extension file matches the import in `extensions.ts` |
| Multiple extensions, only some work | Incomplete chain | Check that every extension has both an import and a `.use()` call |
| TypeScript error on `.use()` | Wrong export type | Ensure extension file uses the correct builder method (e.g., `extensions.dashboardPage()` not `extensions.embeddedScript()`) |
