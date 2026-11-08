---
name: "Assign Domain"
description: Connect a domain the user already owns to one of their Wix sites, as its primary domain or as a redirect — the starting point for every "connect my domain to my site" request, whether or not a domain is named; change which of a site's domains is primary; move a domain from one site to another; or take a domain off its site.
---

# Assign Domain

Changes **which site a domain in the account serves, and in which role**. A site has one **primary
domain** (the address visitors land on) and up to 300 **redirects** (domains that send visitors to the
primary domain). A domain is on one site at a time, or on none.

| Does | Does not |
|---|---|
| Connect (assign) a domain to a site, as primary or as a redirect. A domain that isn't in the account yet is handed back (gate 1) | Buy a domain: [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md). Bring in a domain registered elsewhere, or a subdomain, that isn't in the account yet: [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) |
| Make a redirect the site's primary domain, or swap the primary for another of the site's domains | Report a domain's expiry or renewal: [Analyse Domain](analyse-domain.md) |
| Move a domain from one site to another | Change DNS records, or explain DNS, nameservers or propagation |
| Take a domain off its site | Check whether a name can be registered: [Check Domain Availability](check-domain-availability.md) |

Every call runs in the user's own context, as the signed-in user, at account scope. No API key or
integration token. The account ID header is added for you.

## Flow

1. **Normalize the domain**: lowercase, trim, strip `http://`, `https://`, `www.` and any path.
   **No domain named** (*"connect a domain I own to my site"*) → the whole reply is: *"What domain
   would you like to connect?"* Nothing can be read or changed without the domain, so this is the
   answer even when you would otherwise go ahead on assumptions. Don't ask for the site or the role
   (the read settles those later), don't send any link (no My Domains, no domain settings), don't read
   another skill, and don't say that nothing was changed.
2. **Know the target site**, when the request has one (connect, move, change role). Take it from the
   site context ("this site"), from the conversation, or by name as
   [Query Sites](../sites/query-sites.md) describes. When several sites match, or none was named and
   the domain is on no site, list the account's sites by name and ask which one. Taking a domain off
   its site, or connecting it or changing its role with no site named, needs no target up front: pass
   `null`. When the read shows the domain on a site, that site is `X` for taking it off, and `T` for
   anything else (so a domain already there gets the **Already** answer). Ask which site only when the
   domain is on no site.
3. **Read the state** (next section), silently, in one call.
4. **Pick the row** in the decision table that fits the state and the request.
5. **Check the gate** against that row's writes. Any condition unmet → no write; the gate table says
   what to answer instead. All met → send the row's offer and **end your turn**.
6. **Only after an explicit yes** to that offer, run the writes, in one call, and report in one sentence.

Run each script below as one call, with whatever lets you run a short script over several Wix API
requests at once. Do not split it into separate requests. Never name an endpoint, field, enum value,
error code or tool to the user, and never narrate the calls ("let me check", "running the update").

## Read the state

One read-only call. Put the domain in `domain`, the target site's ID in `targetSiteId`, or `null`
when no site was named (taking the domain off its site, or a role change on the site it is on), and
the Account ID from the Wix context you already read in `accountId`.

```javascript
async function() {
  const domain = "example.com";
  const targetSiteId = "TARGET_SITE_ID";
  const accountId = "ACCOUNT_ID";
  const base = "https://www.wixapis.com/domains/v1/domain-assignments";
  // "Not in this account": 404, or the connected-domain lookup's 403 for a domain held by another account.
  const notHere = e => /\(404\)|DOMAIN_NOT_PERMITTED/.test(String(e.message));

  let assignment = null;
  try {
    const { data } = await wix.request({
      scope: "account",
      method: "GET",
      url: `${base}/${domain}`
    });
    const info = data.domainAssignment.siteInfo;
    assignment = { siteId: info.id, role: info.assignmentType };
  } catch (e) {
    if (!String(e.message).includes("DOMAIN_ASSIGNMENT_NOT_FOUND")) return { failed: true };
  }

  async function holds(url, tries) {
    let answer = "error";
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        await wix.request({ scope: "account", method: "GET", url });
        return "yes";
      } catch (e) {
        answer = notHere(e) ? "no" : "error";
      }
    }
    return answer;
  }

  // The account's domains on no site. The search term matches substrings, so only an exact name counts.
  async function inUnassigned(tries) {
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const { data } = await wix.request({
          scope: "account",
          method: "GET",
          url: `https://manage.wix.com/_api/my-domains/v1/domains/unassigned?filter.searchTerm=${domain}`
        });
        return (data.domains || []).some(d => d.domainName === domain) ? "yes" : "no";
      } catch (e) {}
    }
    return "error";
  }

  let owned = Boolean(assignment);
  if (!owned) {
    const listed = await inUnassigned(2);
    const connected = listed === "yes"
      ? "yes"
      : await holds(`https://www.wixapis.com/domains/v1/connected-domains/${domain}`, 1);
    owned = listed === "yes" || connected === "yes";
    if (!owned && (listed === "error" || connected === "error")) return { failed: true };
  }

  const siteIds = [...new Set([targetSiteId, assignment && assignment.siteId].filter(Boolean))];
  const sites = {};
  if (siteIds.length) {
    const siteQuery = {
      query: {
        filter: {
          id: { $in: siteIds },
          namespace: { $in: ["WIX", "HEADLESS"] }
        }
      }
    };
    // A site created moments ago can take a few seconds to show up in the site list.
    for (let attempt = 0; attempt < 4 && siteIds.some(id => !sites[id]); attempt++) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 3000));
      const query = await wix.request({
        scope: "account",
        method: "POST",
        url: "https://www.wixapis.com/site-list/v2/sites/query",
        body: siteQuery
      });
      for (const s of query.data.sites) {
        sites[s.id] = { name: s.displayName, premium: s.premium, editorType: s.editorType, primary: null, redirects: [] };
      }
    }
    // Still not listed: read its plan from the account's Premium purchases instead.
    const premiumPlanType = "8b1b47e6-9f58-4e59-b147-cac894bec8da";
    for (const id of siteIds.filter(id => !sites[id])) {
      const assetQuery = {
        cursorQuery: {
          filter: {
            "siteData.metasiteId": id,
            status: "ACTIVE"
          }
        },
        includePermitted: false
      };
      try {
        const { data } = await wix.request({
          scope: "account",
          method: "POST",
          url: "https://www.wixapis.com/premium-assets/v2/premium-assets/query",
          headers: { targetAccountId: accountId },
          body: assetQuery
        });
        const plan = (data.premiumAssets || []).find(a => a.productData && a.productData.productTypeId === premiumPlanType);
        const name = plan && plan.siteData ? plan.siteData.siteName : null;
        sites[id] = { name, premium: Boolean(plan), editorType: null, primary: null, redirects: [] };
      } catch (e) {
        return { failed: true };
      }
    }
    // A target without a Premium plan gets the Free-site answer, which needs none of its domains.
    const listed = siteIds.filter(id => sites[id] && (sites[id].premium || id === (assignment && assignment.siteId)));
    const ids = listed.map(id => `siteIds=${id}`).join("&");
    let cursor = null;
    try {
      while (listed.length) {
        const page = cursor ? `&paging.cursor=${encodeURIComponent(cursor)}` : "";
        const { data } = await wix.request({
          scope: "account",
          method: "GET",
          url: `${base}?${ids}&paging.limit=100${page}`
        });
        for (const a of data.domainAssignments) {
          const site = sites[a.siteInfo.id];
          if (!site) continue;
          if (a.siteInfo.assignmentType === "PRIMARY") site.primary = a.domain;
          else site.redirects.push(a.domain);
        }
        cursor = data.pagingMetadata.hasNext ? data.pagingMetadata.cursors.next : null;
        if (!cursor) break;
      }
    } catch (e) {
      return { failed: true };
    }
  }
  return { domain, owned, assignment, sites };
}
```

What comes back, verified live:

| Field | Meaning |
|---|---|
| `assignment` | `null`: the domain is on no site. Otherwise `siteId` (the site it is on) and `role`, `PRIMARY` or `REDIRECT`. |
| `owned` | `true`: the domain is in the account. `false`: the account doesn't hold this exact domain. |
| `sites[id]` | For the target site and the site the domain is on now: `name`, `premium`, `editorType`, `primary` (its primary domain, or `null` when it has no domains), `redirects` (its other domains). A target site without a Premium plan has its domains left unread (`primary: null`, `redirects: []`): gate 3 answers for it before they matter. A site created moments ago may not be in the site list yet; the call waits for it, then reads its plan from the account's Premium purchases, and then `name` can be `null` (say *your site*) and `editorType` is `null` (use the non-Studio upgrade URL). Every site ID passed in comes back here: never look a site up again in a separate call. |
| `failed: true` | The read itself failed. Run it once more, silently. If it fails again, and the request takes a domain off its site or the calling skill passed ownership **confirmed**, send the dashboard link and stop: {domain settings link} when the site is known, otherwise {My Domains link} (URLs: see Offer copy). Otherwise hand back exactly as gate 1 does (read both skills it names and run the availability check once), with ownership **unknown** instead of "not in the account". A failed read is never answered with an error message of its own, and never tells the user the domain is not in their account. |

A domain on no site and a domain that is not in the account both answer "not found" to the assignment
lookup; the account's list of domains on no site and the connected domain tell them apart. The list
holds every domain in the account that is on no site, registered through Wix or connected from
elsewhere, and only an exact name match counts. It is tried twice, and when it doesn't hold the domain,
the connected-domain lookup follows, which answers for every domain connected from elsewhere. For a
domain another account holds, that lookup answers `403` with `DOMAIN_NOT_PERMITTED`: that too means
"not in this account", not a failed read. All of this happens inside the one call: never look the
domain up again in a separate call, and never search the docs for another way to find it.

## The gate

All four must hold before any write. Check them in this order:

| # | Condition | When it fails, answer with |
|---|---|---|
| 1 | The user is signed in, and the domain is in the account: `owned` is `true` for **this exact domain**, or the calling skill passed ownership **confirmed** for it (that counts even when this read does not show it). A root domain in the account does not confirm its subdomain, and the user saying it is theirs confirms nothing | **Taking a domain off its site:** "{domain} isn't in your Wix account, so there's nothing to take off." Stop. **Putting a domain on a site:** hand back, saying nothing first. A subdomain (`shop.example.com`) goes to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §2, with no availability check. Any other domain: **read [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md) and [Check Domain Availability](check-domain-availability.md), run the availability check once, as that skill describes (never call availability any other way), and follow Domain Search, Purchase and Connect §A4 for the result**, with intent *CONNECT → a site*, the domain, the target site if known, and "not in the account", or ownership **unknown** when the user is signed out or the read failed twice (its §A4b then skips its own lookup). §A4 then answers: a taken domain goes on to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) for the connect link, an available one gets the offer to buy. Never say who owns a domain. |
| 2 | The target site is known (not needed to take a domain off its site) | Ask which site, listing the account's sites by name. |
| 3 | Only when the writes assign a domain to `T`: `T` has `premium: true`. When the calling skill already checked the plan, take its answer. Taking a domain off a site, or promoting one already on it, needs no plan check | The Free-site answer below. No offer, no question about roles. |
| 4 | The user said yes to an offer that named every live change: the primary domain it replaces, the site a domain leaves, the redirect promoted in its place, the role it takes on the target | Send the offer from the decision table and end your turn. |

**Free-site answer** — the target site has no Premium plan:

> **Upgrade {T} with a Premium plan to connect your domain**
>
> Connecting a domain is a Premium feature. Upgrade now to let visitors reach you at a custom web address and enjoy Premium benefits.
>
> [Upgrade →]({upgrade URL})

`{upgrade URL}` is `https://manage.wix.com/premium-pricing/studio/select-plan?siteGuid={siteId}` when
the site's `editorType` is `STUDIO`, otherwise
`https://manage.wix.com/premium-pricing/sunrise/select-plan?siteGuid={siteId}`. The block is the same
fixed copy [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §6 uses: do not reword it, and never promise to put the
domain on the site once they upgrade.

## Decision table

`{domain}` is the domain the user named. `T` is the target site, `{T}` its name, `{T primary}` its
primary domain. `X` is the site the domain is on now, `{X}` its name. `{R}` is a redirect on the site
being changed.

| State | Request | Offer (copy below) | Writes after a yes, in order |
|---|---|---|---|
| On no site; `T` has no domains | Any role | **A1** | assign `{domain}` to `T` |
| On no site; `T` has a primary domain | No role named | **A2** | per the answer: assign; then promote `{domain}` if they chose primary |
| On no site; `T` has a primary domain | Redirect | **A3** | assign `{domain}` to `T` |
| On no site; `T` has a primary domain | Primary | **P1** | assign `{domain}` to `T`, promote `{domain}` |
| On `T`, in the role asked for, or no role named | — | **Already** | none |
| On `T` as a redirect | Primary | **P1** | promote `{domain}` |
| On `T` as primary | Redirect | **P2**, or **Only** when `T` has no redirects | promote the `{R}` the user picks |
| A redirect on another site `X` | Put on `T` | **M1** | assign `{domain}` to `T`; promote `{domain}` if the agreed role is primary and `T` has a primary |
| Primary of another site `X`, which has redirects | Put on `T` | **M2** | promote the `{R}` the user picks on `X`; assign `{domain}` to `T`; promote `{domain}` if the agreed role is primary and `T` has a primary |
| Primary of another site `X`, its only domain | Put on `T` | **M3** | unassign `{domain}`; assign `{domain}` to `T`; promote `{domain}` if the agreed role is primary and `T` has a primary |
| On a site as a redirect | Take it off | **U1** | unassign `{domain}` |
| Primary of a site with redirects | Take it off | **U2** | promote the `{R}` the user picks, unassign `{domain}` |
| Primary of a site with no redirects | Take it off | **U3** | unassign `{domain}` |
| On no site | Take it off | **Off** | none |

"Assign" is always as a **redirect**. On a site with no domains, a redirect becomes the primary
domain; on a site that has one, promoting afterwards makes it primary and turns the old primary into
a redirect. Assigning straight in as primary would remove every domain the site already has.

When the user asks for a role on a site with no domains, there is nothing to redirect to: the domain
becomes its primary domain, and the offer says so.

When a site has several redirects and the row says "the `{R}` the user picks", list them by name in
the offer and let the user choose. With exactly one, name it and ask for a yes.

## Offer copy

Two dashboard links are used in this skill, and only in three places: the failed-read row in Read the
state, the "no / I'll do it myself" row in Reading the answer, and On failure under Run the writes.
Send one only there, never as a fallback of your own. Their URLs are owned by
[Domains Dashboard Navigation](domains-dashboard-navigation.md); take them from there:

- `{domain settings link}`: the site's domain settings, labelled *Domain settings for {site name}*.
- `{My Domains link}`: the account's domain list, labelled *My Domains*.

Every offer is one message and ends the turn. Show every domain in full. Say **primary domain** and
**redirect**; never "main address", "main domain" or "main URL", even when the user does.

**A1** — target site has no domains:
> {T} doesn't have a primary domain yet. Want me to make {domain} its primary domain?

**A2** — target site has a primary domain, no role asked for:
> {T}'s primary domain is **{T primary}**. Should {domain} become the primary domain instead, or redirect to it?

**A3** — redirect asked for:
> {T}'s primary domain is **{T primary}**. Want {domain} to redirect to it?

**P1** — replaces a live primary domain:
> {T}'s primary domain is **{T primary}** right now. Making {domain} the primary domain will send visitors to {domain} instead, and {T primary} will redirect to it. Go ahead?

**P2** — demote the primary domain:
> {domain} is {T}'s primary domain. To make it a redirect, another of the site's domains has to become primary. Should **{R}** become the primary domain? {domain} will then redirect to it.

**Only** — the site's only domain:
> {domain} is {T}'s only domain, so there's nothing for it to redirect to.

**M1** — move a redirect:
> {domain} currently redirects to **{X}**. Moving it to {T} takes it off {X}. {T's role, below}

**M2** — move a primary domain whose site has redirects:
> {domain} is **{X}**'s primary domain, so it can't move while it's there. I can make **{R}** {X}'s primary domain first, then move {domain} to {T}. {T's role, below}

**M3** — move a site's only domain:
> {domain} is **{X}**'s only domain, so moving it to {T} leaves {X} with no domain. {T's role, below}

**T's role** — the end of every move offer, picked by what `T` has and what the user asked:

| `T` and the request | Ends with |
|---|---|
| `T` has no domains | "It will become {T}'s primary domain. Go ahead?" |
| Redirect asked for | "It will redirect to **{T primary}**. Go ahead?" |
| Primary asked for | "It will become {T}'s primary domain instead of **{T primary}**, which will redirect to it. Go ahead?" |
| No role named | "On {T}, should it become the primary domain instead of **{T primary}**, or redirect to it?" |

**U1** — take a redirect off:
> {domain} redirects to **{X}**. Take it off {X}?

**U2** — take a primary domain off a site that has redirects:
> {domain} is **{X}**'s primary domain. Taking it off directly would also remove {X}'s other domains. I can make **{R}** the primary domain first, then take {domain} off. Go ahead?

**U3** — take the only domain off:
> {domain} is **{X}**'s only domain. Take it off {X}?

**Already**:
> {domain} is already {T}'s primary domain. / {domain} already redirects to **{T}**.

**Off**:
> {domain} isn't on any site.

### Reading the answer

| The user says | Do |
|---|---|
| yes, to an offer that named a single outcome | Run that row's writes. |
| primary / redirect, to A2 or a move ending in the role question | Primary → send **P1**, or the move offer again ending in the "Primary asked for" line, and end the turn. Redirect → run the writes once every other choice is answered. |
| a redirect's name, to P2, M2 or U2 | That is `{R}`. Run the writes once every other choice is answered. |
| no, "I'll do it myself", or changes the subject | No write. Send the dashboard link once and stop: "You can also do it yourself: {domain settings link}" |
| anything ambiguous | Ask the same question once more. Never guess a role. |

Run the writes only when every choice the offer left open — `{R}` and the role on `T` — has an
answer. If one is still open, ask only for that one and end the turn.

Silence, a repeated request or "whatever you think" is not a yes.

## Run the writes

One call, after the yes. List the row's writes in `steps`, in order. Each step is retried once; the
first step that still fails stops the call, and the result says which steps ran.

```javascript
async function() {
  const base = "https://www.wixapis.com/domains/v1/domain-assignments";
  const steps = [
    { op: "assign", domain: "example.com", siteId: "TARGET_SITE_ID" },
    { op: "promote", domain: "example.com" }
  ];

  function call(step) {
    if (step.op === "assign") {
      const body = {
        domainAssignment: {
          domain: step.domain,
          siteInfo: { id: step.siteId, assignmentType: "REDIRECT" }
        }
      };
      return wix.request({ scope: "account", method: "POST", url: `${base}/upsert/domain/${step.domain}`, body });
    }
    if (step.op === "promote") {
      return wix.request({ scope: "account", method: "PATCH", url: `${base}/${step.domain}`, body: {} });
    }
    return wix.request({ scope: "account", method: "DELETE", url: `${base}/${step.domain}` });
  }

  const done = [];
  for (const step of steps) {
    let error = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data } = await call(step);
        const info = data.domainAssignment && data.domainAssignment.siteInfo;
        done.push({ ...step, role: info ? info.assignmentType : null });
        error = null;
        break;
      } catch (e) {
        error = String(e.message);
        if (error.includes("DOMAIN_IS_PRIMARY_ON_ANOTHER_SITE")) break;
      }
    }
    if (error) return { done, failed: step, primaryElsewhere: error.includes("DOMAIN_IS_PRIMARY_ON_ANOTHER_SITE") };
  }
  return { done };
}
```

| `op` | Call | Body |
|---|---|---|
| `assign` | `POST https://www.wixapis.com/domains/v1/domain-assignments/upsert/domain/{domain}` | `{"domainAssignment": {"domain": "{domain}", "siteInfo": {"id": "{siteId}", "assignmentType": "REDIRECT"}}}` |
| `promote` | `PATCH https://www.wixapis.com/domains/v1/domain-assignments/{domain}` | `{}` |
| `unassign` | `DELETE https://www.wixapis.com/domains/v1/domain-assignments/{domain}` | none |

`assign` and `promote` answer with the `domainAssignment`; `siteInfo.assignmentType` is the role the
domain holds now (`PRIMARY` after assigning to a site with no domains). `unassign` answers `{}`.
`assign` to the site a domain is already on changes nothing, whatever role you send: a role change is
always `promote`. `promote` on a domain that is already primary changes nothing either. `assign` on a
domain that is another site's primary domain fails, which is why M2 and M3 free it first.

### Report

One sentence, from what `done` shows. Nothing about timing, DNS, SSL or propagation, and nothing about
what a site that lost a domain shows now.

| Done | Say |
|---|---|
| `{domain}` holds `PRIMARY` | "Done — {domain} is now the primary domain of **{T}**." Add ", and **{old primary}** redirects to it" when one was replaced. |
| `{domain}` holds `REDIRECT` | "Done — {domain} now redirects to **{T}**." |
| a move | The same sentence, ending ", and it's off **{X}**." After M2, also name **{R}** as {X}'s primary domain. |
| `{R}` promoted alone (P2) | "Done — **{R}** is now {T}'s primary domain, and {domain} redirects to it." |
| `{R}` promoted, `{domain}` unassigned (U2) | "Done — **{R}** is now {X}'s primary domain, and {domain} is off the site." |
| `{domain}` unassigned | "Done — {domain} is off **{X}**." |

**On failure**, say what did change, then hand over the dashboard, without naming the error:

> {What changed, if anything, as above.} Here's where to finish it: {domain settings link}

When `primaryElsewhere` is `true`, the domain became another site's primary domain after the read.
Read the state again and send **M2** or **M3**. Do not offer the same write a third time unless the
user asks.

## Never

- Write anything before the user's yes to an offer that named every change. A yes to "move it" is
  not a yes to replacing a primary domain the offer did not name.
- Assign a domain as `PRIMARY`. Assign as a redirect, then promote.
- Unassign a site's primary domain while the site has redirects, unless the user asked to remove
  every domain from that site and the offer named them all.
- Write a domain that neither the read nor the calling skill found in the account, on the user's word or on its root domain's.
- Assign a domain to a site without a Premium plan.
- Guess a role, or which redirect to promote.
- Say what happens to a site after it loses a domain: no "it goes back to its Wix address", no "your
  other domain takes over".
- Promise timing, propagation, SSL, or "up to 48 hours", or explain DNS, nameservers or records.
- Look up who owns a domain.
- Say "main address", "main domain" or "main URL" for **primary domain**.

## Next steps

- Buying a domain: [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md).
- Bringing in a domain registered with another provider, or a subdomain: [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md).
- Expiry or renewal of a domain: [Analyse Domain](analyse-domain.md).
- Official reference: [Domain Assignments](https://dev.wix.com/docs/api-reference/account-level/domains/domain-assignments),
  and its [sample flows](https://dev.wix.com/docs/api-reference/account-level/domains/domain-assignments/sample-flows).
