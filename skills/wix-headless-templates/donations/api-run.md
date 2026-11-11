# Donations: the calls of a build through the Wix tools

For steps 3 to 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
installs the app and creates the campaigns, what the pages import, and the visitor read for the
check.

## Steps 3 and 4: install the app and create the campaigns

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    campaigns: [
      { name: 'Winter Shelter Fund',
        frequencies: ['ONE_TIME', 'MONTH'],
        presets: [{ amount: 25, impact: 'A warm meal for five people' }, { amount: 50 }, { amount: 100 }],
        customAmount: { min: 5, max: 5000 },
        goal: { target: 20000, endDate: '2027-03-31T00:00:00Z' },
        comments: true, askCoverFee: true,
        imageUrl: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=1600' }
    ]
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const campaignsPath = '/donation-campaigns/v2/donation-campaigns';
  const money = (v) => ({ amount: String(v) });

  for (const appDefId of ['1380b703-ce81-ff05-f115-39571d94dfcd', '333b456e-dd48-4d6b-b32b-9fd48d74e163']) {   // checkout, then donations
    await api('POST', '/apps-installer-service/v1/app-instance/install',
      { tenant: { tenantType: 'SITE', id: siteId }, appInstance: { appDefId, enabled: true } });
  }

  const created = [];
  const failed = [];
  for (const c of plan.campaigns) {
    const found = (await api('POST', `${campaignsPath}/query`,
      { query: { filter: { name: c.name, archived: false }, cursorPaging: { limit: 1 } } })).donationCampaigns || [];
    if (found[0]) { created.push({ id: found[0].id, name: c.name, existed: true }); continue; }
    // Without presets, or with customAmount, the donor types an amount.
    const presets = c.presets || [];
    const custom = c.customAmount || (presets.length ? null : {});
    const made = (await api('POST', campaignsPath, { donationCampaign: {
      name: c.name,
      donationFrequencies: c.frequencies || ['ONE_TIME'],                 // ONE_TIME, WEEK, MONTH, YEAR
      predefinedDonationAmounts: presets.map((p) => ({ id: crypto.randomUUID(), price: money(p.amount),
        ...(p.impact ? { description: p.impact } : {}) })),
      customAmountEnabled: !!custom,
      ...(custom && (custom.min != null || custom.max != null) ? { customAmountOptions: {
        ...(custom.min != null ? { minimum: money(custom.min) } : {}),
        ...(custom.max != null ? { maximum: money(custom.max) } : {}) } } : {}),
      ...(c.goal ? { campaignGoal: { targetAmount: money(c.goal.target),
        ...(c.goal.endDate ? { endDate: c.goal.endDate } : {}) } } : {}),
      commentsEnabled: c.comments === true,
      askDonorCoverFee: c.askCoverFee === true
    } })).donationCampaign;
    const row = { id: made.id, name: made.name, status: made.status };
    created.push(row);

    // The cover: imageUrl, or imageMediaId for a file of the site's Media Manager.
    if (c.imageUrl || c.imageMediaId) {
      try {
        const file = c.imageMediaId
          ? { id: c.imageMediaId, url: `https://static.wixstatic.com/media/${c.imageMediaId}` }
          : (await api('POST', '/site-media/v1/files/import',
            { url: c.imageUrl, mimeType: 'image/png', displayName: `${c.name}.png` })).file;
        const current = (await api('GET', `${campaignsPath}/${made.id}`)).donationCampaign;
        await api('PATCH', `${campaignsPath}/${made.id}`, { donationCampaign: { id: made.id, revision: current.revision,
          coverImage: { id: file.id, url: file.url, height: 1024, width: 1024, altText: c.name } },
          fieldMask: { paths: ['coverImage'] } });
        row.cover = true;
      } catch (e) {
        failed.push({ cover: c.name, error: String(e.message).slice(0, 200) });
      }
    }
  }
  return { created, failed };
}
```

A campaign takes `frequencies` (`ONE_TIME`, `WEEK`, `MONTH`, `YEAR`), `presets` with an optional
`impact` line, a `customAmount` with `min` and `max`, a `goal` with a `target` and an `endDate`,
`comments` and `askCoverFee`. Its cover is `imageUrl`, or `imageMediaId` for a file in the site's
Media Manager. A campaign with a name that the site already has is used as it is.

## Step 5: what the pages import

- The list of campaigns: `createCampaignsStore({ initialCampaigns })` in `/js/wix/campaigns-store.js`.
- The donation to one campaign: `createDonationStore(campaign, { paths })` in `/js/wix/donation-store.js`.
- The thank-you page: `createReceiptStore(orderId)` in `/js/wix/receipt-store.js`.
- The reads: `fetchCampaigns` and `fetchCampaign` in `/js/wix/campaigns.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/donation-campaigns/v2/donation-campaigns/query', { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { filter: { archived: false }, cursorPaging: { limit: 20 } } }) });
  const data = await res.json();
  return { status: res.status, names: (data.donationCampaigns || []).map((x) => x.name) };
}
```

The check passes when the names are the campaigns that step 4 created.
