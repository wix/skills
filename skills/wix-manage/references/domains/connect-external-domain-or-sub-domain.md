---
name: "Connect External Domain or Sub Domain"
description: "Connect a domain registered with another provider (not bought through Wix), or a subdomain, to a Wix site by handing over the dashboard connect link. Never buys a domain, and never assigns one the account already holds."
---

# Connect External Domain or Sub Domain

Brings a domain the Wix account does not hold onto a Wix site. The answer is always a **link** to the
dashboard's connect flow, built for this user's site and domain. The user finishes the connection
there. This skill never writes to a site: putting a domain on a site, changing its role and moving it
between sites are [Assign Domain](assign-domain.md)'s, with its own gate and confirmations.

| Does | Does not |
|---|---|
| Hand over the dashboard connect link for a domain registered with another provider | Buy a domain, or check whether one can be bought: [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md), [Check Domain Availability](check-domain-availability.md) |
| Connect a subdomain, after checking whether its root domain is in the account | Put a domain the account already holds on a site, change its role, or move it: [Assign Domain](assign-domain.md) |
| Resolve the target site and check its Premium plan; answer a Free site with the upgrade block | Report a domain's expiry or renewal: [Analyse Domain](analyse-domain.md) |
| Answer a user with no Wix site with the sign-up entry point | Change DNS records, or explain DNS, nameservers, pointing or propagation |

**Every reply below:** keep it natural, never expose internal mechanics, and say only what changes
what the user does next (§12).

Covers **US-17, US-33 – US-36, US-48 – US-50**.

---

## 1. Entry

You arrive here with a single domain, normalized as
[Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md) §R1 describes, and one
of these:

| Arriving from | What is already known | Start at |
|---|---|---|
| Domain Search, Purchase and Connect §A4b-C, including every domain [Assign Domain](assign-domain.md) handed back through §A4 (not a subdomain: a subdomain always starts at §2) | The domain is registered (`available: false`), and the account lookup found no exact match, or could not run | §3, ownership **asserted** |
| A subdomain from Domain Search, Purchase and Connect §A3 | Nothing: no availability check runs for a subdomain | §2 |
| A subdomain from Assign Domain's gate 1 | When Assign Domain's read ran, the subdomain itself is not in the account; no availability check runs for a subdomain | §2, and §2a runs only the root-domain pair when that read ran |
| The user, directly — they name a domain and say it is registered with another provider, or was not bought through Wix | Nothing | Below |

**Directly from the user.** Settle the domain before any site work, silently:

1. A subdomain (§2) → §2a.
2. Run the account lookup (§9) on the domain. An exact match → **hand over** (below).
3. Not in the account → check availability once, with
   [Check Domain Availability](check-domain-availability.md). Read the result here, not with that
   skill's "Reading the result" table:

   | Result | Next |
   |---|---|
   | Available, or premium (whatever `available` says) | §8: the user doesn't own it |
   | Already registered (`available: false`, not premium) | §3, ownership **asserted** |
   | Extension not supported | Domain Search, Purchase and Connect §A6b |

### Already in the account — hand over

If the account lookup (§9) found this exact domain — under `assigned` (on one of the user's sites) or
`unassigned` (on none), including when it first runs after a §3 Case C login — the domain is theirs.
**Go to [Assign Domain](assign-domain.md) and follow it**, passing the domain, the requested site's
`siteId` and name when known, ownership **confirmed**, and the role the user asked for, if any. It
answers "already there", changes the role, moves the domain or puts it on the site, with its own
confirmations. Do not compose any of it here.

Everything below assumes the domain is **not** confirmed in the account.

### Ownership states

| Ownership state | Set by | Consequence here |
|---|---|---|
| **Confirmed via root** | The subdomain's *root domain* is in the account — §2b | The subdomain *is* theirs. Use the unconditional opening naming the root, but **never hand it to Assign Domain** — its ownership check asks for a match on the domain being connected (§5). |
| **Asserted** | The user said so, or the intent was to connect — Domain Search, Purchase and Connect §A4b-C | Ownership is an inference. Keep the *"If it's yours"* hedge, and **never hand it to Assign Domain** (§5). |

If you arrive without one, ownership is **asserted** — the cautious reading. Never upgrade an
asserted state to confirmed on the strength of the user repeating themselves; only the lookup in §9
confirms.

**Order matters:** availability is checked *before* any site work. Do not resolve a site first and
then check the domain. If the domain turns out to be **available**, the user does not own it — §8.

**A subdomain is the one exception.** No availability call is made and none should be; §2 resolves
ownership from the account instead. Do not send a subdomain to an availability check that has no
answer.

**Terminal states** — this skill ends in exactly one of:

| Terminal state | Reached when |
|---|---|
| **Handed to Assign Domain** | The lookup found this exact domain in the account (above) — Assign Domain owns the rest of the conversation |
| **Connect link** | A site is resolved, it is Premium, and ownership is asserted or confirmed only via the root domain (§5) |
| **Connect link + upgrade block** | A site is resolved and it is Free (§6) |
| **Sign-up** | The user has no Wix site and wants to create one (§7) |
| **Error fallback** | Two failed attempts — §11 |

---

## 2. Is It a Subdomain? (US-48, US-49, US-50)

Some hosts a user names are **subdomains** — `shop.maximz.fr` sits under `maximz.fr`. That changes
who can be shown to own it, so settle it during normalization, before any call.

Extract the TLD greedily from the right: when the host ends in one of these multi-label suffixes, that
whole suffix is the TLD — `.co.uk`, never `.uk`:

`.co.uk`, `.com.au`, `.co.at`, `.com.br`, `.co.in`, `.org.in`, `.firm.in`, `.gen.in`, `.ind.in`,
`.net.in`

This list is for subdomain detection only. Otherwise the TLD is the last label. What remains is the
**name part**:

| Normalized input | TLD | Name part | Verdict |
|------------------|-----|-----------|---------|
| `maximz.fr` | `.fr` | `maximz` | root domain |
| `mybrand.co.uk` | `.co.uk` | `mybrand` | root domain |
| `shop.maximz.fr` | `.fr` | `shop.maximz` | **subdomain** — root is `maximz.fr` |
| `shop.mybrand.co.uk` | `.co.uk` | `shop.mybrand` | **subdomain** — root is `mybrand.co.uk` |

One label in the name part is a root domain. More than one is a subdomain, and its **root domain** is
the *last* label of the name part plus the TLD.

⛔ **A multi-label TLD is not a subdomain.** `mybrand.co.uk` has three labels and no subdomain. Greedy
extraction is exactly what stops `.uk` being read as the TLD and `co.uk` being offered as a domain to
connect — nobody owns `co.uk`.

**On an unfamiliar suffix, treat the host as a root domain.** The list above covers the multi-label
suffixes this skill has met and is not exhaustive — `.co.il` and `.com.mx` are real and missing from
it. Guessing *subdomain* wrongly produces an offer to connect something unregistrable; guessing *root
domain* wrongly just falls back to the ordinary flow. Take the fallback.

Note that `www.` is already gone by this point — normalization removes it, so `www.maximz.fr` is the
root domain `maximz.fr` and never a subdomain.

**Do not call the availability endpoint for a subdomain.** A subdomain is not separately registrable,
so there is no availability answer to be had. Ownership is the only open question, and it is usually
already settled by the account.

### 2a. The two lookups (silent)

Run the §9 pair keyed on the **subdomain**. Only if neither array holds an exact match, run the same
pair again keyed on the **root domain**. When the subdomain came from Assign Domain's gate 1 and
Assign Domain's read ran and showed it not in the account, run only the root-domain pair. If that
read did not run — the user was signed out, or it failed twice — run both pairs as usual, including
after a login. These lookups are the whole call: don't resolve the site or check its plan in the same
call. §2c may end the turn before any site work.

| Exact match at | State | Next |
|----------------|-------|------|
| Subdomain in `sites[].primary` or `sites[].redirects[]` | Already connected | Domain Search, Purchase and Connect **§A4b-A**, unchanged |
| Subdomain in `domains[]` (unassigned) | **Confirmed** | **Go to [Assign Domain](assign-domain.md) and follow it** — ownership **confirmed** |
| Root domain in either array | **Confirmed via root** | §2b |
| Neither | Root is not in the account | §2c |
| User is logged out, or `assigned` **and** `unassigned` both fail for the same name after the silent retry. An `unassigned` answer, even an empty one, rules this row out | Unknown | §3 with ownership **asserted** — the same answer as Domain Search, Purchase and Connect §A4b-C |

One request failing is no match from that request (§9): when `unassigned` answered and `assigned`
failed, read that lookup from `unassigned` alone. The `assigned` request failing on both the
subdomain and the root, while `unassigned` answered both times with no match, is **Neither** → §2c.

**Neither → §2c, and §2c is the whole reply.** No site resolution, no plan check, no link, and no
ownership state yet. A subdomain reaches §3 only from §2b, from §2d's second decline, or when both
requests of a lookup fail.

A root match confirms the subdomain. The account that holds `maximz.fr` is the account that decides
what sits beneath it — there is nothing left to ask, and nothing to hedge about.

### 2b. The root is in the account (US-48)

Ownership is **confirmed**, so the *"If it's yours"* hedge does not appear. The root opening in §5
says why it is confirmed, because the user asked about the subdomain and the account matched
something else.

**Go to §3 and follow it** — ownership **confirmed via root**. The opening in
§5 names the root; the link is the whole answer, and **no assignment** is offered.

`q=` on that link carries the **subdomain**. The root is what proved ownership; the subdomain is what
gets connected. The two are never swapped.

**Carry the root's site if the account named one, as a candidate and not a decision.** A root match
under `assigned` names the site the *root* is on — which site should serve the **subdomain** is a
separate question and this lookup did not answer it. §3, Case R asks it. Do not resolve it here,
and never let it reach a link unconfirmed.

### 2c. The root is not in the account (US-49)

Say, verbatim:

> {subdomain displayName} sits under {root displayName}, and I don't see {root displayName} in your
> Wix account. Would you like to connect {root displayName} first?

- **Yes** → treat the **root domain** as the domain in hand and go to
  [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md) §A4, from the
  availability check onward. The subdomain comes after, once the root is in the account.
- **No**, or any question about why → §2d.

### 2d. They ask why, or decline (US-50)

Both reactions get the same answer, once:

> Authorization for a subdomain follows its root domain, so having {root displayName} in your account
> is what lets you control which subdomains are allowed to point at your sites. Connecting it is a
> formality — you don't have to change any DNS, and nothing about how {root displayName} works today
> has to change.

Then leave the offer open and say nothing more about it.

- **They change their mind** → §2c's yes branch.
- **They still decline** → **go to §3 and follow it** — ownership **asserted**. Link
  only, **no assignment**. Ownership was never established here, so this is the one subdomain branch where
  the *"If it's yours"* hedge is correct and stays.

⛔ **State the recommendation once.** A user who has declined twice has decided. The subdomain link is
a working answer without the root, and repeating the case for it turns a recommendation into a
pitch — §12.

---

## 3. Resolve the Site

Connecting a domain **requires** a Wix site:

| Case | Action |
|------|--------|
| A | `siteId` already in context, or the user named a site → use it. **Do not fetch list of sites.** |
| B | Logged in, no `siteId` → fetch list of sites. One site → use it silently. 2 – 8 → list them all, numbered, in the message that asks. More than 8 → name the total, show five, invite a name (below). **Never a bare count.** |
| B, no sites | → §7 |
| C | Not logged in → *"To connect a domain you'll need a Wix site — [Log in or create a Wix account]"*. End the turn until they log in, then go to Case B. |
| R | Ownership is **confirmed via root** and the root's `assigned` match named a site → that site is a **candidate, not a resolution**. Offer it and wait — below. |

Do all of this silently, **Case R excepted**. The user should see one message at the end of this path,
not a play-by-play.

**After a Case C login, run the ownership check** before continuing — it could not run while
they were logged out. A subdomain goes back to §2a. Any other domain runs §9, and an exact match on
either list sends you to §1's hand-over.

**The user naming a site is not Case A on its own.** If they say *"my site is called My Bistro"* but
no `siteId` is in context, fetch list of sites to turn that name into an ID; what their answer buys
you is skipping the *"which site?"* question, not the lookup. Match the name against the returned
sites; if nothing matches, list what came back and ask. **A roster in context is not a resolved
`siteId` either** — a partial site list the host preloaded names no site for this domain. Fetch list
of sites.

The destination behind *[Log in or create a Wix account]* is supplied by the host channel's
sign-up/login affordance. In a channel with no widget runtime, link to `https://www.wix.com/`.

**2 – 8 sites:** *"You have a few Wix sites — which one should this domain be connected to?"* (*"a
couple"* when there are exactly two), with every site listed, numbered. **More than eight sites:**

> You have 93 Wix sites. Which one should {displayName} go on?
>
> 1. {site name}
> 2. {site name}
> 3. {site name}
> 4. {site name}
> 5. {site name}
>
> Or tell me the name and I'll find it.

Show the five most recently updated if the response gives you that; otherwise the first five it
returned. A name in reply is matched against the **whole** result you already have — do not fetch
list of sites a second time to look it up.

### Case R — the candidate site came from the root domain (US-48)

A subdomain arrives here with ownership **confirmed via root**. If that root match came back under
`assigned`, the response named the site the **root** is on (§9) — the only site the account can
suggest, and no evidence at all about where the user wants the *subdomain*. Two different questions;
the account answered the first one.

**Case A wins over this one.** If a `siteId` is already in context, or the user named a site, the site
is not in doubt and there is nothing to ask — use it and say nothing. Case R is for the one situation
where the root's match is the *only* thing pointing at a site.

So ask, in one message, and **put no link in it**:

> {root displayName} — the root domain — is already on **{root siteName}**. Want {displayName} on
> that site too?

| The user says | Do |
|---------------|-----|
| yes / "same site" | That is the resolved site. Continue to §4. |
| names a different site | Resolve that name as Case A or Case B, then continue. |
| no, or is unsure which | Case B: fetch list of sites and ask which one. |

⛔ **Do not send the connect link with the question.** Every connect URL carries a `siteId` (§10), so
a link in that message answers the question on the user's behalf and then asks it — the failure this
case exists to prevent. The link goes out with §5's opening, once a site is chosen.

**If the root matched `unassigned` instead, no site was named** — there is nothing to offer and no
question to ask. Go to Case A or Case B as usual.

---

## 4. Check the Site's Plan

```
GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}
```

Call it with the `siteId` in site scope; it carries Wix session auth — do not add headers.
Read `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.

- `allowedDomain: true` → §5
- `allowedDomain: false` → §6

⚠️ The `premium` field on the availability response is **domain pricing**, not site Premium status.
It has nothing to do with this decision. Ignore it. Neither does `allowedDomain` on the site object
inside a My Domains response — within this skill, `premiumStatus` is the only source.

---

## 5. Premium Site — Hand Over the Link (US-33)

The site is Premium, so a domain can go on it. Two routes exist, and they answer the two things
*connect* can mean (Domain Search, Purchase and Connect §A2). The **link** brings a domain into the
Wix account — *connect it to Wix*, *add it to Wix* — and is the only route available for a domain the
account does not already hold. **Assigning** puts a domain the account already holds on a particular
site — *connect it to my site*, *assign it*, *bind it* — and is [Assign Domain](assign-domain.md)'s
job.

Which routes are available is decided by the ownership state, not by taste:

| State you arrived with | What this section does |
|------------------------|------------------------|
| **Confirmed via root** — a subdomain whose root domain is in the account | The link is the whole answer, with the unconditional opening. No assignment, no primary/redirect question. |
| **Asserted** — the user said so, the lookup found nothing, or it could not run | The link is the whole answer. No assignment, no primary/redirect question. |

### The two openings — link only

This section is one message, and the ownership state picks the opening:

**Ownership confirmed via root** (a subdomain — §2b, US-48):

> {displayName} sits under {root displayName}, which is in your Wix account — [Connect it to {site name}](https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true)

**Ownership asserted:**

> {displayName} is registered. If it's yours — [Connect it to {site name}](https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true)

The link is identical in both. Only the sentence in front of it changes, and it changes because
one is a fact about a different domain that settles this one, and the other is a guess. Do not blend them — *"is yours. If it's yours…"* is the failure this split exists to
prevent.

On the root variant, `q=` carries the **subdomain**, never the root — the root is what proved
ownership, the subdomain is what gets connected. Both names in the sentence go through
§11 for their display form.

About the link:

- `q=` takes the **full** domain, never the truncated display form.
- The visible label is `Connect it to {site name}`; `{displayName}` is the domain's display form
  (§11). **Every domain shown to the user goes through §11.**
- No `referralInfo` parameter — see §10.

Add nothing after the link. **Terminal state. Stop here.**

Ownership **confirmed via root** → stop here, exactly like *asserted*. The wording is unconditional,
but the domain being connected was not itself found in the account, so Assign Domain is not offered.

### 5.1 The user asks you to do the connection

Expect this — *"yes so connect it"*, *"connect it from here"*, *"why can't you do it?"*.

No assignment is available on this path — ownership is asserted or confirmed only via root, or the
site is Free — so re-offer the link **once** and stop:

> Connecting happens in your Wix dashboard — the link opens it with {displayName} and
> **{site name}** already filled in, so you just follow the steps there.
>
> [Connect it to {site name}]({connect URL})

If the user asks again, re-send the link with one short line — *"That link is the way in — it's all
set up for you."* Do not build a new explanation each time, and do not explain **why** you cannot do
this one when you have done others.

**⛔ Never explain the mechanics.** No DNS, nameservers, A records, CNAME, TXT, propagation,
registrar access, "ownership verification", or "pointing vs nameservers". That is exactly the
internal detail §12 forbids, and it turns a one-line handoff into a support
conversation the user did not ask for.

Equally, never say what you *can't* do — no *"I have no access to your registrar"*, no *"that's not
something I can run"*, no listing your own limitations. Point at the link and stop.

If the user is logged in already, do not suggest logging in — the link opens their dashboard signed
in.

---

## 6. Free Site — Connect Link + Upgrade Block (US-34)

A Free-tier site still gets the connect link — the user should see where the domain would go — but
connecting is a Premium feature, so the upgrade block follows it in the **same** message.

**No assignment happens here, ever.** Not the hand-over to Assign Domain, not the offer, not the
primary-or-redirect question — a Free site cannot take a domain and there is nothing to ask about.

The opening line is §5's for the state you arrived with — *asserted* below; a subdomain confirmed
via its root uses the root opening in the same place. A domain confirmed in the account is Assign
Domain's, which has its own Free-site answer.

> {displayName} is registered. If it's yours — [Connect it to {site name}](https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true)
>
> **Upgrade {site name} with a Premium plan to connect your domain**
>
> Connecting a domain is a Premium feature. Upgrade now to let visitors reach you at a custom web address and enjoy Premium benefits.
>
> [Upgrade →]({upgrade URL})

The upgrade block copy is fixed. Do not reword it, do not add a benefits list, do not explain what
Premium includes, and do not promise to connect the domain once they upgrade.

If the user does upgrade mid-conversation, re-run §4. A site that now reads Premium goes to §5 like
any other.

`{upgrade URL}` is the Studio or Classic upgrade URL in §10, picked by the editor rule there.

**Terminal state. Stop here.**

---

## 7. No Wix Site (US-17)

The user is logged in but list of sites returned nothing. Connecting is impossible without a site,
so say so plainly and offer the way out:

> Connecting a domain requires a Wix site. Want to create one?

- **Yes** → show the sign-up entry point. In a channel with a widget runtime, that is the sign-up
  widget; in a plain-markdown channel, link to `https://www.wix.com/`.
  **Terminal state. Stop here** — do not continue into any other flow afterwards.
- **No** → offer the alternative once: *"No problem. Would you like to look for a domain to purchase
  instead?"* If yes → [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md)
  §A5. If no, end.

Do not pitch Premium plans here — there is no site to upgrade yet.

---

## 8. Domain Not Registered After All

If a check ever shows the domain is available, the user does not own it. Say:

> {displayName} isn't registered yet — did you mean you'd like to purchase it?

- Yes → **go to [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md) §P1 and
  follow it.**
- No → *"Do you own a different domain you'd like to connect?"* → back to Domain Search, Purchase and
  Connect §A4 with the new domain.

---

## 9. Is It in the Account? — My Domains Lookup

Answers a question the availability check cannot: the domain is registered, but is it registered
**to this user**? Without it, "taken by a stranger" and "sitting in your own account" look identical.
[Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md) §A4b runs this same
lookup for a taken domain.

```
GET https://manage.wix.com/_api/my-domains/v1/domains/assigned?filter.searchTerm={domain}
GET https://manage.wix.com/_api/my-domains/v1/domains/unassigned?filter.searchTerm={domain}
```

Both are account-level calls — ordinary Wix session auth, the same family as
`premiumStatus`. **No account-level API key is needed.** Do not add headers.

`{domain}` is the normalized domain — `maximz.fr`. Never the truncated `displayName`, never the
SLD alone.

**Run both, together, silently, and only when `available: false`** — or first, on the direct entry in
§1. An unregistered domain has no owner, so there is nothing to look up.

**A subdomain is another entry point** (§2). A subdomain is not separately registrable, so no
availability check runs for it and this lookup is reached directly: keyed on the subdomain first
(skipped when Assign Domain's gate 1 already showed it not in the account, §2a), then — only if that
finds nothing — keyed on its root domain.

A root-domain match **confirms** the subdomain. The account holding `maximz.fr` is the account that
decides what `shop.maximz.fr` resolves to, so there is nothing left for the user to assert. Compare
exactly against whichever value you searched, the subdomain or the root, and never against the other.

⛔ **Confirmed-via-root does not unlock an assignment, and does not resolve a site.** It settles the
*wording* — the unconditional opening instead of the hedge — and nothing else. Assign Domain still
asks for an exact match on the domain being connected, and a root match is not one: the link is the
whole answer there. And the site named alongside a root match is the **root's** site,
so it is a candidate for the subdomain rather than a resolution — §3, Case R asks the user before
it reaches a link.

### Response shapes

`assigned` — the domain is on one of the user's sites. The array is of **sites**, not domains:

```json
{ "sites": [ { "site":      { "siteId": "…", "siteName": "…", "connectedDomain": "…" },
  "primary":   { "domainName": "…", "siteId": "…" },
  "redirects": [ { "domainName": "…", "redirectsTo": "…" } ],
  "transfers": [] } ],
  "isAllDataReturned": true }
```

`unassigned` — the domain is in the user's account but on no site:

```json
{ "domains": [ { "domainName": "maximz.fr", "apex": "maximz.fr", "displayName": "maximz.fr" } ] }
```

No match on either is the empty form — `{"sites": [], "isAllDataReturned": true}` and
`{"domains": []}`. Both are **normal answers, not errors.**

> ⚠️ The `unassigned` response has its own `displayName` field. It is **not** the skill's
> `displayName` from §11 — it is the API's own label and carries no truncation. Compute the visible
> form yourself with §11. Never render the API's `displayName`.

> Both responses carry far more than the fields above — registrant names, street addresses, phone
> numbers, contract IDs. **None of it is ever shown to the user or reasoned about.** You need
> exactly two things out of this call: does it match, and what is the site called. Reading a
> registrant's address out of this response is the same violation as a WHOIS lookup (§12).

### ⚠️ `filter.searchTerm` is a search, not a lookup

It matches on substrings. `filter.searchTerm=maximz` returns 35 domains — `maximz.fr`,
`maximz1.de`, `sub3.maximz-cor.com` and 32 others. A hit is **not** ownership.

**Always compare the returned string to `{domain}` exactly** (both already lowercased) before
concluding anything. Look in these places, in this order:

| Exact match found at | Meaning |
|----------------------|---------|
| `sites[].primary.domainName` | Owned, and it **is** that site's address → already connected. Site name is `sites[].site.siteName` on the *same* entry. |
| `sites[].redirects[].domainName` | Owned, and already in use — it forwards to `sites[].site.siteName`. Still "already connected", not free to connect. |
| `domains[].domainName` (unassigned) | Owned, on no site yet → free to connect. |
| Nowhere | **Not in this user's Wix account.** See the caveat below — this is weaker than "someone else owns it". |

> ⚠️ **A miss does not prove the user doesn't own the domain.** These endpoints see the user's *Wix
> account*, not the registry. A domain registered at an outside registrar and never connected to a
> Wix site appears in neither response, and its owner may be sitting right there in the
> conversation. (Externally-registered domains that *are* connected do show up — they arrive under
> `assigned` with `wixRegistration: false` and `managementType: "POINTING"`.)
>
> So a match is **proof of ownership**; a miss is only **absence of proof**. Never tell a user a
> domain belongs to someone else. The "no match" copy hedges (*"If it's yours…"*) for exactly this
> reason, and it must keep hedging.

Read `siteName` and `siteId` from the entry whose `primary` or `redirects[]` matched — a single
response can contain several sites, and the first one is not necessarily yours.

> `sites[].transfers` appears on every entry but was empty in every response observed. Its contents
> are **unverified — do not read fields from it.** A domain found nowhere else counts as no match.

> The site object also carries `allowedDomain`. **Do not use it as the Premium check.** Site Premium
> has exactly one source, `premiumStatus` (§4), and two sources will eventually disagree.

### ⛔ One lookup, one retry — never re-authenticate

`subject is missing` (HTTP 400) has been observed from the `assigned` endpoint while `unassigned`
answered normally in the same breath. **It does not mean you got the auth wrong**, and the public
endpoints' *"remove the headers and retry"* rule does not apply to it — that one is about `403` on the
**public** endpoints.

So do not go hunting for a second auth shape. Not a different scope, not a
different `siteId`, not a different tool or call path after the same 400 came back. **Two calls,
one silent retry, and this lookup is finished** — apply the table below and carry on with whatever the
surviving call returned.

This lookup is an enrichment, not a gate: everything downstream works without it, and the asserted
opening already hedges for exactly this case. Four attempts at the same question is the observed
failure mode, and it buys the user nothing.

### When the check cannot run

| Situation | Do |
|-----------|-----|
| User is not logged in | **Skip both calls.** There is no account to search. Continue as if no match — ownership is unknown, not disproven. |
| One call fails, and its silent retry (§11) also fails | Treat **that endpoint** as no match and use whatever the other one returned. A confirmed match from the surviving call still counts. |
| Both fail | Continue as if no match. **Do not** show the escalation ladder for this call — it is an enrichment, and the flow it enriches still works without it. |

For a domain that is not a subdomain, the fallback in every row is the no-match branch, whose copy
already hedges (*"If it's yours…"*). That hedge is exactly right when ownership is unknown — and
exactly wrong once this call has confirmed it.

**For a subdomain, §2a's table decides instead.** An `assigned` failure while `unassigned` answers
empty is **Neither** → §2c, never the hedged link.

---

## 10. Links

Use these exactly. Do not invent variants, reorder into a different form, or drop parameters.

| Name | Template |
|------|----------|
| **Connect domain** | `https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true` |
| **Upgrade — Studio editor** (US-35) | `https://manage.wix.com/premium-pricing/studio/select-plan?siteGuid={siteId}` |
| **Upgrade — Classic editor** (US-36) | `https://manage.wix.com/premium-pricing/sunrise/select-plan?siteGuid={siteId}` |

- The connect link carries no `referralInfo`. A `referralInfo=mydomains__emptyState` value belongs to
  the My Domains empty-state entry point and does not apply to this channel. If the host channel
  supplies its own referral value, append it — otherwise omit it.
- Link label for the connect URL is `Connect it to {site name}`; use `displayName` wherever the
  domain itself is the visible label.

**Editor type** picks `studio` vs `sunrise` in the upgrade URL:

- Dashboard URL contains `/studio/`, or the site context exposes `editorType: "studio"` → `studio`
- Otherwise → `sunrise` (Classic). **When uncertain, default to `sunrise`.**

---

## 11. Display and Errors

### Domain display truncation

Only the *visible label* is ever truncated. Two values exist for every domain:

| Value | Use |
|-------|-----|
| `domainName` | Full normalized domain — URLs, API calls |
| `displayName` | What the user sees in link text and summaries |

**Rule:** if the full domain is 20 characters or fewer, `displayName` = `domainName`.
If it is longer than 20 characters:

```
displayName = [first 6 chars of the SLD] + "..." + [last 5 chars of the SLD] + [.TLD]
```

| Full domain | Length | `displayName` |
|-------------|--------|---------------|
| `short.com` | 9 | `short.com` |
| `myamazingbusiness.com` | 21 | `myamaz...iness.com` |
| `verylongdomainname.com` | 22 | `verylo...nname.com` |

### Silent retry and escalation (US-37, US-38, US-39)

Any failed call: **retry once, silently.** Say nothing to the user, before or after. Do not narrate
"let me try that again", do not mention that anything failed. If the retry succeeds, continue as if
nothing happened. The account lookup (§9) is the exception: it never escalates.

| Stage | Trigger | Say (verbatim) |
|-------|---------|----------------|
| 1 | Call fails, retry also fails | *Something went wrong on our end. Please try again in a moment.* |
| 2 | The user tries again and it fails again | *Having trouble loading this — try again. You can also search for a domain directly → [https://manage.wix.com/account/domains](https://manage.wix.com/account/domains)* |

The fallback link appears at stage 2, not stage 1. Do not skip stage 1. Never expose an error code,
endpoint or tool name in any of it.

---

## 12. Never

❌ **Never:**

- Resolve a site before the availability check.
- Fetch list of sites when a `siteId` is already in context.
- Send a connect link for a domain that is already connected in the role asked for. Check §1's
  hand-over first.
- Send a connect link for a subdomain whose root domain the account doesn't hold, before the user
  has declined §2c's offer.
- **Check availability for a subdomain.** It is not separately registrable, so there is no answer to
  get. Go straight to the ownership lookups (§2a).
- **Read a multi-label TLD as a subdomain.** `mybrand.co.uk` is a root domain. Offering to connect
  `co.uk` is the failure the greedy extraction in §2 exists to prevent.
- **Hedge about a subdomain whose root domain the account holds.** *"If shop.maximz.fr is yours"* to
  a user who owns `maximz.fr` asks them to vouch for something the account already proves. §2
  settles this before any message goes out.
- **Press the root-domain recommendation more than once.** It is stated one time (§2d). A user who
  has declined twice has decided, and the subdomain link still works without it.
- **Hand a subdomain to Assign Domain on the strength of its root domain.** *Confirmed via root* earns
  the unconditional wording and nothing else; Assign Domain wants a match on the domain being
  connected. The link is the whole answer there.
- **Adopt the root domain's site as the subdomain's.** A root match under `assigned` names the site
  the *root* is on. It is the only site the account can suggest and it is still a guess about where
  the subdomain belongs — §3's Case R offers it and waits for a yes. Since every connect URL carries
  a `siteId`, sending the link first decides for the user and presents it as an answer. *"I used that
  site rather than asking"* is not a defence; it is the bug.
- **Blend the root sentence with the hedge.** *"sits under {root displayName}, which is in your Wix
  account. If it's yours —"* states a fact and then doubts it. The two openings in §5 are two,
  not ingredients.
- **Hand a domain to Assign Domain on ownership the user only asserted.** An externally-registered
  domain the lookup never saw is not yours to write to a live site; the link is the whole answer.
- **Make the assignment offer, or write to a site, from this skill.** [Assign Domain](assign-domain.md)
  owns the offer, the confirmations, the calls and the success line.
- **Treat a `searchTerm` hit as ownership.** It is a substring search. Compare the returned domain
  string to the normalized domain exactly, or you will tell a user they own a domain they do not.
- **Read anything but the match and the site name out of a My Domains response.** Registrant names,
  addresses, phone numbers, expiry dates and contract IDs are all in there. None of it is in scope.
- **Step outside the job on a taken domain.** No WHOIS or registrant lookup, no naming the owner or
  registrar, no aftermarket/broker/acquisition advice, no valuation, no trademark opinion, no web
  browsing, no Help Center steps. The account lookup in §9 is the sole exception, and it only ever
  looks inside the user's own account.
- Say *"main address"*, *"main domain"*, *"main URL"* or *"root domain"* for **primary domain**. The
  user may say "main one"; your reply says "primary domain". *Root domain* is correct only for the
  domain a subdomain sits under (§2).
- Say *"If it's yours"* when the account lookup has confirmed it **is** theirs — or drop the hedge
  when it has not. The two openings in §5 are not interchangeable.
- Ask *"do you already own this domain?"*. Either the lookup answered it or the hedge covers it.
- Answer a subdomain with the *"is registered. If it's yours —"* opening before the user has declined
  twice (§2d). Until then, a subdomain whose root the account doesn't hold gets §2c.
- Show the upgrade block to a Premium site, or omit the connect link for a Free site — Free-tier
  users get both.
- Ask the primary-or-redirect question on a Free site, or anywhere else no assignment can follow it.
- Decide the site's Premium plan from the availability result's `premium` flag. That flag is a
  domain-pricing tier (§4); the site's plan comes only from §4's plan check.
- Reword the upgrade block, or explain Premium's feature set.
- Add text after the connect link or the upgrade block.
- Offer to purchase a domain the user has just said they own.
- Explain DNS, nameservers, A/CNAME/TXT records, propagation or registrar access — ever, to anyone,
  however directly asked. See §5.1.
- Narrate your own limitations ("I can't do that from here", "I have no access to…"). Re-send the
  link instead.
- Expose internal mechanics — no API names, endpoint paths, tool names, error codes, HTTP status
  codes or field names — or narrate work in progress: "Let me check…", "I'll look that up…",
  "Verifying…", "Hold on…".

✅ **Always:**

- Use the full domain in `q=`; the site's display name in the link label; `displayName` (§11) for
  every domain the user sees.
- Pick the §5 / §6 opening from the ownership state you arrived with, defaulting to **asserted**.
- Default to `sunrise` when the editor type is unclear.
- Build every link from §10's templates.
- Keep the whole path to a single user-visible message where possible.

---

## Next steps

- Buying a domain, suggestions, or a domain that turns out to be available: [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md).
- A domain the account already holds — putting it on a site, changing its role, moving it: [Assign Domain](assign-domain.md).
- Whether a name is available, as a question on its own: [Check Domain Availability](check-domain-availability.md).
- Expiry or renewal of a domain in the account: [Analyse Domain](analyse-domain.md).
