# Pricing plans: the calls of a build through the Wix tools

For steps 4 and 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
creates the plans, what the pages import, and the visitor read for the check.

## Step 4: create the plans

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    plans: [
      { name: 'Community', type: 'free', description: 'Member perks with no commitment.',
        perks: ['Members newsletter', 'Community events'] },
      { name: 'Studio Membership', price: '29.00', billingCycle: { period: 'MONTH', count: 1 }, freeTrialDays: 14,
        description: 'Every class, month to month.',
        perks: ['All group classes', '10% off workshops', 'Priority booking'] },
      { name: 'Annual Pass', price: '290.00', billingCycle: { period: 'YEAR', count: 1 },
        setupFee: { name: 'Registration fee', amount: '25.00' },
        description: 'Two months free, paid once a year.', termsAndConditions: 'No refunds after 30 days.',
        perks: ['Everything in Studio Membership', 'Two guest passes'] },
      { name: 'Ten Class Pack', type: 'one-time', price: '120.00', billingCycle: { period: 'MONTH', count: 3 },
        description: 'Ten classes to use in three months.', perks: ['Ten classes'] }
    ]
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const failed = [];

  // The currency is set first: a price is stored in the currency the site has when the plan is created.
  if (plan.currency) {
    await api('PATCH', '/site-properties/v4/properties',
      { properties: { paymentCurrency: plan.currency }, fields: { paths: ['paymentCurrency'] } });
  }

  const billingTerms = (p) => {
    const cycle = p.billingCycle === null ? null : p.billingCycle || { period: 'MONTH', count: 1 };
    if (p.type === 'free' || cycle === null) return { billingCycle: null, startType: 'ON_PURCHASE', endType: 'UNTIL_CANCELLED' };
    if (p.type === 'one-time') {
      return { billingCycle: cycle, startType: 'ON_PURCHASE', endType: 'CYCLES_COMPLETED',
        cyclesCompletedDetails: { billingCycleCount: 1 } };
    }
    return { billingCycle: cycle, startType: 'ON_PURCHASE', endType: 'UNTIL_CANCELLED' };
  };
  const made = [];
  for (const p of plan.plans) {
    const free = p.type === 'free';
    const fees = free ? [] : [...(p.setupFee ? [p.setupFee] : []), ...(p.fees || [])];
    const body = { plan: {
      name: p.name, description: p.description, status: 'ACTIVE',
      visibility: p.visibility || 'PUBLIC', buyable: p.buyable !== false, buyerCanCancel: p.buyerCanCancel !== false,
      ...(p.termsAndConditions ? { termsAndConditions: p.termsAndConditions } : {}),
      pricingVariants: [{ id: crypto.randomUUID(), name: 'Standard', billingTerms: billingTerms(p),
        pricingStrategies: [{ flatRate: { amount: free ? '0' : String(p.price) } }],
        ...(!free && p.freeTrialDays ? { freeTrialDays: p.freeTrialDays } : {}),
        ...(fees.length ? { fees: fees.map((f) => ({ id: crypto.randomUUID(), name: f.name || 'Setup fee',
          priceType: 'FIXED_AMOUNT', fixedAmountOptions: { amount: String(f.amount) }, appliedAt: 'FIRST_PAYMENT' })) } : {}) }],
      perks: (p.perks || []).map((description) => ({ id: crypto.randomUUID(), description })),
      ...(free ? { purchaseLimits: [{ type: 'PER_MEMBER_LIFETIME', maxCount: 1 }] } : {})
    } };
    try {
      const r = (await api('POST', '/pricing-plans/v3/plans', body)).plan;
      made.push({ plan: p, id: r.id, slug: r.slug });
    } catch (e) {
      failed.push({ name: p.name, error: String(e.message).slice(0, 300) });
    }
  }

  // A plan that covers Bookings services: `coveredServiceIds` for every session,
  // or `bookingsCoverage: { serviceIds, creditAmount }` for a number of sessions.
  const namespace = '@wix/pricing-plans';
  const bookingsApp = '13d21c63-b5ec-5912-8397-c3a5ddb27a97';
  let covered = 0;
  for (const m of made) {
    const cover = m.plan.bookingsCoverage || {};
    const serviceIds = cover.serviceIds || m.plan.coveredServiceIds || [];
    if (!serviceIds.length) continue;
    try {
      let program;
      for (let i = 0; i < 5 && !program; i++) {
        try {
          program = (await api('GET', '/benefit-programs/v1/program-definitions/by-namespace-and-external-id' +
            `?externalId=${m.id}&namespace=${encodeURIComponent(namespace)}`)).programDefinition;
        } catch (e) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      const limited = cover.creditAmount != null;
      const pool = (await api('POST', '/benefit-programs/v1/pool-definitions', { cascade: 'IMMEDIATELY',
        poolDefinition: { namespace, displayName: 'Bookings benefit', programDefinitionIds: [program.id],
          details: { ...(limited ? { creditConfiguration: { amount: String(cover.creditAmount) } } : {}),
            benefits: [{ benefitKey: crypto.randomUUID(), displayName: 'Bookings sessions',
              providerAppId: bookingsApp, price: limited ? '1' : '0' }] } } })).poolDefinition;
      const itemSetId = pool.details.benefits[0].itemSetId;
      const items = await api('POST', '/benefit-programs/v1/bulk/items/create', { returnEntity: true,
        items: serviceIds.map((externalId) => ({ namespace, category: '', providerAppId: bookingsApp, itemSetId, externalId })) });
      covered += (items.results || []).filter((x) => x.itemMetadata && x.itemMetadata.success).length;
    } catch (e) {
      failed.push({ name: m.plan.name, coverage: String(e.message).slice(0, 300) });
    }
  }

  return { plans: made.map((m) => ({ id: m.id, name: m.plan.name, slug: m.slug })), covered, failed };
}
```

The plan accepts `currency` at the top. A plan has a `type` of `recurring` (the default), `one-time`
or `free`, a `price` as a decimal string, and a `billingCycle` with a `period` and a `count`; `billingCycle: null`
on a one-time plan makes it never end. It can also have `freeTrialDays`, a `setupFee` or `fees`, each with a
`name` and an `amount`, `perks`, `termsAndConditions`, `visibility`, `buyable` and `buyerCanCancel`. A plan
covers Bookings services through `coveredServiceIds`, or through `bookingsCoverage: { serviceIds, creditAmount }`
for a number of sessions; the ids are the ids of services that exist on the site. A plan has no image.

## Step 5: what the pages import

- The list of plans: `createPlansStore()` in `/js/wix/plans-store.js`.
- The buy button: `createPlanPurchaseStore()` in `/js/wix/plan-purchase-store.js`.
- The reads: `fetchPlans` and `fetchPlanBySlug` in `/js/wix/plans.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/pricing-plans/v3/plans/query', { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { filter: { visibility: 'PUBLIC' }, cursorPaging: { limit: 20 } } }) });
  const data = await res.json();
  return { status: res.status, count: (data.plans || []).length, names: (data.plans || []).map((x) => x.name) };
}
```

The check passes when the names are the plans that step 4 created.
