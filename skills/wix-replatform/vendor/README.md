# Vendored dependencies

The installed skill has no `package.json` and no `node_modules`, so the third-party code its
scripts load ships here, unmodified, with its license.

| Package | Version | Source | Used by |
| --- | --- | --- | --- |
| `commander` | 15.0.0 | npm registry tarball (`index.js`, `lib/`, `package.json`, `LICENSE`) | `scripts/replatform.js` |

To update: `npm pack commander@<version>`, copy the same files over, bump the row above, and run
`tests/orchestration/installed-skill-preflight-test.js`. Requires Node.js 22.12 or newer (the
package is ES modules, loaded with `require()`).
