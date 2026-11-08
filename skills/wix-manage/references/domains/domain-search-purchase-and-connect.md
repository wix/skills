---
name: "Domain Search, Purchase and Connect"
description: "Buy a domain through Wix — intent, suggestions, site resolution, registration, privacy, cart and checkout. A request to connect a domain the user owns to their site starts at Assign Domain; connecting a domain registered with another provider, or a subdomain, is Connect External Domain or Sub Domain. Availability checks are not done here: they all use Check Domain Availability."
---

# Domain Search, Purchase and Connect

One document, three parts. Section numbers carry their part's letter, so every reference names the
part it points into — §A4b, §P3, §R4.2.

| Part | Sections | Covers |
|------|----------|--------|
| **Part A** — Entry and Routing | §A1 – §A8 | Intent, the availability step of a buy or connect, suggestions, and the routing decision. **Start here.** |
| **Part P** — Purchase Path | §P1 – §P10 | Buying a domain from Wix |
| Connecting a domain registered elsewhere, or a subdomain | — | Not here: [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md). Putting a domain the account holds on a site is [Assign Domain](assign-domain.md) |
| **Part R** — Reference | §R1 – §R10 | Endpoints, product IDs, URL templates, site resolution, error handling, currency |

**Before any API call, read Part R.** It holds every endpoint, product ID, URL template,
site-resolution rule and error rule used by both of the other parts. Do not guess a URL or a
field name — look it up there.

---

# Part A — Entry and Routing

Part A takes the conversation from the user's first message to the point where two things are known:
**which domain**, and **buy or connect**. Then it goes to one of two places:

| Then go to | For |
|------------|-----|
| **§P1** | The user is buying a domain from Wix |
| **[Assign Domain](assign-domain.md)** or **[Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)** | The user already owns the domain and wants it on their Wix site — Assign Domain when the account holds it, Connect External Domain or Sub Domain when it is registered elsewhere or is a subdomain |

Covers **US-01 – US-12**. §A4b routes **US-40 / US-41**, and decides whether the domain goes to
[Assign Domain](assign-domain.md) (**US-42 – US-46**) or to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md),
which hands over a link. Subdomains (**US-48 – US-50**) go straight there and skip the availability check entirely.

---

## A1. When To Use This Skill

The user wants to:

- Buy / purchase / register / get a domain
- Look for a domain name to buy
- Brainstorm a domain name from a business idea
- Connect / assign / add a domain to their Wix site — §A2 routes it: [Assign Domain](assign-domain.md) for a
  domain the account holds, [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) for one registered elsewhere
- Connect / assign / add a sub domain to their Wix site — [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)
- Get a custom domain for their Wix site

Typical openers: *"buy me a domain"*, *"I want to purchase a domain"*, *"get me mybusiness.com"*, 
*"I need to connect coolbrand.com to my site"*, *"I need to connect a domain mybakery.net to my Wix site"*,
*"I have coolbrand.com and want to connect it"*, *"I need a domain for my pancakes restaurant"*."

⛔ **Availability checks are never done by this recipe.** Every check of whether a domain is available,
taken, free or registered goes through [Check Domain Availability](check-domain-availability.md) — whether
the user only asks (*"is mybakery.com available?"*, *"can I get mybakery.com?"* with no wish to buy yet, a
list of domains to check) **or** the check is a step inside a purchase or a connect. Read that skill, run the
check as it describes, then come back with the result: §A4 only decides what happens next. When the user
only asked about availability, the answer is given there and ends there; come back here only when the user
then wants to buy or connect. Never call the availability endpoints from this recipe.

**If the user mentions anything else domain-related, this is the right flow.** Asking a clarifying
question is expected behaviour, not a dead end — stay here and ask. Only leave for requests that are
completely unrelated to domains ("change my site colors", "how do I add a blog"), and for a bare
availability question (above).

A question about the state of a domain already in the user's account — when it expires, whether it
renews, which site it is on, or which of their domains match a condition — belongs to
[Analyse Domain](analyse-domain.md). Answer it there; come back here only when the user then wants to
buy or connect. A request to change which site a domain already in the
account is on, or its role there — *"make X the primary domain"*, *"remove X from my site"*, *"move
X to my other site"* — belongs to [Assign Domain](assign-domain.md). The account lookup §A4b runs
([Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §9) checks whether the domain is assigned to a site or unassigned. Analyse Domain answers a different
question, the domain's state (registered or connected, expiry, renewal), from the same domain lists
plus the account's Premium purchases. Don't swap one for the other.

**UX rule for everything below:** keep it natural, never expose internal mechanics, and reveal
information only when it changes what the user has to do next. See §R9.

---

## A1.1 ⛔ Out of Scope — Hard Boundary

This skill sells Wix domains and connects domains to Wix sites. **That is the whole job.** It has
exactly three information sources: `check-domain-availability` (read [Check Domain Availability](check-domain-availability.md)), `suggest-domains`, and the
authenticated Wix endpoints in §R4.2. Nothing else.

**Never do any of these, even if you have the tools and the user would find it useful:**

| ❌ Never | Why |
|---------|-----|
| WHOIS / RDAP lookups, or any registrant research | Not a source this skill uses. It also surfaces named individuals and addresses into a shopping conversation. |
| Name the owner of a domain, their company, city, or registrar | Same. A taken domain is *taken* — who holds it is not the user's next step, and it is not yours to publish. |
| Advise buying a domain **from its current owner** — outreach, brokers, escrow, Sedo/Efty, acquisition emails | Wix does not broker aftermarket sales. This is a different product, and a taken domain is a dead end here, not a negotiation. |
| Estimate what a domain is "worth", or quote four-to-five-figure ranges | Pure invention. The only prices in this skill come from the offering call. |
| Give trademark, legal, or brand-conflict advice | Not this skill's job and not reliable from a domain lookup. |
| Hand-write a list of alternative TLDs (`.io`, `.dev`, `.app`, …) | Suggestions come **only** from `suggest-domains`. A list you composed yourself is invented data, whatever it happens to score on availability. |
| Read Help Center articles, or hand over generic dashboard steps for connecting a domain | The connect path ends in Assign Domain's offer or Connect External Domain or Sub Domain's link, both built for this user's site and domain. Generic steps skip the ownership check and the plan check. |
| Search the web, browse the domain, or inspect the site running on it | None of it changes what the user does next: buy an available domain, or connect one they own. |

If the user explicitly asks for one of these — *"who owns it?"*, *"can you help me buy it from
them?"* — decline in one sentence and return to the branch you were in:

> I can't help with buying a domain from its current owner — I can only register domains that are
> available. Want to look at some alternatives?

**A taken domain has exactly one shape of answer in this skill: whichever §A4b branch applies.**
Nothing may be added to it.

The one lookup that *is* allowed on a taken domain is the ownership check in §A4b — and it asks a
single question: is this domain in **the user's own Wix account**? That is not registrant research.
It searches what the user already has, it returns nothing about anyone else, and everything in the
response beyond the match and the site name is off limits ([Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §9).

---

## A2. Intent Classification (US-01, US-02)

Two things to establish: the **domain** and the **intent**. **Take the first row that matches,
reading top-down.**

| Signal | Intent | Next |
|--------|--------|------|
| A domain the user has (named, or *"my domain"*, *"a domain I own"*) and a site to put it on, or a change of its role or site: *"connect / assign / bind / point / put X on my site"*, *"make X the primary domain"*, *"make X redirect to my site"*, *"remove / disconnect X from my site"*, *"move X to my other site"* | **CONNECT → a site** | **Go to [Assign Domain](assign-domain.md) and follow it.** No availability check first — it reads the account itself, and hands a domain the account doesn't hold back to §A4. No domain named (*"I want to connect a domain I already own to my site"*) is this row too: Assign Domain asks which domain. Send no steps, links or Help Center content first. |
| "buy", "purchase", "get", "register", "new domain" | **PURCHASE** | §A3 |
| Wanting **a** domain — indefinite article, no domain named: *"I want a domain for my site"*, *"I need a domain for my pancakes restaurant"* | **PURCHASE** | §A3 |
| "connect it **to Wix**", "add it to Wix", "bring it into Wix", "transfer it over", or "I have" / "I own" with no site in the request | **CONNECT → Wix** | §A3 |
| A specific domain, no buy/connect word, and no question about whether it is available | **UNKNOWN** | §A3 — the availability check (run with Check Domain Availability) and §A4 settle it |
| A specific domain, and the only question is whether it is available, taken or free | Not this recipe | [Check Domain Availability](check-domain-availability.md) |
| Neither, and no domain | **UNKNOWN** | Ask: *"Would you like to purchase a new domain or connect one you already own?"* |

### The two senses of "connect" (US-51)

Both are CONNECT, and they name **different targets**. Read which one the user said — it is the
difference between two different operations:

| The user says | They mean | The operation |
|---------------|-----------|---------------|
| *to a site* — and **assign** and **bind** are the same request in other words | Which site should the domain serve? | The assignment — [Assign Domain](assign-domain.md), which checks the account first |
| *to Wix*, *add to Wix* | The domain lives at an outside registrar and is not in the account at all | The connect link — bringing it in, [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) |

Nothing can be assigned to a site until the domain is in the account, so the second is the
precondition of the first, not an alternative to it.

**The account decides which one is actually possible, and it overrides the phrasing.** *To a site*
goes to Assign Domain, whose read settles it; *to Wix* goes through §A4b's lookup:

- **Not in the account** — *to a site* cannot run, however plainly it was asked for. Assign Domain
  hands the domain back to §A4 with intent *CONNECT → a site* and ownership already looked up, and the
  connect link (§A4b-C) is the answer to **both** phrasings.
- **In the account, unassigned (§A4b-B)** — *to Wix* is already true. Read it as *to a site*; the
  connect path hands it to Assign Domain.
- **In the account, on a site (§A4b-A)** — both phrasings are already satisfied; §A4b-A answers,
  or hands a change of role or site to Assign Domain.

⛔ **Never correct the user's wording.** They are describing an outcome, not calling an API. Act on
what the account says is possible and say what you did — do not explain that they used the wrong verb.

The article does most of the work: **a** domain is one the user does not have yet (purchase);
**my** domain, or a named domain plus "I have" / "I own", is one they already hold (connect).
Do not fall through to the clarifying question just because the words "buy" or "purchase" are
absent — *"I want a domain for my site"* is a purchase.

An answer of "connect" / "I have one" with no domain named → ask *"What domain would you like to
connect?"*, then take the answer through §A3's named-domain row (normalize, subdomain → [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md), else
§A4) — or to Assign Domain when the user wants it on a site.

Do **not** ask "do you already own this domain?" — not before the availability check, and not after
it either. Asking first produces the awkward case where the user claims to own a domain that is not
even registered; asking afterwards is redundant, because §A4b looks the domain up in their account
and answers it without a turn of conversation.

---

## A3. Do We Have a Domain? (US-03, US-04)

**Take the first row that matches, reading top-down.** A domain the user named wins over everything
else in this table — including a site they named in the same breath.

| Situation | Action |
|-----------|--------|
| **CONNECT intent, no domain named** — *"I own a domain"*, *"I have a domain"*, *"connect my domain"* | The whole reply is: **"What domain would you like to connect?"** — even when you would otherwise go ahead on assumptions. No site resolution, no suggestions, no link. Then take the answer through the named-domain row below (normalize, subdomain → [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md), else §A4), or [Assign Domain](assign-domain.md) when the user wants it on a site |
| User named a specific domain — **even if they named a site too** | Normalize it (§R1). A **subdomain** (more than one label before the TLD, read greedily: `.co.uk`, never `.uk`, so `shop.maximz.fr` is one and `mybrand.co.uk` is not) → [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md), with no availability check. Anything else → §A4, **first**, before any site work |
| User gave brand/business context but no domain — *"My business is called Green Sprout Bakery"*, *"I need a domain for my pancakes restaurant"* | **Do not ask.** Build a query from that context → §A5 |
| **No domain, but they pointed at a site** — *"I want a domain for my wix site"*, *"I need a domain for my site"* | **Do not ask for a domain yet.** The site is the context → §A3.2 |
| Nothing at all — *"I want to buy a domain"*, *"help me get a domain"* | Ask, verbatim: **"What domain do you have in mind?"** Then take the answer as either a specific domain (→ §A4) or a description (→ §A5). |

The user answering with a description rather than a domain (*"Something with 'cozycuts' in it"*) is
normal — treat it as a query and go to §A5.

⚠️ **A named domain is checked before anything else happens, and the answer is the first thing the user
hears.** No site resolution, no fetching list of sites, no plan check and no list of sites comes in front of
it. *"I want to buy mybakery.com for my Wix site"* names a site, and the site waits its turn: §A4
runs, the user is told *"mybakery.com is available!"* or *"mybakery.com is already registered."*, and
only then does §P1 resolve the site. Asking which of ninety-three sites to use before saying whether
the domain can even be bought answers a question the user has not reached yet.

### A3.2 The User Pointed at a Site but Named No Domain

**This section is only for a message that named no domain, with PURCHASE intent.** A user who has a
domain to connect gets §A3's first row instead: ask which domain, resolve no site. If a domain was named as well —
*"buy mybakery.com for my wix site"* — §A3's named-domain row owns it: §A4 runs first, and the site is resolved
afterwards by §P1. Resolving a site here would put a list in front of the availability answer.

*"I want a domain for my wix site"* names no domain, and it is **not** nothing. Two things arrive with
it, and the old reading of this row threw both away:

- **The site question is already answered.** They want the domain on a site, so §R3's Case D
  question — *"Would you like to connect this domain to one of your Wix sites?"* — must **not** be
  asked. Asking it back is asking them to repeat themselves.
- **The site's name is brand context.** §A5 takes free text, and a site called *Green Sprout Bakery*
  is exactly the query it wants. Never make the user type a business name the account already knows.

So resolve the site **now**, before the domain, and let it do both jobs:

| Site resolution (§R3) | Then |
|------------------------|------|
| Case A — a `siteId` is in context | Take the site's name as the §A5 query. Suggestions and the site named, one message. |
| Case B — exactly one site | Same. Name the site so a wrong guess is visible. |
| Case B — several sites | Ask which one, with §R3 Case B's copy. That question has to be asked anyway, and its answer is also the query — §A5 runs on the reply. |
| Case C — not logged in | No account, so no site name to read. **Do not front-load the login prompt** — fall through to the *"What domain do you have in mind?"* row above. The site intent is remembered, so §R3's Case C prompt lands at its normal time, once a domain is in hand. |
| Case B — no sites at all | Nothing to name and nothing to connect to. Fall through to the bare *"What domain do you have in mind?"* row above, and treat the purchase as standalone. |

Copy when a single site is resolved — §A5's list with its own opening:

> Here are a few available options for **{site name}**:
> - greensproutbakery.com
> - greensproutco.com
> - sproutbakery.com
>
> Want one of these, or do you have something else in mind? I can also show more options if none feel right.

⚠️ **A site name is not always a business name.** Auto-generated names (`Evl 99faa20b7b2b`,
`My Site 3`, a bare hex string) and placeholders carry no brand signal, and querying §A5 on one
returns noise. When the name has no real words in it, treat it as **no context**: keep the resolved
`siteId`, then ask *"What domain do you have in mind?"* — the site still gets used for the plan check
and the auto-connect line, just not for suggestions.

⚠️ **This is the one place the purchase path resolves a site before the domain**, and only because the
user put the site in the request. §P1.1's rule — do not fetch list of sites unless the user asked
about a site — is **satisfied here, not bypassed**. Carry the resolved `siteId` into §P1; the site is
already settled, so the plan check is the next step and the question is never re-asked.

---

## A4. What the Availability Result Means (US-07, US-08, US-09)

Check the normalized domain **silently** — no "let me check", no "one moment". This recipe does not run the
check: read [Check Domain Availability](check-domain-availability.md) and run it as that skill describes
(endpoints, request, response, errors), here as everywhere. This section only decides what happens next. Inside this flow §A4a, §A4b and §A6 decide the reply; the
"Reading the result" table in that skill does not apply. Result mapping: §R4.1.

### A4a — `available: true` (US-08)

Say, verbatim:

> {displayName} is available!

Then:

- **Intent is PURCHASE or UNKNOWN** → **Now go to §P1 and follow it.**
  If a `siteId` is already in context, do not send "…is available!" on its own — continue straight
  into the site + plan outcome (§P1) in the *same* message.
- **Intent is CONNECT** → the user cannot connect a domain nobody has registered. Say:
  *"{displayName} isn't registered yet — did you mean you'd like to purchase it?"*
    - Yes → **go to §P1 and follow it.**
    - No → *"Do you own a different domain you'd like to connect?"* → back to §A4 with the new domain.

When no `siteId` is in context but the user did ask for a site, the availability answer and §P1's
site question belong in the **same** message — the answer first, the question behind it:

> mybakery.com is available! You have 93 Wix sites. Which one should it go on?
>
> 1. {site name}
> 2. … *(§R3 Case B's forms decide how many)*

One turn instead of two, and the ordering is still answer-then-question.

⚠️ **Suppressing the standalone line is a merge, never a deletion.** The user is told in plain
language that the domain can be bought — exactly once, in the first message that follows the check.
Both continuations carry it, and the merged forms live in §P1.3a and §P2.3, Premium and Free
respectively. If you are about to send a message that offers a plan, a price or a bundle and the user
has not yet heard *"{displayName} is available!"*, the line was dropped rather than merged. Say it.

### A4b — `available: false` (US-09)

The domain is registered. Registered by **whom** is the next question, and it decides everything that
follows — so answer it before you say a word.

#### Step 1 — whose domain is it? (silent)

Run the account lookup — **both** calls, together — exactly as [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §9
describes: endpoints, response shapes, the one silent retry, and what to do when it cannot run.

Compare the returned domain strings to `{domain}` **exactly** — `searchTerm` is a substring search
and a partial hit is not ownership.

- **User is not logged in**, or both calls fail after the silent retry → skip to **§A4b-C**.
  Ownership is unknown, which is what §A4b-C's copy already assumes.
- **Handed back by [Assign Domain](assign-domain.md)** — it found the domain is not in the account,
  or could not tell (signed out, or its read failed). Skip both calls and go to **[Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)** with ownership
  **asserted** — §A4b-C's CONNECT rule: no suggestions.

**This runs before the suggestions call and before any message.** Alternatives are only fetched in
§A4b-C. Fetching them first — as an earlier version of this skill did — means offering a user
replacements for a domain they already own.

| Exact match at | Branch |
|----------------|--------|
| `sites[].primary.domainName`, or `sites[].redirects[].domainName` | **§A4b-A** — theirs, already on a site |
| `domains[].domainName` (unassigned) | **§A4b-B** — theirs, not on a site yet |
| Nowhere | **§A4b-C** — not in their Wix account |

#### A4b-A — it is theirs, and already connected (US-40)

Read `siteName` from the **same** `sites[]` entry that matched. One message, then stop:

> {displayName} is already connected to **{siteName}**.

No suggestions. No connect link — there is nothing to connect. No *"if it's yours"* — the account
just said it is. **Terminal state.**

If the match came from `redirects[]` rather than `primary`, the domain is in use as a forward:

> {displayName} is yours — it's currently forwarding to **{siteName}**.

If the user wanted it in the **other role** on that same site (US-45), or on a **different** site
than the one it is on — a **move** (US-46) — this is not terminal after all. Ownership is confirmed, so
**go to [Assign Domain](assign-domain.md) and follow it**, carrying the domain, the requested site and
role, and ownership **confirmed**. **Do not compose the answer here, and do not ask *"Want to move it
to {requested site}?"* on its own** — Assign Domain's offer names the site the domain comes off, which
may be losing its primary domain.

#### A4b-B — it is theirs, and not connected to anything (US-41)

Ownership is settled, so there is no question to ask and nothing to hedge. **Go to
[Assign Domain](assign-domain.md) and follow it**, carrying the domain, the requested site and role
if the user named them, and ownership **confirmed**. It resolves the site, checks the plan, makes the
offer and does the work, or answers a Free site with the upgrade. **Do not compose any of that
wording here**, and do not promise in Part A that the domain will be connected.

Carrying ownership as *confirmed* is what lets Assign Domain offer to do the work rather than only
pointing at the dashboard; carrying it as *asserted* silently downgrades the user's outcome to a link.

No suggestions, no *"do you own this?"*, no *"if it's yours"*.

#### A4b-C — not in their Wix account (US-09)

It **cannot be purchased here** — Wix registers available domains, it does not resell taken ones.
This branch is short and closed.

⚠️ This branch is **not** "someone else owns it". A domain held at an outside registrar and never
connected to a Wix site is invisible to the lookup, so the user may well own it. Never say or imply
otherwise — see [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §9.

**CONNECT intent first — including every domain handed back by [Assign Domain](assign-domain.md).**
Skip everything below: no `suggest-domains` call, no alternatives. A domain they cannot register is
no use to them. Go straight to **[Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)** with ownership **asserted**. If
the user is logged out, it asks them to log in; once they do, its ownership check can run, and a match
hands the domain to Assign Domain.

**Any other intent:** do exactly two things: call `suggest-domains` with the SLD only for 3
alternatives (§A5), then send **one** message containing **only** this:

> {displayName} is already registered. If it's yours — you can connect it to a Wix site. Here are
> available alternatives that fit your brand:
> - theetzlenu.com
> - etzlenu.net
> - etzlenuco.com

**That is the entire response.** No registrar, no "someone renewed it six months ago", no valuation,
no broker or outreach option, no TLDs you thought of yourself. If your answer to a taken domain is
longer than the block above, you have left this skill — see §A1.1.

The *"If it's yours"* hedge is correct **here and only here** — either the ownership check found
nothing, or it could not run. Ownership is a guess in this branch, and the copy says so honestly.

**No connection is performed on this path.** §A4b-B can offer to do the work because an account lookup
proved the domain is the user's; here nothing proved it. Assign Domain refuses to write an unverified
domain onto a live site, so the connect link is the whole of what this branch can offer — no
primary-or-redirect question, no assignment, however plainly the user says it is theirs. If they are right and the domain is theirs at an outside registrar, the dashboard is where
that gets sorted out.

**This holds even when the user asked to connect it "to my site" — or to *assign* or *bind* it
there** (§A2). That request names an assignment, and an assignment cannot run on a domain the
account does not hold; bringing it into Wix comes first and the link is what does that. Give the link, and do not
promise the site assignment as though it were about to happen. Do not lecture them about the order
either: the link goes to the page where both steps are completed, so *"you can connect it to a Wix
site"* is a true and sufficient answer.

The one thing that can change this: the user was **logged out**, logs in, and the ownership check runs
for the first time (Connect External Domain or Sub Domain §3, Case C). A match found then goes to
Assign Domain, and the offer comes with it.

The three alternatives are whatever `suggest-domains` returned, in the order it returned them. For
`etzlenu.com` that is `theetzlenu.com`, `etzlenu.net`, `etzlenuco.com` — **not** a `.io`/`.dev`/`.app`
list you assembled. Those may well be available; they are still fabricated output, because no call
produced them.

Then branch on the reply:

- Picks an alternative → that is the chosen domain, **skip re-checking availability** (US-06) →
  **go to §P1 and follow it.**
- Says it is theirs / wants to connect → **go to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) and follow it**, carrying the
  domain, the fact that it is already known to be taken, and ownership **asserted by the user**
  (not confirmed — the account search did not find it).
- Wants something else → back to §A3.


### A4c — `DOMAINS_UNSUPPORTED_TLD`

→ §A6.

### A4d — Any other failure

→ §R8. Retry once silently; the user should never learn a first attempt
happened.

---

## A5. Suggestions (US-04, US-05, US-06)

### First page — exactly 3

```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query={query}&paging.limit=3
```

**Always `paging.limit=3`.** Three options is the contract — never dump ten.

Query construction:

| Coming from | Query |
|-------------|-------|
| A taken domain | The **SLD only** — `mybusiness.com` → `mybusiness` |
| An unsupported TLD | The **SLD only** — `myshop.ws` → `myshop` |
| A business idea or brand context | The description — `pancakes restaurant`, `Green Sprout Bakery` |

Keep the query short — roughly 12–15 characters works best. Drop filler words
(`thebestflowershopintown` → `bestflowers`), collapse repetition (`gevageva…` → `geva`), abbreviate
(`professional` → `pro`).

Present them as a plain bulleted list of `suggestions[].domain`, then invite both a pick and more:

> Here are a few available options that fit your brand:
> - cozycuts.com
> - cozycuts.co
> - cozycuts.net
>
> Want one of these, or do you have something else in mind? I can also show more options if none feel right.

When the suggestions come from business context rather than a typed domain, open with
*"Here are a few available options based on your business name:"* instead.

Rules:

- Every suggestion returned is already available. **Never re-check one.** (US-06)
- Never show a "premium" column or flag premium suggestions.
- If the user stated a TLD preference, call out the fitting ones (`.com` general, `.shop` / `.store`
  e-commerce, `.me` personal branding).
- No suggestions returned → ask the user for different or broader keywords.

### "Show more" (US-05)

Offer more only when `pagingMetadata.hasNext` is `true`. To actually fetch them, repeat the **same**
`query` and `paging.limit=3` and add `paging.cursor={pagingMetadata.cursors.next}` from the previous
response. `hasNext` alone does not page — without the cursor you get page 1 again.

> Here are more available options:
> - greensproutbakeryshop.com
> - gsbakery.com
> - greensproutco.com

Repeat with each new cursor for as long as the user keeps asking.

### After a pick

The picked domain is the chosen domain. Do **not** check its availability.

- Intent PURCHASE or UNKNOWN → **Now go to §P1 and follow it.**
- Intent CONNECT → the user is picking a domain to buy, not to connect. Treat as PURCHASE.

---

## A6. Unsupported TLD — Split by Intent (US-10, US-11, US-12)

Detected as an HTTP 400 body with `details.applicationError.code === "DOMAINS_UNSUPPORTED_TLD"` —
there is no `availability` object on this response. See §R4.1.

The message opens the same way for both intents:

> We don't currently support .{TLD} domains.

What follows depends on intent — **these two branches are different and must not be merged.**

### A6a — PURCHASE intent (US-11)

Fetch 3 alternatives with the SLD only as the query (§A5) and show them in the **same** message:

> We don't currently support .ws domains. Here are some available alternatives:
> - myshop.com
> - myshop.net
> - myshop.co

User picks one → skip the availability check → **Now go to §P1 and follow it.**

### A6b — CONNECT intent (US-12)

Do **not** show alternatives — a domain they do not own is no use for connecting. Ask for another
domain instead:

> We don't currently support .ws domains. Do you have a different domain you'd like to connect?

- User gives another domain → normalize → back to §A4.
- User has none → offer to buy one instead: *"Would you like to look for a domain to purchase
  instead?"* If yes → §A5, then **§P1**.

### A6c — UNKNOWN intent

Treat as PURCHASE (§A6a), and let the alternatives list do the disambiguating.

---

## A7. Routing Summary

Every branch of Part A ends in exactly one of these. Name the destination to yourself, then follow
that section — do not improvise the next step from memory.

| State reached | Next |
|---------------|------|
| Domain available, buying | **Go to §P1 and follow it.** |
| Suggestion picked | **Go to §P1 and follow it.** |
| Unsupported TLD, alternative picked | **Go to §P1 and follow it.** |
| Domain is the user's and already on a site (§A4b-A) | **Nowhere — terminal.** One message, then stop. Unless the role or the site is wrong: **[Assign Domain](assign-domain.md)**. |
| Domain is the user's and unconnected (§A4b-B) | **Go to [Assign Domain](assign-domain.md) and follow it** — ownership **confirmed**. |
| A domain to put on a site, or a change of its role or site (§A2, *CONNECT → a site*) | **Go to [Assign Domain](assign-domain.md) and follow it.** |
| Handed back by Assign Domain — not in the account, or it could not tell | **§A4** with intent *CONNECT → a site*: available → §A4a; taken → **[Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)** with ownership **asserted**, no lookup, no suggestions. |
| Domain taken and the user says it is theirs (§A4b-C) | **Go to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) and follow it** — ownership **asserted**. Link only, **no assignment**. |
| A subdomain (§A3) | **Go to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) and follow it.** No availability check. |
| Connect intent, domain not registered, user wants to buy | **Go to §P1 and follow it.** |
| Persistent failure | §R8 — escalation ladder, then the fallback link |

Both paths restate their own entry preconditions — what has to be true on arrival.

---

## A8. Fallback (US-38, US-39)

A call that fails twice is handled the same way everywhere in this skill — silent retry, then the
escalation ladder, then the fallback link. **§R8 is the rule**, including the verbatim copy at each
stage. Never expose an error code, endpoint or tool name in any of it.

---

# Part P — Purchase Path

**Entry preconditions** — you arrive here from Part A with:

1. A single **chosen domain**, already normalized, and
2. Confirmation it is buyable — either `available: true` from the availability check, or it came
   from the suggest endpoint (suggestions are always available, never re-check one).

If either is missing, go back to §A3–§A6 and settle it first.

**Terminal states** — this path ends in exactly one of:

| Terminal state | Reached when |
|----------------|--------------|
| **Checkout link** | The user completed registration details and the cart is built (§P9) |
| **Bundle link** | A Free-tier user chose plan + domain together (§P2) |
| **Error fallback** | Two failed attempts — §R8 |

**Read Part R before any call.** Endpoints, product IDs and URL templates all live there.

Covers **US-18 – US-32**.

---

## P1. Site and Plan Outcome (US-18, US-19)

### P1.1 Resolve the site

Domain purchase does **not** require a Wix site. Apply the site-resolution rules in
§R3 — Case A (siteId in context), Case B (logged in → fetch list of sites),
Case C (not logged in → inline login prompt), Case D (logged in, ask once).

Do **not** fetch list of sites unless the user asked about a site or answered yes to the question.

- **No site resolved** → skip §P1.2 and §P2 entirely. No premium check, no voucher check, no upgrade
  pitch. Go to §P3 as a standalone purchase.
- **Site resolved** → keep `siteId` and the site's display name; go to §P1.2.

### P1.2 Check the site's plan

```
GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}
```

Read `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.

Do this **silently**. Record whether the site was Premium or Free here — §P7 compares against it.

### P1.3a Premium site (US-18)

Say, verbatim:

> Great — after purchasing, {displayName} will auto-connect to **{site name}**.

When the site was already known from context — which is exactly when §A4a suppressed the standalone
*"is available!"* line — merge the two into one message:

> {displayName} is available! After purchasing, it will auto-connect to **{site name}**.

Go to §P3.

### P1.3b Free-tier site → §P2.

---

## P2. Free-Tier Offer (US-19, US-20, US-21, US-22, US-23)

The site exists but has no Premium plan. The user gets a real choice: upgrade and take the domain as
part of the plan, or buy the domain on its own.

### P2.1 Is the TLD coupon-eligible? (US-20)

The "free for the first year" promise is **TLD-dependent — never promise it blindly.**

```
com.wixpress.premium.domain.tlds.DomainTld/ListTlds
Body: { "filter": { "tlds": ["{TLD_WITHOUT_DOT}"] } }
```

`coupons_applicable: true` → eligible. Anything else → not eligible. If the call is unavailable,
fall back to the static TLD list in §R7.

### P2.2 Is a Premium plan on sale? (US-21)

The `getPremiumSale` context call (`wix.premium.store.v1.sales/GetSale`) runs automatically.

- Returns `saleDetails` with data → a sale is active. Useful fields: `saleDiscount`,
  `saleEndDate`, `remainingDays`.
- Returns empty / no `saleDetails` → no sale. Say nothing about sales.

### P2.3 Present the offer

**If a `siteId` was in context, this message owes the user the availability line.** §A4a held back
the standalone *"{displayName} is available!"* so it could be merged into the site + plan outcome, and
this is the branch that merges it — §P1.3a does the same job on a Premium site. Lead with it and
let the rest of the copy stand:

> {displayName} is available! **{site name}** doesn't have a premium plan yet, and connecting a domain
> requires one. Upgrade and you can get it free for the first year — or buy it on its own at full
> price and connect it after you upgrade. Want me to generate a bundle link?

The **not coupon-eligible** variant takes the same opener. The **just-logged-in** variant does not —
that user came through the login prompt, which only ever appears after *"is available!"* has already
gone out on its own.

**Coupon-eligible TLD** — verbatim:

> **{site name}** doesn't have a premium plan yet, and connecting a domain requires one. Upgrade and
> you can get {displayName} free for the first year — or buy it on its own at full price and connect
> it after you upgrade. Want me to generate a bundle link?

**Not coupon-eligible** — the free-year clause would be false, so drop that clause and keep the rest:

> **{site name}** doesn't have a premium plan yet, and connecting a domain requires one. Upgrade and
> you can connect {displayName} to your site — or buy it on its own at full price and connect it
> after you upgrade. Want me to generate a bundle link?

**If a sale is active**, append one line to whichever version you used:

> There's also {saleDiscount}% off Premium plans right now — {remainingDays} days left.

**If the user just logged in or created an account in response to the connect prompt**
(§R3 Case C), they have already said yes to connecting. Skip the question and
deliver the offer with the link in the same message — the connect constraint still gets stated:

> Welcome! Your new site doesn't have a premium plan yet, and connecting a domain requires one.
> Upgrade and you can get {displayName} free for the first year →
>
> [Get domain free with a site plan]({bundle URL})

> **Why the constraint is in the sentence.** US-19 asks for an *informed* decision, and the fact that
> makes this a decision rather than an upsell is that the standalone route leaves the domain
> unconnected until the user upgrades.
>
> Two things the copy is careful **not** to do. It does not list what Premium includes — §P10 still
> forbids that, and *"connecting a domain requires one"* is a constraint, not a feature pitch. And it
> frames buying alone as **deferred**, not forbidden: buy now, upgrade later, connect then. That is
> what actually happens, so *"you can't"* would be wrong.

### P2.4 User accepts the bundle (US-23)

> Here's where you can pick a plan and get {displayName} free for the first year →
>
> [Get domain free with a site plan](https://manage.wix.com/premium-pricing/wix/select-plan?domainName={domain}&referralAdditionalInfo=add-domain-purchase-intent&siteGuid={siteId}&showDomain=true)

Use the full domain in `domainName`, the resolved `siteId` in `siteGuid`. When the TLD is not
coupon-eligible, use the label `[Get your site live at this domain]` instead — do not promise a free
year.

**This is a terminal state. Stop here.** Do not continue to §P3, do not build a cart.

### P2.5 User declines the bundle (US-22)

Reply *"No problem."* and continue to §P3 as a standalone purchase. Do not re-pitch the upgrade.

**Do not restate the connect constraint here either.** §P2.3 put it in front of the choice, which is
where it changes a decision. Repeating it after the user has decided is a second pitch wearing a
warning's clothes.

Keep the `siteId` in memory — §P7 re-checks the plan, and the user may upgrade in another tab.
But treat the purchase as standalone for now: no `msid` on the checkout link unless §P7 changes it.

---

## P3. Registration Period (US-24)

```
POST https://manage.wix.com/_api/premium-purchase-platform-serverless/v1/offering/72af0602-1321-4897-8299-f507480b2bb8
Body: { "purchaseContext": { "params": { "tld": ".{TLD}" } } }
```

Include the leading dot in `tld`.

- Save `products[0].productId` — the cart needs it in §P8. Never hardcode it.
- Render **every** entry in `products[0].pricingDetails[]` as a table, and **only** those entries.

Valid cycles are a subset of **1, 2, 3, 5 and 10 years**, and the subset varies by TLD — some start
at 2, some stop at 3, some go to 10. Do not add a row the API did not return, and do not drop one it
did.

**Sort the rows ascending by `cycle.cycleDuration.count`.** The API does not return them in order —
`.org` and `.biz` both come back `10, 5, 2, 3, 1`. Rendering the array order gives the user a jumbled
table.

#### Which fields — exactly three per row

Each `pricingDetails[]` entry carries several price objects. Read these and no others:

| Column | Field | Verified value (`.biz`, 1 year) |
|--------|-------|--------------------------------|
| Duration | `cycle.cycleDuration.count` + `.unit` | `1` `YEAR` → *1 year* |
| **You pay now** | `finalPrice.total.formattedAmount` | `$7.90` |
| **Renews at** | `renewalPrice.total.formattedAmount` | `$35.90` |

Always `formattedAmount` — it arrives with the currency symbol and the right number of decimals.
Never take `amount` and format it yourself, and never do arithmetic on either.

`renewalPrice.total` is the charge for **the same period again** — for a 2-year row it is the next
2-year charge, not a yearly rate. The header wording is what carries that; if it ever proves
confusing, fix the header, do not add a footnote after the table.

⛔ Do **not** read these, all of which are in the same response and all of which will produce a wrong
or unexplainable number: `catalogPrice` (the undiscounted list price — showing it next to *"You pay
now"* invents a discount claim), `initialPurchasePrice` (identical to `finalPrice.total` in every row
observed — if it ever differs, that is new information to check, not a free choice), `lowestCyclePrice`
(its name and its value are consistent with two different meanings in the data observed, so it is
unverified), and any `monthly*` or `subtotal*` variant. `savings` appears on some rows and not others —
never render it.

Message **shape** — one row per returned `pricingDetails[]` entry and no other rows:

> No problem. How many years would you like to register {displayName} for?
>
> | Duration | You pay now | Renews at |
> |----------|-------------|-----------|
> | {cycle 1 duration} | {cycle 1 finalPrice} | {cycle 1 renewalPrice} |
> | {cycle 2 duration} | {cycle 2 finalPrice} | {cycle 2 renewalPrice} |
> | … one row per entry the API returned, shortest first … |
>
> At checkout, prices may be shown in your local currency.

(Open with *"No problem."* only when the user has just declined a site or a bundle. Otherwise open
with *"How many years would you like to register it for?"*.)

That closing line is fixed and it is required — this is the first place the user sees a price, and
every message that shows one carries it. Wording and the full rule: §R10.

Ask the user to pick. If they have no preference, default to the shortest available period.

> **Why the renewal column is not optional.** The first-term price is discounted and the renewal price
> is not — for `.biz` that is `$7.90` now against `$35.90` at renewal, a 4.5× step the user finds out
> about a year later. A single-price table is accurate and still misleading.

### ⛔ Never invent a price

Every number in that table comes from **this response and this response only**. There is no fallback
price list anywhere in this skill or in your own knowledge. A `.com` does not
have a price you already know.

| Situation | What to do                                                                                                                                                                                                                       |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Call succeeded | Render its rows. Nothing else.                                                                                                                                                                                                   |
| A row has `finalPrice` but no `renewalPrice` | Leave that cell empty. **Never** fall back to `catalogPrice`, and never carry a renewal figure across from another row. Not observed in any response so far — if it happens, it is an unknown, and an unknown price stays blank. |
| **No products returned** | *"Wix doesn't support purchasing this TLD. Try a different extension like .com, .net, or .org."* Then offer suggestions (§A5).                                                                              |
| **Call failed** | Retry once silently, then the escalation ladder (§R8).                                                                                                                                                      |
| **Call cannot be made at all** — no Wix session, no authenticated tool available in this channel | **Stop the flow.** Say: *"I can't pull up live pricing right now. You can see current prices and register the domain here → [https://manage.wix.com/account/domains](https://manage.wix.com/account/domains)"* Do **not** continue to §P4.                      |

That last row is the one that bites. When the offering call is unavailable, the tempting move is to
show a plausible table and carry on — a fabricated price the user may act on. **A missing price ends
the flow; it never gets filled in from memory.**

If you find yourself about to write `$7.90`, `$14.95`, or any other specific figure that did not
arrive in an API response during *this* conversation, you are hallucinating pricing. Stop.

---

## P4. Contact Details (US-27, US-28)

```
GET https://manage.wix.com/v1/domain-registration-intents/preview/{domain}
```

Address fields are **flat** on each contact — `streetAddress`, `city`, `country`, `postalCode`.
There is no nested `address` object.

### P4.1 Contacts exist (US-27)

Show them and ask for explicit confirmation. **Never skip this — never assume.**

> I have your contact details on file — would you like to use these?
>
> - Name: John Doe
> - Email: john@example.com
> - Phone: +1.2125551234
> - Address: 123 Main St, New York, US 10001

- Confirmed → §P5.
- Wants different details → collect as in §P4.2.

### P4.2 No contacts (US-28)

Ask for every field, one per line:

> I'll need a few details to register the domain:
>
> - First name
> - Last name
> - Email
> - Phone (e.g. +1.5551234567)
> - Street address
> - City
> - Country
> - Postal code

Field rules:

- **Phone** — `+{countryCode}.{number}`, e.g. `+1.5551234567`, `+972.533456789`.
- **Country** — accept a full name and convert to the 2-letter ISO code before saving
  ("Israel" → `IL`, "United States" → `US`).

The user may answer in a single line ("Alex Johnson, alex@cozycuts.com, +1.5032218800, 310 Oak Ave,
Portland, US, 97201") — parse it, do not make them re-enter field by field.

---

## P5. Save Contacts (US-29)

Do this immediately once contacts are confirmed or collected — before asking about privacy — so
validation problems surface while the user is still thinking about their details.

Generate a random UUID as `sessionId` (`wsess`). It links the contacts to the cart; keep it, §P8
needs the same value.

```
POST https://manage.wix.com/v1/domain-registration-intents/upsert
```

```json
{
  "domainRegistrationIntent": {
    "domain": "{domain}",
    "sessionId": "<wsess>",
    "registrantContact": {
      "firstName": "...", "lastName": "...", "email": "...", "phone": "...",
      "streetAddress": "...", "city": "...", "country": "...", "postalCode": "..."
    },
    "adminContact":  { ...same as registrant... },
    "techContact":   { ...same as registrant... }
  }
}
```

Use the same contact for registrant, admin and tech — standard for individual registrations.

### Validation errors (US-29)

Name only the fields that are actually wrong, in plain language. Never show the raw error, a field
path, or a code.

> There's an issue with one of your details — can you double-check this?
>
> - **Email** — doesn't look like a valid email address

Take the correction, retry the upsert, and carry on. Some TLDs need extra fields — `.com.br` an
identification number, `.it` an entity type. If the error is about a TLD-specific requirement,
explain what is needed and ask for it.

On success, go to §P6.

---

## P6. Privacy Protection (US-25, US-26)

The options come from the offering call with the addon product type (§R4.2), **scoped to the
domain's TLD** — the same body shape as §P3, leading dot included:

```
POST https://manage.wix.com/_api/premium-purchase-platform-serverless/v1/offering/b3d86a1d-9db3-4f69-bd54-c132808856b1
Body: { "purchaseContext": { "params": { "tld": ".{TLD}" } } }
```

⛔ **Never call it without the `tld`.** The paid addons vary by TLD — `.com.au`, `.com.br`, `.info`
and `.biz`, for example, have no Privacy + DNSSEC. An unscoped answer is not an answer for this
domain.

Match each entry in `products[]` by its ID against the product-ID table at the end of this section.
**Offer only the paid addons whose IDs came back.** "No protection" is always offered.

| Paid addons returned | What to show |
|----------------------|--------------|
| Privacy + DNSSEC **and** Privacy only | All three options, Privacy + DNSSEC marked *(recommended)* |
| Privacy only | Privacy only *(recommended)* and No protection. No DNSSEC line, no mention of it |
| Privacy + DNSSEC only | Privacy + DNSSEC *(recommended)* and No protection |
| Neither | Skip the question. Say once that the registration will be public (*"Privacy protection isn't available for .{TLD}, so the registration will be public."*) and go to §P7 — **no addon line item** in §P8 |

⛔ **Never put an addon product ID in the cart that this TLD-scoped call did not return.** An addon
the response left out is not offered at all — not without a price, not as *"recommended"*, not on
request. Checkout rejects it (`MissingDomainBundleMetadata`) and the user is left with a cart that
cannot be paid.

The addon response has the **same shape as §P3's** — one `pricingDetails[]` entry per cycle, with
`finalPrice` and `renewalPrice` on each. The registration period is already chosen by the time you
get here, so **read the row whose `cycle.cycleDuration.count` matches the chosen term** and take
`finalPrice.total.formattedAmount` from it. Never sum, never divide, never take the 1-year row and
multiply.

Message **shape** — one line per option the response allows, built from the table above. The full
form, when both paid addons came back:

> How would you like to protect your registration?
>
> - **Privacy + DNSSEC** *(recommended)* — Keeps your personal info off public records while also protecting your domain from being hijacked or redirected by attackers — {price}
> - **Privacy only** — Hides your personal contact info from public records — {price}
> - **No protection** — Your contact info will be publicly visible — Free
>
> At checkout, prices may be shown in your local currency.

When Privacy + DNSSEC did not come back, its line is gone and Privacy only takes the recommendation:

> How would you like to protect your registration?
>
> - **Privacy only** *(recommended)* — Hides your personal contact info from public records — {price}
> - **No protection** — Your contact info will be publicly visible — Free
>
> At checkout, prices may be shown in your local currency.

The currency note is required here too (§R10). It qualifies the `{price}` figures and not
*"Free"* — free is not a currency amount. So it appears only when at least one priced option is
shown; a message with no price in it carries no note.

`{price}` carries the term, and the term is whatever the user picked:

| Chosen term | `{price}` reads |
|-------------|-----------------|
| 1 year | `{finalPrice}/yr` |
| N years | `{finalPrice} for {N} years` |

⛔ **`/yr` on a multi-year term is wrong here for the same reason it is wrong in §P9.** The addon
figure is the charge for the whole period — verified live: Privacy + DNSSEC comes back `$12.90` for
the 1-year cycle and `$38.70` for the 3-year one. Writing *"$38.70/yr"* triples the price in the
user's head. (Those two figures illustrate the shape and are never printed to a user — §P9's closing
rule.)

`{price}` is whatever the addon offering call returned for that product ID. **"No protection" is the
only one whose price is known ahead of time — it is Free.** A paid addon is shown only because the
response returned it, so its price comes from that same entry. If a returned addon has no row for the
chosen term, do not offer it. The same rule as §P3 applies — a figure you did not receive in this
conversation is a fabrication, and the wording above is a template, not a price list.

| Choice | Addon product ID |
|--------|------------------|
| Privacy + DNSSEC | `f8211619-d9f6-4312-9d03-f2958bbd08aa` |
| Privacy only | `22a84545-4ac0-4490-a434-45a1ebc479fb` |
| No protection | `b9d89ff0-f29b-4bfd-a3f0-6e34ae65120d` |

Addon product type for all three: `b3d86a1d-9db3-4f69-bd54-c132808856b1`.

The user may pick any option shown (US-26) — recommend, never push. "No protection" is a legitimate
answer; accept it without a warning.

---

## P7. Pre-Cart Premium Re-Check (US-30)

Run this **only** when a `siteId` was resolved in §P1 and the site was **Free** at that point. Skip it
for standalone purchases with no site, and for sites already Premium.

The user may have upgraded in another tab while answering the questions above. Re-check silently,
just before building the cart:

```
GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}
```

| Result | Effect |
|--------|--------|
| Still Free | Nothing changes. Standalone checkout, no `msid`. |
| Now Premium | Tell the user, and add `msid={siteId}` to the checkout URL. |

When it flipped to Premium, add one line to the final message — **after** *"Setting up your
order..."* and **before** the summary:

> Setting up your order...
>
> **{site name}** is now on a Premium plan — {displayName} will auto-connect after purchase.
>
> Here's your summary:
> …

Never mention the check itself, and never mention it when nothing changed.

---

## P8. Build the Cart (US-32)

Use `CallWixSiteAPI` (with `siteId`) when a site is in play, otherwise `ManageWixSite`. Both carry
Wix session auth — add no headers.

Three calls, in order, **silently**:

1. **Cancel the existing cart** — `POST https://manage.wix.com/_api/premium-cart/v1/carts/active/cancel` · Body `{}`
   Succeeds even when there is no active cart. This is what stops leftovers from an earlier session
   ending up in the user's order.
2. **Get a fresh cart** — `GET https://manage.wix.com/_api/premium-cart/v1/carts/active`
3. **Add items** — `PATCH https://manage.wix.com/_api/premium-cart/v1/carts/active/add-items`

```json
{
  "lineItems": [
    {
      "productInfo": { "productId": "<products[0].productId from §P3>",
                       "productTypeId": "72af0602-1321-4897-8299-f507480b2bb8" },
      "cycle": { "cycleDuration": { "count": <years>, "unit": "YEAR" }, "cycleType": "RECURRING" },
      "metadata": { "domainName": "{domain}", "wsess": "<wsess from §P5>", "core": "true" }
    },
    {
      "productInfo": { "productId": "<addon product ID from §P6>",
                       "productTypeId": "b3d86a1d-9db3-4f69-bd54-c132808856b1" },
      "cycle": { "cycleDuration": { "count": <years>, "unit": "YEAR" }, "cycleType": "RECURRING" },
      "metadata": { "domainName": "{domain}", "wsess": "<wsess from §P5>" }
    }
  ]
}
```

- The addon cycle duration must match the domain's.
- `core: "true"` goes on the domain line item only.
- Include the addon line item for whichever option the user picked in §P6, including "No protection" —
  it is a product, not an absence. The one exception is an ID the TLD-scoped addon call did not return:
  that line item is left out, and so is the whole addon line when §P6 skipped the question.
- ⛔ Never add an addon product ID the TLD-scoped call in §P6 did not return — checkout fails on it.
- Never announce any of these three calls. The only thing the user sees is
  *"Setting up your order..."*.

---

## P9. Checkout Link (US-30, US-31)

| Condition | Checkout URL |
|-----------|--------------|
| A site is attached — Premium in §P1.3a, or flipped to Premium in §P7 | `https://manage.wix.com/cart/checkout?msid={siteId}` |
| Standalone — no site, or the site is still Free (US-31) | `https://manage.wix.com/cart/checkout` |

Final message:

> Setting up your order...
>
> Here's your summary:
> - **{displayName}** — {N} year(s) — {finalPrice} (renews at {renewalPrice}{term suffix})
> - **{privacy option}** — {N} year(s) — {finalPrice} (renews at {renewalPrice}{term suffix})
>
> At checkout, prices may be shown in your local currency.
>
> Here's your checkout link → [Complete your purchase]({checkout URL})

The currency note sits **between the summary and the link**, so the link is still the last thing in
the message (§R10). This is the screen the user actually reads before paying, so it is the one place
the note matters most.

For "No protection", the second line reads `- **No protection** — Free`. It has no renewal clause —
`$0.00` does not renew at anything worth saying. When the cart has no addon line item (§P8), the
summary has no second line.

### The renewal clause — two forms, and only two

`renewalPrice.total` is the charge for **the same period again**, not a yearly rate. So the suffix
depends on the term:

| Term | The line reads |
|------|----------------|
| `N = 1` | `- **{displayName}** — 1 year — {finalPrice} (renews at {renewalPrice}/yr)` |
| `N > 1` | `- **{displayName}** — {N} years — {finalPrice} (renews at {renewalPrice} every {N} years)` |

⛔ **Never write `/yr` on a multi-year term.** For a 3-year `.biz` the renewal figure is `$107.50` —
the next *three-year* charge. *"renews at $107.50/yr"* overstates it threefold. This is the single
most likely way to get this section wrong, and it is wrong in the direction that scares a user off a
purchase they were about to complete.

### Where the two figures come from

Both are the ones **§P3 already fetched for the chosen cycle** —
`finalPrice.total.formattedAmount` and `renewalPrice.total.formattedAmount` from the
`pricingDetails[]` row the user picked. Reuse them:

- **Never re-request.** The offering call already ran; calling it again is a second chance to get a
  different answer.
- **Never recompute.** §P3's ban on arithmetic holds here — no dividing a 3-year renewal by three, no
  multiplying a 1-year figure up.
- **Never estimate.** If §P3 rendered a blank renewal cell for the chosen row, the summary line drops
  the clause entirely and shows the price alone. A blank stays blank; it does not get filled in at
  checkout time.

### The privacy addon line

The addon carries `renewalPrice` too — **verified live** against the addon product type
(`b3d86a1d-9db3-4f69-bd54-c132808856b1`), same `pricingDetails[]` shape as the domain, one row per
cycle. So the addon line gets the same treatment as the domain line: same two term forms, same
prohibition on `/yr` for a multi-year term, same reuse rule (§P6 already read the row for the chosen
cycle).

One observed difference, and it is not a reason to change the shape: on all three addon products the
renewal figure **equals** the first-term figure — Privacy + DNSSEC is `$12.90` now and `$12.90` at
renewal, Privacy only `$9.90` and `$9.90`. Unlike the domain, the addon has no introductory discount.
Print the clause anyway. *"$12.90 (renews at $12.90/yr)"* is the useful answer to *"does this one
jump too?"*, and suppressing it whenever the numbers match would make its absence look like missing
data rather than a flat price.

> **Why the summary carries a renewal at all.** §P3's table already showed it, and this is the last
> screen before payment — the one the user actually reads. A summary that shows only *"$7.90"* on a
> domain that renews at `$35.90` is accurate and still leaves the user surprised in twelve months.
> The number is already in hand; the only work here is printing it with the right period attached.

⛔ **Every figure in this section is an observation about shape, not a price.** `$107.50`, `$12.90`,
`$9.90`, `$7.90`, `$35.90` — all of them are here to show which period a number covers and how far a
renewal can step. **None of them is ever printed to a user.** §P3's rule is the whole rule: a figure
that did not arrive in an API response during *this* conversation is a fabrication, and that applies
to numbers read out of this document exactly as it applies to numbers read out of your own
knowledge.

The user's only remaining step is payment; say nothing more.

**Terminal state. Stop here.**

---

## P10. Forbidden Actions

❌ **Never:**

- Promise "free for the first year" without confirming coupon eligibility (§P2.1).
- **Present the Free-tier choice without the connect constraint.** *"Want a bundle link?"* on its own
  is an upsell; the same question with *"connecting a domain requires one"* in front of it is a
  decision. US-19 asks for the second. Both §P2.3 variants carry the clause, including the
  just-logged-in one.
- **State a renewal figure per year for a multi-year term.** `renewalPrice.total` is the charge for
  the same period again — `/yr` belongs on a 1-year term and nowhere else (§P3, §P6, §P9).
- Mention a sale that `getPremiumSale` did not report.
- Skip the contact confirmation in §P4.1 because the details "look right".
- Continue to §P3 after the user accepted a bundle link — that is the end of the flow.
- Put `msid` on a standalone checkout link, or leave it off when a Premium site is attached.
- Re-check availability for a domain that came from the suggest endpoint.
- **Offer, recommend or add to the cart a paid addon the TLD-scoped addon call did not return** (§P6).
- Narrate cart operations, contact saving, or the premium re-check.

✅ **Always:**

- Render exactly the cycles the offering call returned.
- **Carry the currency note in the same message as any price the user sees** — §P3, §P6 and §P9.
  Fixed wording, and never a currency name or a conversion (§R10).
- Show what the domain renews at wherever its price appears — the period table (§P3) **and** the
  pre-checkout summary (§P9). Same two figures, fetched once.
- Reuse the same `wsess` across the intent save and both cart line items.
- Keep `siteId` from §P1 through §P9.

---

# Part R — Reference

**Read this part before making any API call.** It is the single source of truth for endpoints,
product IDs, URL templates, site resolution and error handling. Parts A and P both defer to it —
where they disagree with this part, this part wins.

Covers **US-13, US-14, US-15, US-16, US-37, US-38, US-39**.

The account lookup ([Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §9) is the mechanism behind **US-40** and **US-41**, and it is what scopes
**US-09** to domains the lookup does not find. **US-42 – US-46** (putting a domain the account holds
on a site, changing its role, moving it) are [Assign Domain](assign-domain.md)'s. This skill never
writes to a user's site.

---

## R1. Domain Normalization

Apply **before** any API call, every time a domain is read from the user:

- Strip `http://` and `https://`
- Strip `www.`
- Strip any trailing path, query string or slash (`example.com/shop` → `example.com`)
- Lowercase
- If there is no TLD, add `.com` (`example` → `example.com`)

The normalized value is `{domain}` everywhere below. Always use the **full** domain in URLs and
API calls — never the truncated display form.

---

## R2. Domain Display Truncation

Only the *visible label* is ever truncated. Two values exist for every domain:

| Value | Use |
|-------|-----|
| `domainName` | Full normalized domain — URLs, API calls, cart metadata |
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

---

## R3. Site Resolution

Both paths need to know *which* Wix site (`siteId`, also called `msid`) is in play. The rules are
the same; **when** they run differs:

- **Purchase path** — a site is optional. Resolve only after the domain is chosen. See §P1.
- **Connect path** — a site is required. That path is [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md), which
  resolves the site itself, after the availability check.

### Case A — `siteId` already in context (US-13)

The system prompt, environment or dashboard context already provides a `siteId` / `msid`.

→ Use it directly. **Do NOT fetch list of sites.** Do not ask the user to pick a site.

> **The user naming a site is not the same thing.** If they say *"my site is called My Bistro"* but
> no `siteId` is in context, you still need to fetch list of sites to turn that name into an ID — go to
> Case B. What their answer buys you is skipping the *"which site?"* question, not the lookup. Match
> the name against the returned sites; if nothing matches, list what came back and ask.

> **A roster in context is not a resolved `siteId` either.** The host may preload part of the
> account's site list — ten of ninety-three, say — into the system prompt or site context. That is
> **not** Case A. It names no site for *this* domain, it may not even contain the right one, and it
> hands you no `siteId` for the task. Go to Case B and fetch list of sites. Every prohibition on that
> call is about a `siteId` you already hold, never about a list you happened to be shown.

### Case B — user is logged in, no `siteId` in context

→ Fetch list of sites.

| Result | Action |
|--------|--------|
| Exactly one site (US-14) | Use it directly, no question asked. Name it in your next message so the user can spot a mistake. |
| 2 – 8 sites (US-15) | **List them all, numbered, in the same message as the question:** *"You have a few Wix sites — which one should this domain be connected to?"* (*"a couple"* when there are exactly two.) Wait for the pick. |
| More than 8 | Still a list, never a count — name the total, show five, invite a name. Copy below. Wait for the pick. |
| No sites | Purchase path → continue standalone. Connect path → Connect External Domain or Sub Domain §7. |

**More than eight sites.** A numbered wall of ninety-three is unusable, and a bare count is worse.
Name the total, show five, and leave the door open:

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

⛔ **Never announce the count and stop.** *"You have 93 sites — would you like me to list them?"* asks
permission for the step you were already told to take. The user has asked for their domain on a site;
the list is what moves that forward and a count moves nothing. It costs a turn and answers nothing.

### Case C — user is not logged in (US-16)

Do **not** ask a yes/no question about sites — the user cannot answer it usefully. Show the optional
inline prompt instead, verbatim:

> If you'd like to connect this domain to a Wix site — [Log in or create a Wix account]

- User logs in → go to Case B (fetch list of sites).
- User declines ("No, I'll just buy it for now") → standalone purchase, no `siteId`, no premium
  pitch, no voucher check. Reply *"No problem."* and continue.

The destination behind *[Log in or create a Wix account]* is supplied by the host channel's
sign-up/login affordance. In a channel with no widget runtime, link to `https://www.wix.com/`.

### Case D — user is logged in and no site was mentioned

Purchase path only. Ask once, verbatim:

> Would you like to connect this domain to one of your Wix sites?

- Yes → Case A or B.
- No → standalone purchase, no `siteId`. Reply *"No problem."* and continue.

Once a `siteId` is resolved, **remember it for the rest of the conversation** and reuse it in the
premium check, the bundle link and the checkout link.

---

## R4. API Reference

### R4.1 Public — no auth

These are open endpoints. Send a plain GET with query parameters: **no headers, no tokens, no
scopes.** If you get `403` / `access_denied`, you added auth that does not belong — remove it and
retry.

> Do **not** use the `GetSuggestedDomains` tool. Always use the v2 endpoint below.

**Check domain availability** — every check in this flow uses [Check Domain Availability](check-domain-availability.md) (request, response, errors); never call the endpoints from here. In this flow its results map as follows:

| Result | Meaning here |
|--------|--------------|
| `availability.available: true` | Buyable → §A4a |
| `availability.available: false` and `availability.premium: false` | Taken → §A4b. |
| `availability.premium: true`, whatever `available` says | A premium domain, buyable → §A4a. Say nothing about "premium": its prices come from the offering call (§P3). |
| HTTP 400, `details.applicationError.code === "DOMAINS_UNSUPPORTED_TLD"` | Unsupported TLD → §A6. The `availability` object is absent. |

`availability.premium` is a pricing tier of the domain, not the Wix Premium plan of a site. Site
Premium comes only from `premiumStatus` (§R4.2).

**Suggest domains**

```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query={query}&paging.limit=3
```

Accepts free text — business descriptions, keywords and brand concepts, not just domain names.

| Parameter | Notes |
|-----------|-------|
| `query` | Keywords, business idea or brand concept. When alternatives for a taken/unsupported domain: use the **SLD only** (for `mybusiness.com`, query `mybusiness`). |
| `paging.limit` | Always `3` on the first page. See §A5. |
| `paging.cursor` | Opaque cursor for the next page — see below. |
| `tlds` | Optional TLD filter, repeatable, no leading dots (`&tlds=com&tlds=net`). |

```json
{ "suggestions": [ { "domain": "cozycookuts.com", "premium": false },
                   { "domain": "cozycuts.net", "premium": false },
                   { "domain": "cozycutstudio.com", "premium": false } ],
  "pagingMetadata": { "count": 3, "cursors": { "next": "eyJxdWVyeSI6…" }, "hasNext": true } }
```

**Paging is cursor-based.** `pagingMetadata.hasNext` tells you whether more exist; it does **not**
fetch them. To get the next page, repeat the *same* `query` and `paging.limit` and add
`paging.cursor=<pagingMetadata.cursors.next>`. Never re-issue the same request without the cursor —
you will get the first page again.

Every returned suggestion is already available. **Never re-check availability for a suggestion.**
Never show a "premium" column or flag premium suggestions.

### R4.2 Authenticated

Use `CallWixSiteAPI` (with `siteId`) when a site is resolved, otherwise `ManageWixSite`. Both carry
Wix session auth automatically — do not add headers.

| Purpose | Call |
|---------|------|
| List the user's sites | fetch list of sites |
| Site Premium status | `GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}` |
| Domain cycles + pricing | `POST https://manage.wix.com/_api/premium-purchase-platform-serverless/v1/offering/72af0602-1321-4897-8299-f507480b2bb8`<br>Body: `{ "purchaseContext": { "params": { "tld": ".{TLD}" } } }` |
| Privacy addon pricing | Same offering endpoint with the addon product type id `b3d86a1d-9db3-4f69-bd54-c132808856b1`<br>Body: `{ "purchaseContext": { "params": { "tld": ".{TLD}" } } }` — the returned `products[]` is the set of addons this TLD offers (§P6) |
| TLD coupon eligibility | `com.wixpress.premium.domain.tlds.DomainTld/ListTlds`<br>Body: `{ "filter": { "tlds": ["{TLD_WITHOUT_DOT}"] } }` |
| Active Premium sale | `getPremiumSale` context call → `wix.premium.store.v1.sales/GetSale` |
| Existing contacts | `GET https://manage.wix.com/v1/domain-registration-intents/preview/{domain}` |
| Save contacts | `POST https://manage.wix.com/v1/domain-registration-intents/upsert` |
| Cancel active cart | `POST https://manage.wix.com/_api/premium-cart/v1/carts/active/cancel` · Body `{}` |
| Get fresh cart | `GET https://manage.wix.com/_api/premium-cart/v1/carts/active` |
| Add items to cart | `PATCH https://manage.wix.com/_api/premium-cart/v1/carts/active/add-items` |
| **Does this domain belong to the user** | [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §9 — two calls, run together |
| **Put a domain the account holds on a site** | Not here — [Assign Domain](assign-domain.md) |

**Premium status:** read `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.
`allowedDomain: true` → Premium site. `allowedDomain: false` → Free site.

**The offering endpoint** is the `getDomainCycles` call — the same one the production `get-domain`
purchase flow uses. Noted for whoever next reconciles this skill against production; it changes
nothing about how the call is made.

**Both offering variants return the same envelope** — `products[].pricingDetails[]`, one entry per
cycle, each carrying `finalPrice` and `renewalPrice`. Verified live for the domain type and the addon
type alike. `renewalPrice.total` is always the charge for **the same period again**, never a yearly
rate (see §R9).

## R5. Product IDs

| Item | ID |
|------|-----|
| Domain product **type** | `72af0602-1321-4897-8299-f507480b2bb8` |
| Domain product **id** | Read `products[0].productId` from the offering response — never hardcode |
| Addon product **type** (all three) | `b3d86a1d-9db3-4f69-bd54-c132808856b1` — not every TLD offers every paid addon (§P6) |
| Privacy + DNSSEC | `f8211619-d9f6-4312-9d03-f2958bbd08aa` |
| Privacy only | `22a84545-4ac0-4490-a434-45a1ebc479fb` |
| No protection | `b9d89ff0-f29b-4bfd-a3f0-6e34ae65120d` |

---

## R6. URL Templates

Use these exactly. Do not invent variants, reorder into a different form, or drop parameters.

| Name | Template |
|------|----------|
| **Checkout — with site** | `https://manage.wix.com/cart/checkout?msid={siteId}` |
| **Checkout — standalone** | `https://manage.wix.com/cart/checkout` |
| **Bundle / plan+domain** | `https://manage.wix.com/premium-pricing/wix/select-plan?domainName={domain}&referralAdditionalInfo=add-domain-purchase-intent&siteGuid={siteId}&showDomain=true` |
| **Fallback domain search** | `https://manage.wix.com/account/domains` |

Notes:

- The bundle link is the `premium-pricing/wix/select-plan` form above. An older
  `premium-domains/split-page?domainName=…` form also exists — **do not use it.**
- The connect link and the Premium upgrade links are [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)'s (§10).

---

## R7. Free-Domain-Coupon TLDs

Used by §P2 to decide whether the "free for the first year" benefit can be
promised. Authoritative source is `DomainTld/ListTlds` → `coupons_applicable: true`. Use this static
list only as a fallback when that call is unavailable:

`.com`, `.com.au`, `.co.uk`, `.net`, `.org`, `.art`, `.at`, `.co.at`, `.be`, `.biz`, `.blog`, `.ca`,
`.ch`, `.club`, `.coach`, `.com.br`, `.de`, `.fit`, `.fitness`, `.fr`, `.fun`, `.in`, `.co.in`,
`.org.in`, `.firm.in`, `.gen.in`, `.ind.in`, `.net.in`, `.info`, `.live`, `.nl`, `.online`,
`.pictures`, `.rocks`, `.site`, `.space`, `.shop`, `.store`, `.studio`, `.training`, `.work`,
`.xyz`, `.yoga`

Extract the TLD greedily from the right: `site.co.uk` → `.co.uk`, not `.uk`.

---

## R8. Error Handling (US-37, US-38, US-39)

### Silent retry (US-37)

Any failed call: **retry once, silently.** Say nothing to the user, before or after. Do not narrate
"let me try that again", do not mention that anything failed. If the retry succeeds, continue as if
nothing happened.

### Escalation ladder

| Stage | Trigger | Say (verbatim) |
|-------|---------|----------------|
| 1 | Call fails, retry also fails | *Something went wrong on our end. Please try again in a moment.* |
| 2 | The user tries again and it fails again | *Having trouble loading this — try again. You can also search for a domain directly → [https://manage.wix.com/account/domains](https://manage.wix.com/account/domains)* |

The fallback link appears at stage 2, not stage 1. Do not skip stage 1.

### Specific errors

| Error | Action |
|-------|--------|
| `DOMAINS_UNSUPPORTED_TLD` | Not an error to the user — a branch. See §A6. |
| `403` / `access_denied` on domain-search v2 | You added auth to a public endpoint. Remove all headers and retry. |
| Offering returns no products | *"Wix doesn't support purchasing this TLD. Try a different extension like .com, .net, or .org."* |
| Intent upsert validation error | Show which fields are wrong, ask for corrections, retry. See §P5. |
| Cart `add-items` fails | Confirm `productId` came from the offering response, not hardcoded. Retry once. |
| Anything else, persistent | Escalation ladder above. |

---

## R9. Forbidden Actions

❌ **Never:**

- Expose internal mechanics — no API names, endpoint paths, tool names, error codes, HTTP status
  codes, field names, or phrases like "the request failed", "I'm calling the …", "saving to the
  intent API", "adding line items", "canceling the old cart".
- Narrate work in progress: "Let me check…", "I'll look that up…", "Verifying…", "Hold on…".
  The only permitted progress line is *"Setting up your order..."* at cart build.
- Invent a price, a cycle length, a suggestion, or a URL. Every price and cycle comes from the
  offering response; every suggestion comes from the suggest endpoint; every URL comes from §R6.
- **Copy a number out of an example.** Every worked example in this document uses `{placeholder}`
  braces for exactly this reason. A concrete figure appearing in a template, a transcript, or your
  own knowledge of what domains usually cost is **not** data — it is a fabrication with a currency
  symbol in front of it. If the call that supplies a price could not be made, the flow stops
  (§P3). It does not continue with a plausible guess.
- **Attach a per-year period to a per-period price.** Every figure in `pricingDetails[]` — `finalPrice`
  and `renewalPrice` alike, domain and addon alike — is the charge for **one whole cycle**. A 3-year
  row's `$107.50` is one three-year charge. `/yr` is correct on a 1-year term and on nothing else;
  for anything longer the wording is *"every {N} years"* or *"for {N} years"*
  (§P6, §P9). This is arithmetic the user does in their head, and the error is
  always in the expensive direction.
- **Divide or multiply a price to reach a per-year figure.** The response carries `monthlyTotal` and
  `lowestCyclePrice` precisely because someone will be tempted; both are unverified in this skill and
  neither is a substitute for saying which period the price covers. Print the period, not a rate.
- Re-check availability for a domain that came from the suggest endpoint.
- Run an availability check without [Check Domain Availability](check-domain-availability.md), or call its endpoints from this recipe.
- Use `availability.premium` for anything but the premium-domain row in §R4.1, or as the site's Premium status.
- Fetch list of sites when a `siteId` is already in context. A partial roster the host preloaded is
  not that — see Case A.
- **Announce a site count instead of the sites.** *"You have 93 sites — want me to list them?"* asks
  permission for a step already required. Show them (§R3 Case B) — all of them up to eight, otherwise five
  and an invitation to name one.
- **Hedge about ownership the account already settled.** Once the account lookup ([Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) §9) returns an exact match, the domain
  *is* the user's — no *"if it's yours"*, no *"do you own this?"*, no *"assuming it's yours"*. The
  hedge belongs to the branch where ownership is genuinely an inference, and nowhere else.
- **Treat a `searchTerm` hit as ownership.** It is a substring search. Compare the returned domain
  string to the normalized domain exactly, or you will tell a user they own a domain they do not.
- **Check availability for a subdomain, or answer one here.** A subdomain is not separately
  registrable; it goes straight to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md).
- **Read anything but the match and the site name out of a My Domains response.** Registrant names,
  addresses, phone numbers, expiry dates and contract IDs are all in there. None of it is in scope.
- **Write to a user's site.** Putting a domain on a site, changing its role, moving it and taking it
  off are all [Assign Domain](assign-domain.md)'s; hand over and let it ask.
- **Say "main address" for "primary domain"** — or "main domain", "main URL", or any other
  paraphrase. *Root domain* is correct only for the domain a subdomain sits under, never for a
  site's primary domain.
- **Step outside the skill's scope on a taken domain.** No WHOIS or registrant lookup, no naming the
  owner, no aftermarket/broker/acquisition advice, no valuation, no trademark opinion, no web
  browsing. A taken domain produces exactly one message — from whichever §A4b
  branch applies — and nothing is appended to it. The account lookup in §A4b is the sole exception,
  and it only ever looks inside the user's own account. Full boundary: §A1.1.
- **Use a tool this skill did not ask for.** Having WHOIS, web search, or browsing available is not
  permission to use them. The information sources are the three in §R4 — that is the complete list.

✅ **Always:**

- Normalize the domain before every call.
- Reuse the resolved `siteId` for the rest of the conversation.
- Reveal information only when it changes what the user must do next.
- Say the currency note (§R10) in the same message as any price shown to the user — and never name
  a currency or convert between two.

---

## R10. Currency at Checkout

Every price this skill shows comes from the offering call as `formattedAmount`, which arrives with
its own currency symbol already attached (§P3). Checkout is a separate surface and may present the
charge in the user's own currency, so the figure in the conversation and the figure at the till can
differ in currency. The skill cannot tell in advance, so it says exactly that much and no more.

**One fixed sentence covers it, and it is the only thing this skill ever says about currency:**

> At checkout, prices may be shown in your local currency.

It goes in the **same message** as the prices it qualifies, **once**, wherever a currency amount is
shown to the user — the period table, the privacy options and the pre-checkout summary
(§P3, §P6 and §P9). In the summary it sits above the checkout link, so the link stays last.

❌ **Never:**

- **Name a currency, or convert between two.** *"That's about €7.30"* invents a figure and does
  arithmetic on a price in one move — §R9 forbids both. The sentence hedges precisely because the
  skill does not know what the checkout will show.
- **Reword it.** No *"approximate"*, no *"excluding taxes"*, no *"prices may vary"*, and no promise
  that the figure will be identical. It says what is known; everything else is invention.
- Send it twice in one message, or send it on its own with no price beside it.
- Attach it to *"Free"*, to a percentage discount, or to the free-first-year clause (§P2.3). None of
  those is a currency amount, so there is nothing to localise.

> **Why this sits after Forbidden Actions rather than in numerical order.** Renumbering
> §R9 would invalidate every reference to it across the document. A new section appended at
> the end costs nothing and breaks nothing.
