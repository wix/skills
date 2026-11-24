# Secrets and API Keys

Applies whenever generated code needs a third-party API key, token, or any other secret. This covers Wix CLI projects (a `wix.config.mjs` and a `package.json` that runs the Wix CLI). If the code is edited only in the Wix editor and there is no `wix.config.mjs`, this page doesn't apply.

## Start with: whose key is it?

| Case | Who owns the key | Where the value lives | Who adds it |
| --- | --- | --- | --- |
| **A. Studio 2 site (companion app)** — the code of one Studio 2 site | The site's owner (you, if it's your site) | The site's **Secrets** page | The site's owner |
| **B. App, one key for all sites** — you publish the app, you pay for the service | You, the app's developer | An app environment variable | You, with `wix app env set` |
| **C. App, each site brings its own key** — every installing site owner uses their own account | Each installing site owner | Per-site storage the app sets up (see C) | The site owner, in the app's own UI |

Tell A from B/C by the project files:

| Signal | Studio 2 site, companion app (A) | App (B or C) |
| --- | --- | --- |
| `wix.config.mjs` | `codeIdentifier: 'companionApp'`: this project is a Studio 2 site's code, not a publishable app | `codeIdentifier` is the app's own name, e.g. `'my_weather_app'` |
| `package.json` scripts | `wix dev`, `wix build`, `"env": "wix env pull"` | `wix app dev`, `wix app build`, `"env": "wix app env"` |

Tell B from C by asking whose account the third-party service bills: one account for the whole app is B; one account per installing site is C. When the request doesn't say, ask. This is a design question, not a configuration value: ask it even though missing configuration values otherwise don't block the work.

In the final message, under Manual Steps Required, give the exact name the code reads and where to add the value (A or B), or the one-time setup (C).

## The code is the same in A and B: backend `process.env`

Read the secret only in backend code (Backend API endpoints, service plugins, backend events). The name on the Secrets page, or in `--key`, is exactly the `process.env` name:

```ts
// src/api/weather.ts
import type { APIRoute } from '@wix/custom-extensions/types';

export const GET: APIRoute = async () => {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'OPENWEATHER_API_KEY is not set' }, { status: 500 });
  }
  const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${apiKey}`);
  return Response.json(await res.json());
};
```

- Frontend code (site widgets, dashboard pages, Editor React components) does not get these variables. Call a Backend API endpoint that uses the secret, and never return the secret itself to the frontend.
- Every value is a string; parse numbers or JSON yourself. Fail with a clear message when the variable is missing.

## Never

- In cases A and B, never use `@wix/secrets` (`getSecretValue`, `listSecretInfo`). It does not read a Studio 2 site's Secrets page or app environment variables, and fails.
- Never create or edit `.env`, `.env.local` or any other `.env*` file, and never put a secret value in source code. The CLI's `env pull` writes `.env.local` itself for local development only; it is ignored by git and never deployed.
- Never ask for a secret in the chat. If the user already pasted one, don't write it anywhere, tell them where to add it instead, and suggest they rotate it, since it was shared in a chat.

## A. Studio 2 site (companion app): the site's Secrets page

The site owner adds the secret on the site's **Secrets** page:

- In the site's dashboard: **Developer Tools → Secrets**, which is `https://manage.wix.com/dashboard/<siteId>/dev-tools/secrets`. The site ID is the `siteId` in `.wix/app.config.json` when that file exists; otherwise give the menu path.
- Or in the editor: the **Code** tab → **Developer Tools → Secrets**.

A new or changed secret takes effect on the live site right away, without republishing (code changes still publish as usual). When working on the code locally, run `npx wix env pull` after adding it so `wix dev` reads it. Don't use `wix env set` for a secret here: it stores a variable the Secrets page does not show.

## B. App, one key for all sites: an app environment variable

You (the developer) set the value once, for the whole app:

1. `npx wix app env set --key OPENWEATHER_API_KEY --value <your key>` — stored on Wix servers and shared with the app's collaborators. Type the value yourself; never paste a key into a chat to have it run for you.
2. `npx wix app env pull` — so local `wix app dev` reads it.
3. `npx wix app build` and `npx wix app release` — the released app reads it only after this. Changing the value later needs the same build and release.

Every site that installs the app uses this one value. Site owners cannot see or change it.

## C. App, each site brings its own key: ask before building

Neither of the above works:

- An app environment variable has one value for every installation.
- A published app can't read the installing site's **Secrets** page (only the Studio 2 site's own companion app, case A, can): the app's `process.env` does not include secrets added there.

So the app collects each site's key itself and stores it on that site with the Wix [Secrets API](https://dev.wix.com/docs/api-reference/business-management/secrets/introduction). Before building it, tell the user about the one-time setup below.

**One-time setup (the developer):** add the **Manage Secrets** permission (`SCOPE.VELO.MANAGE_SECRETS`) under **Develop → Permissions** in the app dashboard, then release a new major version (adding a permission requires one). Each site owner approves the update ("Manage Secrets — can read and manage site secrets"). For a few minutes after the permission is added, calls return 403.

**In the app:** the site owner enters their key on the app's dashboard page. The page sends it to a Backend API endpoint with `httpClient.fetchWithAuth()`, and backend code saves it, replacing an earlier value, and later reads it. Both calls are elevated:

```ts
// src/api/mailchimp-key.ts — saves the site owner's key
import type { APIRoute } from '@wix/custom-extensions/types';
import { auth } from '@wix/essentials';
import { secrets } from '@wix/secrets';

const NAME = 'MYAPP_MAILCHIMP_KEY';

export const POST: APIRoute = async ({ request }) => {
  const { value } = (await request.json()) as { value?: string };
  if (!value) return Response.json({ error: 'Missing key' }, { status: 400 });
  const { secrets: list = [] } = await auth.elevate(secrets.listSecretInfo)();
  const existing = list.find((secret) => secret.name === NAME);
  if (existing?._id) {
    await auth.elevate(secrets.updateSecret)(existing._id, { name: NAME, value });
  } else {
    await auth.elevate(secrets.createSecret)({ name: NAME, value });
  }
  return Response.json({ saved: true });
};

// Any backend code that needs it:
// const { value: key } = await auth.elevate(secrets.getSecretValue)(NAME);
```

- Each installing site holds its own value. `createSecret` with a name that already exists fails with `DUPLICATE_SECRET_NAME`, so update the existing secret instead.
- Prefix the name with the app's name: the store is the site's, shared with its other secrets.
- Never return the value to the frontend; return only whether a key is saved. On a Studio 2 site the secret does not appear on the site's Secrets page.
- If the third-party service offers its own "connect your account" (OAuth) flow instead, the OAuth client secret is yours, the same for every site (case B), and each site's token is stored the same way as a key above.
