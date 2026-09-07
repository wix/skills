
# Extension Registration

`src/extensions.ts` registers extensions through `.use()` calls. HTTP endpoints are file-based routes and do not use this registration mechanism.

## Registration is automatic via the CLI

For registered extension types, `wix generate --params` updates `src/extensions.ts`
for you. Verify the generated import and `.use()` call; do not write them by hand.

## HTTP endpoints: no registration

`wix generate --params '{"extensionType":"HTTP_ENDPOINT","name":"hello"}'`
creates the endpoint file without changing `src/extensions.ts`:

| Project | Discovery directory | Example route |
| --- | --- | --- |
| Standalone `@wix/custom-extensions` (default `apiDir: "endpoints"`) | `src/endpoints/` | `hello.ts` → `/hello` |
| `@wix/astro` | `src/pages/api/` | `hello.ts` → `/api/hello` |

Leave `app()` unchanged. Do not add endpoint imports, `.use()` calls, or IDs.
See [BACKEND_API.md](BACKEND_API.md) for supported versions and frontend URLs.

## Manual recovery (when the CLI output drifts)

Edit `src/extensions.ts` directly only when:

- The CLI failed mid-run and left the file out of sync
- A user hand-edited the file and broke the chain

Each extension file is a default export from `<folder>/<folder>.extension.ts`. In `src/extensions.ts`, import it as a default import using the camelCase of the folder name, then chain `.use(...)`:

```typescript
import { app } from '@wix/astro/builders';
import myPage from './extensions/dashboard/pages/my-page/my-page.extension.ts';
import contactCreated from './extensions/backend/events/contact-created/contact-created.extension.ts';

export default app()
  .use(myPage)
  .use(contactCreated);
```

Re-run `wix generate --params` whenever possible — manual edits drift faster than CLI-generated ones.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Extension not appearing at all | Missing `.use()` call | Re-run `wix generate --params`; if that's not possible, add the import + `.use(<binding>)` |
| "Cannot find module" on build | Wrong import path | Verify the path matches `./extensions/<area>/<folder>/<folder>.extension.ts` relative to `src/` |
| Multiple extensions, only some work | Incomplete chain | Check every extension has both an import and a `.use()` call |
| TypeScript error on `.use()` | Wrong builder method | Ensure the extension file uses the correct builder (e.g., `extensions.dashboardPage()` not `extensions.embeddedScript()`) |
