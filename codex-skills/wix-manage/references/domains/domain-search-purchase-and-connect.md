---
name: "Domain Search, Purchase and Connect"
description: Buy a domain through Wix or connect one the user already owns — intent, availability,
  suggestions, site resolution, registration, privacy, cart and checkout, plus the connect path
  including ownership lookup and binding a domain to a site.
---

# Domain Search, Purchase and Connect

One document, four parts. Section numbers carry their part's letter, so every reference names the
part it points into — §A4b, §P3, §C0c, §R4.3.

| Part | Sections | Covers |
|------|----------|--------|
| **Part A** — Entry and Routing | §A1 – §A8 | Intent, availability, suggestions, and the routing decision. **Start here.** |
| **Part P** — Purchase Path | §P1 – §P10 | Buying a domain from Wix |
| **Part C** — Connect Path | §C0 – §C7 | Connecting a domain the user already owns |
| **Part R** — Reference | §R1 – §R9 | Endpoints, product IDs, URL templates, site resolution, ownership lookup, error handling |

**Before any API call, read Part R.** It holds every endpoint, product ID, URL template,
site-resolution rule and error rule used by all three of the other parts. Do not guess a URL or a
field name — look it up there.

---

# Part A — Entry and Routing

Part A takes the conversation from the user's first message to the point where two things are known:
**which domain**, and **buy or connect**. Then it goes to one of two places:

| Then go to | For |
|------------|-----|
| **§P1** | The user is buying a domain from Wix |
| **§C1** | The user already owns the domain and wants it on their Wix site |

Covers **US-01 – US-12**. §A4b routes **US-40 / US-41**, and decides whether the connect path may
perform the connection itself (**US-42 – US-45**) or only hand over a link. §A3.1 handles subdomains
(**US-48 – US-50**), which skip the availability check entirely.

---

## A1. When To Use This Skill

The user wants to:

- Buy / purchase / register / get a domain
- Search for an available domain, or check if one is available
- Brainstorm a domain name from a business idea
- Connect / assign / add a domain to their Wix site
- Connect / assign / add a sub domain to their Wix site
- Get a custom domain for their Wix site

Typical openers: *"buy me a domain"*, *"I want to purchase a domain"*, *"get me mybusiness.com"*, 
*"I need to connect coolbrand.com to my site"*, *"I need to connect a domain mybakery.net to my Wix site"*,
*"I have coolbrand.com and want to connect it"*, *"I need a domain for my pancakes restaurant"*."

**If the user mentions anything domain-related, this is the right flow.** Asking a clarifying
question is expected behaviour, not a dead end — stay here and ask. Only leave for requests that are
completely unrelated to domains ("change my site colors", "how do I add a blog").

**UX rule for everything below:** keep it natural, never expose internal mechanics, and reveal
information only when it changes what the user has to do next. See §R9.

---

## A1.1 ⛔ Out of Scope — Hard Boundary

This skill sells Wix domains and connects domains to Wix sites. **That is the whole job.** It has
exactly three information sources: `check-domain-availability`, `suggest-domains`, and the
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
response beyond the match and the site name is off limits (§R4.3).

---

## A2. Intent Classification (US-01, US-02)

Two things to establish: the **domain** and the **intent**.

| Signal | Intent | Next |
|--------|--------|------|
| "buy", "purchase", "get", "register", "new domain" | **PURCHASE** | §A3 |
| Wanting **a** domain — indefinite article, no domain named: *"I want a domain for my site"*, *"I need a domain for my pancakes restaurant"* | **PURCHASE** | §A3 |
| "connect it **to my site**", "assign it to my site", "bind it to my site", "point it at my site", "put it on my site" | **CONNECT → a site** | §A3 |
| "connect it **to Wix**", "add it to Wix", "bring it into Wix", "I have", "I own", "transfer it over" | **CONNECT → Wix** | §A3 |
| A specific domain, no buy/connect word | **UNKNOWN** | §A3 — the availability check in §A4 settles it |
| Neither, and no domain | **UNKNOWN** | Ask: *"Would you like to purchase a new domain or connect one you already own?"* |

### The two senses of "connect" (US-51)

Both are CONNECT, and they name **different targets**. Read which one the user said — it is the
difference between two different operations:

| The user says | They mean | The operation |
|---------------|-----------|---------------|
| *to a site* — and **assign** and **bind** are the same request in other words | The domain is already in the Wix account; which site should it serve? | The bind — §R4.4 |
| *to Wix*, *add to Wix* | The domain lives at an outside registrar and is not in the account at all | The connect link — bringing it in, §C3 |

Nothing can be assigned to a site until the domain is in the account, so the second is the
precondition of the first, not an alternative to it.

**The account decides which one is actually possible, and it overrides the phrasing.** §A4b looks the
domain up before any message goes out, so let the lookup settle it:

- **Not in the account (§A4b-C)** — *to a site* cannot run, however plainly it was asked for; the bind
  gate wants the domain in the account first. The connect link is the answer to **both** phrasings.
- **In the account, unassigned (§A4b-B)** — *to Wix* is already true. Read it as *to a site* and offer
  the bind.
- **In the account, on a site (§A4b-A)** — both phrasings are already satisfied; §C0
  decides whether anything is left to do.

⛔ **Never correct the user's wording.** They are describing an outcome, not calling an API. Act on
what the account says is possible and say what you did — do not explain that they used the wrong verb.

The article does most of the work: **a** domain is one the user does not have yet (purchase);
**my** domain, or a named domain plus "I have" / "I own", is one they already hold (connect).
Do not fall through to the clarifying question just because the words "buy" or "purchase" are
absent — *"I want a domain for my site"* is a purchase.

An answer of "connect" / "I have one" with no domain named → ask *"What domain would you like to
connect?"*, then go to §A4.

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
| User named a specific domain — **even if they named a site too** | Normalize it (§R1). A **subdomain** → §A3.1. Anything else → §A4, **first**, before any site work |
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

### A3.1 The Domain Is a Subdomain (US-48, US-49, US-50)

§R1.1 identified the host as a subdomain — `shop.maximz.fr` under `maximz.fr`.

**Do not call the availability endpoint.** A subdomain is not separately registrable, so there is no
availability answer to be had and §A4 has nothing to do here. Ownership is the only open question, and
it is usually already settled by the account.

#### A3.1a — the two lookups (silent)

Run the §R4.3 pair keyed on the **subdomain**. Only if neither array holds an
exact match, run the same pair again keyed on the **root domain**.

| Exact match at | State | Next |
|----------------|-------|------|
| Subdomain in `sites[].primary` or `sites[].redirects[]` | Already connected | **§A4b-A**, unchanged |
| Subdomain in `domains[]` (unassigned) | **Confirmed** | **Go to §C1 and follow it** |
| Root domain in either array | **Confirmed via root** | §A3.1b |
| Neither | Root is not in the account | §A3.1c |
| User is logged out, or both calls fail after the silent retry | Unknown | **§A4b-C**, unchanged |

A root match confirms the subdomain. The account that holds `maximz.fr` is the account that decides
what sits beneath it — there is nothing left to ask, and nothing to hedge about.

#### A3.1b — the root is in the account (US-48)

Ownership is **confirmed**, so the *"If it's yours"* hedge does not appear. Say why it is confirmed,
because the user asked about the subdomain and the account matched something else:

> **Go to §C1 and follow it** — ownership **confirmed via root**. The opening in
> §C3 names the root; the link is the whole answer, and **no bind** is offered.

`q=` on that link carries the **subdomain**. The root is what proved ownership; the subdomain is what
gets connected. The two are never swapped.

**Carry the root's site if the account named one, as a candidate and not a decision.** A root match
under `assigned` names the site the *root* is on — which site should serve the **subdomain** is a
separate question and this lookup did not answer it. §C1, Case R asks it. Do not resolve it here,
and never let it reach a link unconfirmed.

#### A3.1c — the root is not in the account (US-49)

Say, verbatim:

> {subdomain displayName} sits under {root displayName}, and I don't see {root displayName} in your
> Wix account. Would you like to connect {root displayName} first?

- **Yes** → treat the **root domain** as the domain in hand and go to §A4, from the availability check
  onward. The subdomain comes after, once the root is in the account.
- **No**, or any question about why → §A3.1d.

#### A3.1d — they ask why, or decline (US-50)

Both reactions get the same answer, once:

> Authorization for a subdomain follows its root domain, so having {root displayName} in your account
> is what lets you control which subdomains are allowed to point at your sites. Connecting it is a
> formality — you don't have to change any DNS, and nothing about how {root displayName} works today
> has to change.

Then leave the offer open and say nothing more about it.

- **They change their mind** → §A3.1c's yes branch.
- **They still decline** → **go to §C1 and follow it** — ownership **asserted**. Link
  only, **no bind**. Ownership was never established here, so this is the one subdomain branch where
  the *"If it's yours"* hedge is correct and stays.

⛔ **State the recommendation once.** A user who has declined twice has decided. The subdomain link is
a working answer without the root, and repeating the case for it turns a recommendation into a
pitch — §R9.

### A3.2 The User Pointed at a Site but Named No Domain

**This section is only for a message that named no domain.** If a domain was named as well —
*"buy mybakery.com for my wix site"* — row 1 owns it: §A4 runs first, and the site is resolved
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

## A4. Availability Check (US-07, US-08, US-09)

Check the normalized domain **silently** — no "let me check", no "one moment". Endpoint and response
shape: §R4.1.

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

Call **both** ownership endpoints together, per §R4.3:

```
GET .../my-domains/v1/domains/assigned?filter.searchTerm={domain}
GET .../my-domains/v1/domains/unassigned?filter.searchTerm={domain}
```

Compare the returned domain strings to `{domain}` **exactly** — `searchTerm` is a substring search
and a partial hit is not ownership.

- **User is not logged in**, or both calls fail after the silent retry → skip to **§A4b-C**.
  Ownership is unknown, which is what §A4b-C's copy already assumes.

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

If the user wanted it in the **other role** on that same site — forwarding today, but they asked for
the site's address — this is not terminal after all. Ownership is confirmed and the domain is already
on the right site, so the role can be changed: **go to §C0b and follow it** (US-45).

If the user asked to connect it to a **different** site than the one it is on, that is a **move**, and
a bind performs it — binding the domain to the new site takes it off the old one. **Do not compose the
answer here, and do not ask *"Want to move it to {requested site}?"* on its own.** That question hides
the half of the change the user is not thinking about: the site the domain comes off, which may be
losing its primary domain.

**Go to §C0c and follow it**, carrying the requested site and ownership **confirmed**.
That section resolves the site, checks its plan, and asks for the move in a form that names both sites
(§C3.2d) before anything is written.

#### A4b-B — it is theirs, and not connected to anything (US-41)

Ownership is settled, so there is no question to ask and nothing to hedge.
**Go to §C1 and follow it**, carrying the domain and ownership **confirmed**.

**This branch is the one that unlocks doing the work.** A confirmed match is the first of the four
conditions in §R4.4, so the connect path can offer to make the connection itself
rather than only pointing at the dashboard. Carrying ownership as *confirmed* is what makes that
possible; carrying it as *asserted* silently downgrades the user's outcome to a link.

That path resolves the site, checks the plan, and looks at what the site already has —
§C1, §C2 and §C3.1 — and, on a **Premium** site, lands on an offer plus the link in
one message:

> {siteName}'s primary domain is **{current primary}**. Should {displayName} become the primary
> domain instead, or redirect to it?
>
> Or do it yourself — [Connect it to {siteName}]({connect URL})

On a **Free** site nothing is offered and nothing is written — it is the link plus the upgrade block,
exactly as before.

§C0 – §C4 own all of this wording, including which of the three offer forms applies
and the two confirmations in front of the write. **Do not compose any of it here**, and do not promise
in Part A that the domain will be connected — that promise is only safe after §C2 has said Premium.

No suggestions, no *"do you own this?"*, no *"if it's yours"*.

#### A4b-C — not in their Wix account (US-09)

It **cannot be purchased here** — Wix registers available domains, it does not resell taken ones.
This branch is short and closed.

⚠️ This branch is **not** "someone else owns it". A domain held at an outside registrar and never
connected to a Wix site is invisible to the lookup, so the user may well own it. Never say or imply
otherwise — see §R4.3.

Do exactly two things: call `suggest-domains` with the SLD only for 3 alternatives (§A5), then send
**one** message containing **only** this:

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
proved the domain is the user's; here nothing proved it. Writing an unverified domain onto a live site
fails the first condition of §R4.4, so the connect link is the whole of what this
branch can offer — no primary-or-redirect question, no bind, however plainly the user says it is
theirs. If they are right and the domain is theirs at an outside registrar, the dashboard is where
that gets sorted out.

**This holds even when the user asked to connect it "to my site" — or to *assign* or *bind* it
there** (§A2). That request names the bind, and the bind cannot run on a domain the account does not
hold; bringing it into Wix comes first and the link is what does that. Give the link, and do not
promise the site assignment as though it were about to happen. Do not lecture them about the order
either: the link goes to the page where both steps are completed, so *"you can connect it to a Wix
site"* is a true and sufficient answer.

The one thing that can change this: the user was **logged out**, logs in, and the ownership check runs
for the first time (§C1, Case C). A match found then is a real §A4b-A or §A4b-B, and
the offer comes with it.

The three alternatives are whatever `suggest-domains` returned, in the order it returned them. For
`etzlenu.com` that is `theetzlenu.com`, `etzlenu.net`, `etzlenuco.com` — **not** a `.io`/`.dev`/`.app`
list you assembled. Those may well be available; they are still fabricated output, because no call
produced them.

Then branch on the reply:

- Picks an alternative → that is the chosen domain, **skip re-checking availability** (US-06) →
  **go to §P1 and follow it.**
- Says it is theirs / wants to connect → **go to §C1 and follow it**, carrying the
  domain, the fact that it is already known to be taken, and ownership **asserted by the user**
  (not confirmed — the account search did not find it).
- Wants something else → back to §A3.

**When the intent was already CONNECT**, do not offer alternatives — a domain they cannot register is
no use to them. Go straight to **§C1** with ownership **asserted**. If the user is
logged out, §C1 Case C asks them to log in; once they do, the ownership check in
Step 1 can run and may upgrade the answer to §A4b-A or §A4b-B.

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
| Domain is the user's and already on a site (§A4b-A) | **Nowhere — terminal.** One message, then stop. Unless the role is wrong (**§C0b**) or the site is wrong (**§C0c** — a move, which a bind performs). |
| Domain is the user's and unconnected (§A4b-B) | **Go to §C1 and follow it** — ownership **confirmed**. A bind may be offered. |
| Domain taken and the user says it is theirs (§A4b-C) | **Go to §C1 and follow it** — ownership **asserted**. Link only, **no bind**. |
| Connect intent, domain confirmed taken | **Go to §C1 and follow it.** |
| Subdomain, root domain in the account (§A3.1b) | **Go to §C1 and follow it** — ownership **confirmed via root**. Link only, **no bind**. |
| Subdomain, root not in the account, user accepts the root offer (§A3.1c) | **§A4 with the root domain** as the domain in hand. |
| Subdomain, root not in the account, user declines twice (§A3.1d) | **Go to §C1 and follow it** — ownership **asserted**. Link only, **no bind**. |
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

Present all three options, Privacy + DNSSEC marked recommended. Prices come from the offering call
with the addon product type (§R4.2); match each returned product by its ID.
**If a price is not available, omit it — never invent one.**

The addon response has the **same shape as §P3's** — one `pricingDetails[]` entry per cycle, with
`finalPrice` and `renewalPrice` on each. The registration period is already chosen by the time you
get here, so **read the row whose `cycle.cycleDuration.count` matches the chosen term** and take
`finalPrice.total.formattedAmount` from it. Never sum, never divide, never take the 1-year row and
multiply.

> How would you like to protect your registration?
>
> - **Privacy + DNSSEC** *(recommended)* — Keeps your personal info off public records while also protecting your domain from being hijacked or redirected by attackers — {price}
> - **Privacy only** — Hides your personal contact info from public records — {price}
> - **No protection** — Your contact info will be publicly visible — Free
>
> At checkout, prices may be shown in your local currency.

The currency note is required here too (§R10). It qualifies the two `{price}` figures and not
*"Free"* — free is not a currency amount. So if **neither** priced option came back with a figure,
this message shows no price at all and the note does not appear.

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
only one whose price is known ahead of time — it is Free.** For the other two: if you did not get a
price back, drop the ` — {price}` suffix and present the option without one. The same rule as §P3
applies — a figure you did not receive in this conversation is a fabrication, and the wording above
is a template, not a price list.

| Choice | Addon product ID |
|--------|------------------|
| Privacy + DNSSEC | `f8211619-d9f6-4312-9d03-f2958bbd08aa` |
| Privacy only | `22a84545-4ac0-4490-a434-45a1ebc479fb` |
| No protection | `b9d89ff0-f29b-4bfd-a3f0-6e34ae65120d` |

Addon product type for all three: `b3d86a1d-9db3-4f69-bd54-c132808856b1`.

The user may pick any of the three (US-26) — recommend, never push. "No protection" is a legitimate
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
- Include the addon line item for all three privacy choices, including "No protection" — it is a
  product, not an absence.
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
`$0.00` does not renew at anything worth saying.

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

# Part C — Connect Path

**Entry preconditions** — you arrive here from Part A with:

1. A single **normalized domain**, and
2. Confirmation it is **registered** (`availability.available: false`) — **or** that it is a
   **subdomain**, which is not separately registrable and so has no availability answer at all
   (§R1.1, §A3.1), and
3. An **ownership state**, which is one of:

| Ownership state | Set by | Consequence here |
|-----------------|--------|------------------|
| **Confirmed** | The account lookup found it — §A4b-B | The domain *is* theirs. Use the unconditional copy, and the connection can be **performed** (§C3). |
| **Confirmed via root** | The subdomain's *root domain* is in the account — §A3.1b | The subdomain *is* theirs. Use the unconditional copy naming the root, but **never bind** — §R4.4's first condition asks for a match on the domain being connected (§C3). |
| **Asserted** | The user said so, or the intent was CONNECT — §A4b-C | Ownership is an inference. Keep the *"If it's yours"* hedge, and **never bind** (§C3). |

If you arrive without one, ownership is **asserted** — the cautious reading. Never upgrade an
asserted state to confirmed on the strength of the user repeating themselves; only the lookup in
§R4.3 confirms.

**Order matters:** availability is checked *before* any site work — that already happened in
§A4. Do not resolve a site first and then check the domain. If you got here
without a confirmed-taken domain, go back to §A4.

If the domain turns out to be **available**, the user does not own it — that is
§A4a, not this part.

**A subdomain is the one exception to both paragraphs.** No availability call was made and none
should be; §A3.1 resolved ownership from the account instead. Do not send a
subdomain back to §A4 for a check that has no answer.

**Terminal states** — this path ends in exactly one of:

| Terminal state | Reached when |
|----------------|--------------|
| **Already connected** | The domain is already on the requested site in the role wanted (§C0a) |
| **Connected — you did it** | A bind succeeded (§C3.4) |
| **Connect link** | A site is resolved, it is Premium, and no bind is on offer or the offer was declined (§C3) |
| **Connect link + upgrade block** | A site is resolved and it is Free (§C4) |
| **Sign-up** | The user has no Wix site and wants to create one (§C5) |
| **Error fallback** | Two failed attempts — §R8 |

**Read Part R before any call.** The bind in particular is governed by §R4.4, including the
four-part gate that decides whether one may be attempted at all.

⚠️ **The bind in §C3.4 is this skill's only write to a user's live site**, and because it re-assigns, a
single POST can change **two** live sites (§C0c). One explicit yes sits in front of every POST, a
second and named yes in front of anything that displaces a live primary domain, and every offer to
move a domain names the site it comes off. There is no path through this part that connects or moves a
domain without the user saying so.

Covers **US-17, US-33 – US-36, US-40 – US-46**.

---

## C0. Already Connected — Stop Before You Start

If the ownership lookup (§R4.3) matched under `assigned` — at
`sites[].primary.domainName` or `sites[].redirects[].domainName` — the domain is already on one of
the user's sites. Read `siteName` and `siteId` from the entry that matched, and note **how** it
matched: as the site's `primary`, or as one of its `redirects[]`.

Three cases, and they end differently.

### C0a — On the site the user asked about, in the role they want (US-40)

The job is already done. Do not resolve a site, do not check a plan, do not send a connect link, do
not bind. Say it and stop:

> {displayName} is already connected to **{siteName}**.

If the match was a redirect and a redirect is what they asked for:

> {displayName} is yours — it's currently forwarding to **{siteName}**.

**Terminal state. Stop here.**

### C0b — On that site, but in the other role (US-45)

The domain is theirs and it is already on the right site — only its role is wrong. Nothing has to
come off anything, so this one **can** be acted on. The `assigned` match makes ownership
**confirmed**.

Currently a redirect, and the user wants it to be the site's address:

> {displayName} is already on **{siteName}** — right now it forwards there rather than being the
> site's primary domain. Want to make it the primary domain instead?

A yes here is **not** authorization for the POST. Continue to §C2 (the plan check) and §C3.1 (what is
on the site), then §C3.3's named confirmation, then §C3.4.

The mirror case — currently the primary, and the user wants it demoted to a redirect — runs the same
route with `bindType: REDIRECT`. One thing to check first: a redirect needs somewhere to point. If
§C3.1 shows this domain is the site's only domain, there is nothing to redirect to. Say so and stop:

> {displayName} is **{siteName}**'s only domain, so there's nothing for it to redirect to.

### C0c — On a *different* site — a move (US-46)

The domain is theirs, and it is in use somewhere else. **A bind re-assigns it** — binding it to the
requested site moves it off the site it is on now. No unbind call is needed and none exists; the move
*is* the bind.

So this is not a hand-off branch. It is the branch that **changes two live sites with one POST**, and
it is gated harder than anything else in this part: the domain stops doing whatever it was doing on
the site it leaves, and that site may be losing its primary domain.

Ownership is **confirmed** — the `assigned` match proves it. Note two things from the matching entry
before going on:

| Note | From |
|------|------|
| `{current siteName}` — the site it is on now | `sites[].site.siteName` on the matching entry |
| `{role phrase}` — **the primary domain for**, when it matched `primary`; **forwarding to**, when it matched `redirects[]` | which field matched |

#### The requested site is known

The user named a site, or one is in context. Continue: §C1 to resolve it, §C2 for its plan, §C3.1 for
what is on it, then §C3.2d — the move's own offer form — and §C3.3 when the move also displaces a
primary domain on the target. **§C3.2d and §C3.3 are both mandatory for a move.** A move never reaches
§C3.4 on fewer than one explicit yes, and never on a yes to a question that did not name
`{current siteName}`.

If §C2 says the requested site is **Free**, there is no move: §C4, link plus upgrade block, no offer,
no POST.

#### The requested site is *not* known

The user said *"my site"* and has more than one. They may well have meant the site the domain is
already on — in which case the answer is §C0a and nothing needs doing at all. So report the current
state and ask the question that actually branches:

> {displayName} is currently {role phrase} **{current siteName}**. Did you want it on a different site?

- **Names a different site** → resolve it (§C1) and continue as above.
- **No, that's the one** → §C0a's copy. **Terminal.**

⚠️ **Never say what happens to `{current siteName}` after the move.** Whether it falls back to a
`wix.com` address, whether another of its domains is promoted, whether anything about it breaks —
none of that comes from any call this skill makes. Name what the domain stops doing; stop there.

Everything below assumes §C0a did **not** fire. §A4b-A normally catches this
before you get here; §C0 exists so an arrival that skipped it still lands correctly.

---

## C1. Resolve the Site

Connecting a domain **requires** a Wix site. Apply §R3:

| Case | Action |
|------|--------|
| A | `siteId` already in context, or the user named a site → use it. **Do not fetch list of sites.** |
| B | Logged in, no `siteId` → fetch list of sites. One site → use it silently. 2 – 8 → list them all, numbered, in the message that asks. More than 8 → name the total, show five, invite a name (§R3 Case B). **Never a bare count.** |
| B, no sites | → §C5 |
| C | Not logged in → *"To connect a domain you'll need a Wix site — [Log in or create a Wix account]"*. End the turn until they log in, then go to Case B. |
| R | Ownership is **confirmed via root** and the root's `assigned` match named a site → that site is a **candidate, not a resolution**. Offer it and wait — below. |

Do all of this silently, **Case R excepted**. The user should see one message at the end of this path,
not a play-by-play.

**After a Case C login, run the ownership check** (§R4.3) before continuing — it
could not run while they were logged out. A match changes the answer: `assigned` sends you to §C0,
`unassigned` upgrades ownership to **confirmed**, which is what opens the door to §C3.1 – §C3.4.

### Case R — the candidate site came from the root domain (US-48)

A subdomain arrives here with ownership **confirmed via root**. If that root match came back under
`assigned`, the response named the site the **root** is on (§R4.3) — the only site the account can
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
| yes / "same site" | That is the resolved site. Continue to §C2. |
| names a different site | Resolve that name as Case A or Case B, then continue. |
| no, or is unsure which | Case B: fetch list of sites and ask which one. |

⛔ **Do not send the connect link with the question.** Every connect URL carries a `siteId` (§R6), so
a link in that message answers the question on the user's behalf and then asks it — the failure this
case exists to prevent. The link goes out with §C3's opening, once a site is chosen.

**If the root matched `unassigned` instead, no site was named** — there is nothing to offer and no
question to ask. Go to Case A or Case B as usual.

---

## C2. Check the Site's Plan

```
GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}
```

Read `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.

- `allowedDomain: true` → §C3
- `allowedDomain: false` → §C4

Run this **together with §C3.1's inventory call** — two calls, one silent step, no user-visible gap
between them. If the site turns out to be Free, discard the inventory and go to §C4; the wasted read
costs nothing and saves a round trip in the common case.

⚠️ The `premium` field on the availability response is **domain pricing**, not site Premium status.
It has nothing to do with this decision. Ignore it. Neither does `allowedDomain` on the site object
inside a My Domains response — `premiumStatus` is the only source.

---

## C3. Premium Site — Connect It, or Hand Over the Link (US-33, US-42)

The site is Premium, so a domain can go on it. Two routes exist, and **they are not alternatives you
pick between — the offer to do it and the dashboard link go out together, in the same message.**

The two routes answer the two things *connect* can mean (§A2). The **link**
brings a domain into the Wix account — *connect it to Wix*, *add it to Wix* — and is the only route
available for a domain the account does not already hold. The **bind** assigns a domain the account
already holds to a particular site — *connect it to my site*, *assign it*, *bind it*. Sending both at
once is what makes the message answer either request without asking the user which they meant.

Which routes are available is decided by the ownership state, not by taste:

| State you arrived with | What this section does |
|------------------------|------------------------|
| **Confirmed** — an `unassigned` exact match, or an `assigned` match (§C0b same site, §C0c another site) | Offer to connect it **and** give the link. §C3.1 → §C3.4. |
| **Confirmed via root** — a subdomain whose root domain is in the account | The link is the whole answer, with the unconditional opening. No bind, no primary/redirect question. |
| **Asserted** — the user said so, the lookup found nothing, or it could not run | The link is the whole answer. No bind, no primary/redirect question. |

### The two openings — link only

When no bind is on offer, this section is one message and the ownership state picks the opening:

**Ownership confirmed:**

> {displayName} is yours and isn't connected to a site yet — [Connect it to {site name}](https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true)

**Ownership confirmed via root** (a subdomain — §A3.1b, US-48):

> {displayName} sits under {root displayName}, which is in your Wix account — [Connect it to {site name}](https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true)

**Ownership asserted:**

> {displayName} is registered. If it's yours — [Connect it to {site name}](https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true)

The link is identical in all three. Only the sentence in front of it changes, and it changes because
one of them is a fact, one is a fact about a different domain that settles this one, and the last is
a guess. Do not blend them — *"is yours. If it's yours…"* is the failure this split exists to
prevent.

On the root variant, `q=` carries the **subdomain**, never the root — the root is what proved
ownership, the subdomain is what gets connected. Both names in the sentence go through
§R2 for their display form.

The link is the same one every offer below carries:

- `q=` takes the **full** domain, never the truncated display form.
- The visible label is `Connect it to {site name}`; `{displayName}` is the domain's display form
  (§R2). **Every domain shown to the user goes through §R2** — including the
  site's current primary domain.
- No `referralInfo` parameter — see §R6.

Add nothing after the link. **Terminal state. Stop here.**

Ownership **confirmed** → do not stop. Continue to §C3.1.

Ownership **confirmed via root** → stop here, exactly like *asserted*. The wording is unconditional
but the bind gate is not met, so §C3.1 – §C3.4 do not run.

### C3.1 What is already on this site? (silent)

Before offering anything, find out what the site already has. One call, run with §C2:

```
GET https://manage.wix.com/_api/my-domains/v1/domains/assigned?filter.msid={siteId}
```

Read exactly three things (§R4.4): `sites[0].primary.domainName`,
`sites[0].redirects[].domainName`, `sites[0].site.siteName`. Nothing else in that response is in
scope.

| What came back | Branch |
|----------------|--------|
| The target domain is this site's `primary`, or in its `redirects[]` | It is already on this site → **§C0a** (same role) or **§C0b** (other role). Do not offer a fresh connect. |
| `sites[]` is empty — the site has no domains at all | **§C3.2a** |
| `primary.domainName` is absent (redirects only, no primary) | **§C3.2a** — there is no primary domain to redirect to, so the two-way question is unanswerable. |
| `primary.domainName` is present | **§C3.2b** |
| The call fails, and its silent retry also fails | **No bind.** Fall back to §C3's link-only *confirmed* opening. The inventory is what makes the question askable; without it, do not guess a primary domain. |

The target domain turning up here means the `searchTerm` lookup (§R4.3) missed
it — most often because
the user was logged out at the time. Trust this call and route to §C0.

On a **move** (§C0c) the branch conditions are unchanged — what changes is the copy: §C3.2d replaces
§C3.2a and §C3.2b, and which of its two forms applies still turns on whether the target site has a
primary domain.

### C3.2 The offer — one message, both routes

Four copy forms. Pick by what §C3.1 found, by whether the domain is coming off another site (§C0c), and
by whether the user has already said which role they want.

**A move (§C0c) always uses §C3.2d**, whatever else applies — it is the only form that names the site
the domain is leaving, and a move may not be offered without naming it.

#### C3.2a — the site has no primary domain yet

Nothing to redirect to, so there is no choice to present. It is still a write, so it still needs one
yes:

> {siteName} doesn't have a primary domain yet. Want me to make {displayName} its primary domain?
>
> Or do it yourself — [Connect it to {siteName}]({connect URL})

#### C3.2b — the site already has a primary domain

> {siteName}'s primary domain is **{current primary}**. Should {displayName} become the primary
> domain instead, or redirect to it?
>
> Or do it yourself — [Connect it to {siteName}]({connect URL})

#### C3.2c — the user already said which role they want

*"connect it as a redirect"*, *"make it the main one"* — the two-way question is already answered.
Do not ask it again. Ask the one-way confirm instead:

> {siteName}'s primary domain is **{current primary}**. Want {displayName} to redirect to it?
>
> Or do it yourself — [Connect it to {siteName}]({connect URL})

When the pre-stated role is PRIMARY and the site has one, **§C3.3 is that confirm** — go straight
there and skip this form. When it is PRIMARY and the site has none, use §C3.2a.

#### C3.2d — the domain is coming off another site (§C0c, US-46)

The bind re-assigns, so the offer has to say what the domain stops doing. `{role phrase}` and
`{current siteName}` come from §C0c.

The requested site **has** a primary domain:

> {displayName} is currently {role phrase} **{current siteName}**. Moving it to {siteName} takes it
> off {current siteName} — should it become {siteName}'s primary domain, or redirect to
> **{current primary}**?
>
> Or do it yourself — [Connect it to {siteName}]({connect URL})

The requested site has **no** primary domain:

> {displayName} is currently {role phrase} **{current siteName}**. Want me to move it to {siteName}
> and make it the primary domain there? That takes it off {current siteName}.
>
> Or do it yourself — [Connect it to {siteName}]({connect URL})

Both forms name the site being left, in the same message as the offer, before any yes is possible.
That is the point of this form and it is not optional. A pre-stated role (§C3.2c) does **not** let you
skip it — collapse the two-way question if the role is already settled, but keep the sentence that
names `{current siteName}`.

#### Reading the answer

| The user says | Do |
|---------------|-----|
| primary / "make it the main one" / "instead" | `bindType: PRIMARY` → §C3.3 if the site has a primary, else §C3.4 |
| redirect / forward / point it at the other one | `bindType: REDIRECT` → §C3.4 |
| yes (to §C3.2a, §C3.2c or §C3.2d) | The role that question named → §C3.3 if it displaces a primary, else §C3.4 |
| no / "I'll do it myself" / changes the subject | **No POST.** The link is already in front of them. Stop. |
| anything ambiguous | Ask the same question once more. **Never guess a bind type** — one of the two options overwrites the site's live address. |

Silence is not a yes. An unanswered offer is a terminal state, not a pending instruction.

### C3.3 Replacing a live primary domain (US-44)

Fires when `bindType` is `PRIMARY` **and** §C3.1 found a `primary.domainName` on the target site. It is
not optional and it cannot be folded into §C3.2 — the point of it is that the domain being replaced is
**named** before anything moves:

> {siteName}'s primary domain is **{current primary}** right now. Making {displayName} the primary
> domain will send visitors to {displayName} instead. Go ahead?

On a **move** (§C0c), the domain being replaced is not the only casualty — say both sides in one
question, and do not split it into two:

> {siteName}'s primary domain is **{current primary}** right now. Making {displayName} the primary
> domain will take it off **{current siteName}** and send {siteName}'s visitors to {displayName}
> instead. Go ahead?

Wait for a yes. **No yes, no POST.**

> ⚠️ `{current primary}` goes through §R2 like every other domain the user sees, so a long one arrives
> truncated — `maximz-maxmind3.com` is shown as `maximz...mind3.com`. That is the rule as written, and
> it is followed here. It is also the one place where the rule works against the copy: this warning
> exists so the user recognises the domain being replaced. If §R2's threshold ever proves too
> aggressive for this line, **this** is the line to revisit — do not fix it by inventing a local
> exemption.

If §C3.2 was skipped — the user pre-stated PRIMARY, or you came from §C0b — this is the first message
of the offer, so carry the do-it-yourself line under it:

> Or do it yourself — [Connect it to {siteName}]({connect URL})

If §C3.2 already went out, the link is in the thread. Do not repeat it.

A **no** ends the bind attempt. Do not re-ask, do not counter-offer the redirect, do not explain.
Point at the link once and stop.

### C3.4 Do it (US-42)

```
POST https://manage.wix.com/_api/my-domains/v1/domains/{domain}/bind
{"domainName":"{domain}","siteId":"{siteId}","bindType":"PRIMARY"}
```

`{domain}` appears **twice** — in the path and in the body — and both are the full normalized domain
(§R1), never `displayName`. `bindType` is `PRIMARY` or `REDIRECT`, whichever
§C3.2 / §C3.3 settled. Send nothing else in the body.

**Treat any 2xx as success and read no fields out of the response.** Its shape has never been
observed — see §R4.4. A field you have not seen is not data.

Success, one line, nothing after it:

> Done — {displayName} is now the primary domain for **{siteName}**.

> Done — {displayName} now redirects to **{current primary}**.

On a **move**, the same line says where it came off — the user changed two sites and should see both
named once:

> Done — {displayName} is now the primary domain for **{siteName}**, and it's off
> **{current siteName}**.

> Done — {displayName} now redirects to **{current primary}**, and it's off **{current siteName}**.

Still one sentence. **Nothing about what {current siteName} does now** — that is not known (§C0c).

**Say nothing about timing, propagation, SSL, certificates or DNS.** None of it is known here and all
of it is forbidden (§C7). A successful bind produces one sentence.

Failure → silent retry (§R8). If the retry also fails, fall back to the link
**without narrating the failure** — no "that didn't work", no error, no apology for the machinery:

> Here's where to finish it — [Connect it to {siteName}]({connect URL})

That is a terminal state. Do not retry a third time, and do not offer the bind again in the same
conversation unless the user asks.

### C3.5 The user asks you to do the connection

Expect this — *"yes so connect it"*, *"connect it from here"*, *"why can't you do it?"*.

**First check whether an offer is already on the table.** If §C3.2 or §C3.3 has gone out, this *is* the
answer to it — read it as such (§C3.2's answer table) and act. Do not explain, do not re-offer, do not
treat a yes as a new question.

If no bind is available — ownership asserted, or a Free site — re-offer the link **once** and stop:

> Connecting happens in your Wix dashboard — the link opens it with {displayName} and
> **{site name}** already filled in, so you just follow the steps there.
>
> [Connect it to {site name}]({connect URL})

If the user asks again, re-send the link with one short line — *"That link is the way in — it's all
set up for you."* Do not build a new explanation each time, and do not explain **why** you cannot do
this one when you have done others.

**⛔ Never explain the mechanics.** No DNS, nameservers, A records, CNAME, TXT, propagation,
registrar access, "ownership verification", or "pointing vs nameservers". That is exactly the
internal detail §R9 forbids, and it turns a one-line handoff into a support
conversation the user did not ask for. This holds just as hard **after a successful bind** — a domain
now being a site's primary domain is not an opening to describe what happens next in the network.

Equally, never say what you *can't* do — no *"I have no access to your registrar"*, no *"that's not
something I can run"*, no listing your own limitations. Point at the link and stop.

If the user is logged in already, do not suggest logging in — the link opens their dashboard signed
in.

---

## C4. Free Site — Connect Link + Upgrade Block (US-34)

A Free-tier site still gets the connect link — the user should see where the domain would go — but
connecting is a Premium feature, so the upgrade block follows it in the **same** message.

**No bind happens here, ever.** Not the POST, not the offer, not the primary-or-redirect question —
the gate in §R4.4 fails on a Free site and there is nothing to ask about. The
inventory §C3.1 may have fetched is discarded unread.

The opening line splits on ownership state exactly as in §C3; the upgrade block below it is identical
either way.

**Ownership confirmed:**

> {displayName} is yours and isn't connected to a site yet — [Connect it to {site name}](https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true)
>
> **Upgrade {site name} with a Premium plan to connect your domain**
>
> Connecting a domain is a Premium feature. Upgrade now to let visitors reach you at a custom web address and enjoy Premium benefits.
>
> [Upgrade →]({upgrade URL})

**Ownership asserted:**

> {displayName} is registered. If it's yours — [Connect it to {site name}](https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true)
>
> **Upgrade {site name} with a Premium plan to connect your domain**
>
> Connecting a domain is a Premium feature. Upgrade now to let visitors reach you at a custom web address and enjoy Premium benefits.
>
> [Upgrade →]({upgrade URL})

The upgrade block copy is fixed. Do not reword it, do not add a benefits list, do not explain what
Premium includes, and do not promise to connect the domain once they upgrade.

If the user does upgrade mid-conversation, re-run §C2. A site that now reads Premium goes to §C3 like
any other — the offer becomes available at that point, not before.

### Which upgrade URL

| Editor | URL |
|--------|-----|
| **Studio** (US-35) | `https://manage.wix.com/premium-pricing/studio/select-plan?siteGuid={siteId}` |
| **Classic / sunrise** (US-36) | `https://manage.wix.com/premium-pricing/sunrise/select-plan?siteGuid={siteId}` |

Detect the editor: the dashboard URL contains `/studio/`, or the site context exposes
`editorType: "studio"` → `studio`. Otherwise → `sunrise`. **When uncertain, default to `sunrise`.**

**Terminal state. Stop here.**

---

## C5. No Wix Site (US-17)

The user is logged in but list of sites returned nothing. Connecting is impossible without a site,
so say so plainly and offer the way out:

> Connecting a domain requires a Wix site. Want to create one?

- **Yes** → show the sign-up entry point. In a channel with a widget runtime, that is the sign-up
  widget; in a plain-markdown channel, link to `https://www.wix.com/`.
  **Terminal state. Stop here** — do not continue into any other flow afterwards.
- **No** → offer the alternative once: *"No problem. Would you like to look for a domain to purchase
  instead?"* If yes → §A5. If no, end.

Do not pitch Premium plans here — there is no site to upgrade yet.

---

## C6. Domain Not Registered After All

If a re-check ever shows the domain is available, the user does not own it. Say:

> {displayName} isn't registered yet — did you mean you'd like to purchase it?

- Yes → **Now go to §P1 and follow it.**
- No → *"Do you own a different domain you'd like to connect?"* → back to §A4
  with the new domain.

---

## C7. Forbidden Actions

❌ **Never:**

- Resolve a site before the availability check.
- Fetch list of sites when a `siteId` is already in context — including when the site was already
  named by the ownership lookup (§R3, Shortcut).
- Send a connect link for a domain that is already connected in the role asked for. Check §C0 first.
- **Bind a subdomain on the strength of its root domain.** *Confirmed via root* earns the
  unconditional wording and nothing else; §R4.4's first condition wants a match
  on the domain being connected. The link is the whole answer there.
- **Adopt the root domain's site as the subdomain's.** A root match under `assigned` names the site
  the *root* is on. It is the only site the account can suggest and it is still a guess about where
  the subdomain belongs — §C1's Case R offers it and waits for a yes. Since every connect URL carries
  a `siteId`, sending the link first decides for the user and presents it as an answer. *"I used that
  site rather than asking"* is not a defence; it is the bug.
- **Blend the root sentence with the hedge.** *"sits under {root displayName}, which is in your Wix
  account. If it's yours —"* states a fact and then doubts it. The three openings above are three,
  not ingredients.
- **Bind without all four conditions in §R4.4.** Ownership merely asserted, no
  `siteId`, a Free site, or no affirmative answer — any one of them makes the link the whole answer.
- **Bind on the strength of ownership the user asserted.** An externally-registered domain the lookup
  never saw is not yours to write to a live site.
- **Move a domain without naming the site it comes off.** A bind re-assigns, so §C0c's move changes two
  live sites with one POST. §C3.2d names the site being left, in the offer, before any yes is possible —
  and §C3.3 names it again when a primary domain is also being replaced. An offer that says only where
  the domain is going is not a valid offer for a move.
- **Say what happens to the site the domain leaves.** Whether it falls back to a `wix.com` address,
  whether one of its redirects gets promoted, whether anything breaks — no call this skill makes
  answers that. Name what the domain stops doing and stop.
- **Ask a question whose yes and no produce the same reply.** *"Want to move it to {requested site}?"*
  followed by a bare link is the specific failure: it offers to act and withdraws it a turn later. If
  a move is genuinely on offer, §C3.2d asks for it and §C3.4 performs it; if it is not — a Free target
  site — do not raise it at all.
- **POST a bind the user did not say yes to**, or infer a yes from silence, from a repeated request,
  or from an ambiguous answer.
- **Replace a live primary domain without §C3.3.** The domain being displaced is named, and the user
  confirms, before anything moves.
- **Guess a `bindType`.** One of the two overwrites the site's address. Ambiguity is re-asked, not
  resolved.
- **Read a field out of the bind response.** Its shape is unverified; a 2xx is the entire signal.
- Say *"main address"*, *"main domain"*, *"main URL"* or *"root domain"* for **primary domain** — see
  §R9. The user may say "main one"; your reply says "primary domain".
- Promise timing, propagation, SSL or "up to 48 hours" after a bind. None of it is known.
- Narrate a bind failure. Silent retry, then the link (§C3.4).
- Say *"If it's yours"* when the account lookup has confirmed it **is** theirs — or drop the hedge
  when it has not. The two openings in §C3 are not interchangeable.
- Ask *"do you already own this domain?"*. Either the lookup answered it or the hedge covers it.
- Show the upgrade block to a Premium site, or omit the connect link for a Free site — Free-tier
  users get both.
- Ask the primary-or-redirect question on a Free site, or anywhere else no bind can follow it.
- Use `availability.premium` to decide Premium status.
- Reword the upgrade block, or explain Premium's feature set.
- Add text after the connect link, the upgrade block or the success line.
- Offer to purchase a domain the user has just said they own.
- Explain DNS, nameservers, A/CNAME/TXT records, propagation or registrar access — ever, to anyone,
  however directly asked, before or after a successful bind. See §C3.5.
- Narrate your own limitations ("I can't do that from here", "I have no access to…"). Re-send the
  link instead.

✅ **Always:**

- Use the full domain in `q=`, in the bind path and in the bind body; the site's display name in the
  link label; `displayName` (§R2) for every domain the user sees, including the current primary.
- Pick the §C3 / §C4 opening from the ownership state you arrived with, defaulting to **asserted**.
- Put the do-it-yourself link in the **same** message as the offer.
- Default to `sunrise` when the editor type is unclear.
- Keep the whole path to a single user-visible message where possible — the offer is one message, the
  result is one line.

---

# Part R — Reference

**Read this part before making any API call.** It is the single source of truth for endpoints,
product IDs, URL templates, site resolution and error handling. Parts A, P and C all defer to it —
where they disagree with this part, this part wins.

Covers **US-13, US-14, US-15, US-16, US-37, US-38, US-39**.

§R4.3 (domain ownership) is the mechanism behind **US-40** and **US-41**, and it is what scopes
**US-09** to domains the lookup does not find. §R4.4 (bind) is the mechanism behind **US-42 – US-45**.
See §C3.

⚠️ §R4.4 is the only **write to a user's live site** anywhere in this skill. Its gate is not advice.

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

### R1.1 Root Domain and Subdomains (US-48, US-49, US-50)

Some hosts a user names are **subdomains** — `shop.maximz.fr` sits under `maximz.fr`. That changes
who can be shown to own it, so settle it here, during normalization, before any call.

Extract the TLD greedily from the right, exactly as §R7 does — `.co.uk`, never `.uk`. What remains is
the **name part**:

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

**On an unfamiliar suffix, treat the host as a root domain.** §R7's list covers the multi-label
suffixes this skill has met and is not exhaustive — `.co.il` and `.com.mx` are real and missing from
it. Guessing *subdomain* wrongly produces an offer to connect something unregistrable; guessing *root
domain* wrongly just falls back to the ordinary flow. Take the fallback.

Note that `www.` is already gone by this point — the strip rule above removes it, so `www.maximz.fr`
is the root domain `maximz.fr` and never a subdomain.

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
- **Connect path** — a site is required. Resolve only *after* the availability check. See §C1.

> **Shortcut:** if the ownership check (§R4.3) came back with an `assigned` match **on the domain
> being connected**, the site is already named in that response (`sites[].site.siteName` /
> `.siteId`). Use it. Nothing below needs to run — in particular, do **not** fetch list of sites to
> re-discover a site you have just been handed.
>
> ⛔ **A match on a subdomain's *root* domain is not that match.** It names the site the **root** is
> on, which is a guess about where the subdomain belongs — the only site the account can suggest, and
> still the user's to choose. Offer it and wait: §C1, Case R. This is the line §R4.4's condition 1
> already draws — a root match settles ownership and nothing that gets written.

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
| No sites | Purchase path → continue standalone. Connect path → US-17 terminal state, see §C5. |

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

**Check domain availability**

```
GET https://www.wixapis.com/domain-search/v2/check-domain-availability?domain={domain}
```

```json
{ "availability": { "domain": "cozycuts.com", "available": false, "premium": false, "premiumType": "UNKNOWN_PREMIUM_TYPE" } }
```

| Field | Meaning |
|-------|---------|
| `availability.available: true` | Not registered — buyable |
| `availability.available: false` | Registered — taken |
| `availability.premium` | ⚠️ **Ignore completely.** This is domain *pricing tier*, not Wix site Premium status. Site Premium comes only from `premiumStatus` (§R4.2). |

**Unsupported TLD** is not a field on the success body — it is an **HTTP 400 error body**:

```json
{ "message": "Unsupported TLD for domain name myshop.ws",
  "details": { "applicationError": { "code": "DOMAINS_UNSUPPORTED_TLD",
                                     "description": "Unsupported TLD for domain name myshop.ws" } } }
```

Detect it at `details.applicationError.code === "DOMAINS_UNSUPPORTED_TLD"`. Do **not** look for
`availability.available` on this response — the `availability` object is absent.

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
| Privacy addon pricing | Same offering endpoint with the addon product type id `b3d86a1d-9db3-4f69-bd54-c132808856b1` |
| TLD coupon eligibility | `com.wixpress.premium.domain.tlds.DomainTld/ListTlds`<br>Body: `{ "filter": { "tlds": ["{TLD_WITHOUT_DOT}"] } }` |
| Active Premium sale | `getPremiumSale` context call → `wix.premium.store.v1.sales/GetSale` |
| Existing contacts | `GET https://manage.wix.com/v1/domain-registration-intents/preview/{domain}` |
| Save contacts | `POST https://manage.wix.com/v1/domain-registration-intents/upsert` |
| Cancel active cart | `POST https://manage.wix.com/_api/premium-cart/v1/carts/active/cancel` · Body `{}` |
| Get fresh cart | `GET https://manage.wix.com/_api/premium-cart/v1/carts/active` |
| Add items to cart | `PATCH https://manage.wix.com/_api/premium-cart/v1/carts/active/add-items` |
| **Does this domain belong to the user** | See §R4.3 below — two calls, run together |
| **What domains are already on a site** | `GET https://manage.wix.com/_api/my-domains/v1/domains/assigned?filter.msid={siteId}` — see §R4.4 |
| **Connect a domain to a site** | `POST https://manage.wix.com/_api/my-domains/v1/domains/{domain}/bind` — see §R4.4. **This is a write. It is gated.** |

**Premium status:** read `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.
`allowedDomain: true` → Premium site. `allowedDomain: false` → Free site.

**The offering endpoint** is the `getDomainCycles` call — the same one the production `get-domain`
purchase flow uses. Noted for whoever next reconciles this skill against production; it changes
nothing about how the call is made.

**Both offering variants return the same envelope** — `products[].pricingDetails[]`, one entry per
cycle, each carrying `finalPrice` and `renewalPrice`. Verified live for the domain type and the addon
type alike. `renewalPrice.total` is always the charge for **the same period again**, never a yearly
rate (see §R9).

### R4.3 Domain Ownership — My Domains

Answers a question the availability check cannot: the domain is registered, but is it registered
**to this user**? Without it, "taken by a stranger" and "sitting in your own account" look identical.

```
GET https://manage.wix.com/_api/my-domains/v1/domains/assigned?filter.searchTerm={domain}
GET https://manage.wix.com/_api/my-domains/v1/domains/unassigned?filter.searchTerm={domain}
```

Both go through `ManageWixSite` — ordinary account-level Wix session auth, the same family as
`premiumStatus`, the cart and the offering call. **No account-level API key is needed.** Do not add
headers.

`{domain}` is the normalized domain (§R1) — `maximz.fr`. Never the truncated `displayName`, never the
SLD alone.

**Run both, together, silently, and only when `available: false`.** An unregistered domain has no
owner, so there is nothing to look up.

**A subdomain is the one other entry point** (§A3.1). A subdomain is not
separately registrable, so no availability check runs for it and this lookup is reached directly:
keyed on the subdomain first, then — only if that finds nothing — keyed on its root domain (§R1.1).

A root-domain match **confirms** the subdomain. The account holding `maximz.fr` is the account that
decides what `shop.maximz.fr` resolves to, so there is nothing left for the user to assert. Compare
exactly against whichever value you searched, the subdomain or the root, and never against the other.

⛔ **Confirmed-via-root does not unlock a bind, and does not resolve a site.** It settles the
*wording* — the unconditional opening instead of the hedge — and nothing else. §R4.4's first
condition still asks for an exact match on the domain being connected, and a root match is not one:
the link is the whole answer there. And the site named alongside a root match is the **root's** site,
so it is a candidate for the subdomain rather than a resolution — §C1, Case R asks the user before
it reaches a link.

#### Response shapes

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
> `displayName` from §R2 — it is the API's own label and carries no truncation. Compute the visible
> form yourself with §R2. Never render the API's `displayName`.

> Both responses carry far more than the fields above — registrant names, street addresses, phone
> numbers, contract IDs. **None of it is ever shown to the user or reasoned about.** You need
> exactly two things out of this call: does it match, and what is the site called. Reading a
> registrant's address out of this response is the same violation as a WHOIS lookup
> (§A1.1).

#### ⚠️ `filter.searchTerm` is a search, not a lookup

It matches on substrings. `filter.searchTerm=maximz` returns 35 domains — `maximz.fr`,
`maximz1.de`, `sub3.maximz-cor.com` and 32 others. A hit is **not** ownership.

**Always compare the returned string to `{domain}` exactly** (both already lowercased by §R1) before
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
> has exactly one source, `premiumStatus` (§R4.2), and two sources will eventually disagree.

#### The same endpoint, filtered by site — `filter.msid`

`assigned` takes a second filter. Swap the search term for a site ID and it stops answering *"where
is this domain?"* and starts answering *"what is on this site?"*:

```
GET https://manage.wix.com/_api/my-domains/v1/domains/assigned?filter.msid={siteId}
```

**Same envelope, same fields, same reading rules** — one `sites[]` entry per site, `primary`,
`redirects[]`, `transfers`, `isAllDataReturned`. Verified live in both shapes:

| Site | Response |
|------|----------|
| Has domains | `{"sites":[{"site":{…},"primary":{…},"redirects":[…],"transfers":[]}],"isAllDataReturned":true}` |
| Has none | `{"sites":[],"isAllDataReturned":true}` — **empty, not an error** |

The empty form is the answer *"no domains on this site yet"*, and it is a perfectly normal one. Do not
retry it, do not treat it as a failure, do not escalate.

This is the inventory call §R4.4 needs before it can ask the user anything. Everything already said
about §R4.3 applies to it unchanged — including the exact-match rule (a `filter.msid` response is
scoped to one site but its `primary` and `redirects[]` still have to be compared to `{domain}`
exactly), and the rule that nothing but the match and the site name comes out of the response.

#### ⛔ One lookup, one retry — never re-authenticate

`subject is missing` (HTTP 400) has been observed from the `assigned` endpoint while `unassigned`
answered normally in the same breath. **It does not mean you got the auth wrong**, and §R4.1's
*"remove the headers and retry"* rule does not apply to it — that one is about `403` on the **public**
endpoints.

So do not go hunting for a second auth shape. Not `scope: "account"` in place of `scope: "site"`, not a
different `siteId`, not `ManageWixSite` after the same 400 came back from `ExecuteWixAPI`. **Two calls,
one silent retry, and this lookup is finished** — apply the table below and carry on with whatever the
surviving call returned.

This lookup is an enrichment, not a gate: everything downstream works without it, and §A4b-C's copy
already hedges for exactly this case. Four attempts at the same question is the observed failure mode,
and it buys the user nothing.

#### When the check cannot run

| Situation | Do |
|-----------|-----|
| User is not logged in | **Skip both calls.** There is no account to search. Continue as if no match — ownership is unknown, not disproven. |
| One call fails, and its silent retry (§R8) also fails | Treat **that endpoint** as no match and use whatever the other one returned. A confirmed match from the surviving call still counts. |
| Both fail | Continue as if no match. **Do not** show the escalation ladder for this call — it is an enrichment, and the flow it enriches still works without it. |

In both cases the fallback is the no-match branch, whose copy already hedges
(*"If it's yours…"*). That hedge is exactly right when ownership is unknown — and exactly wrong once
this call has confirmed it.

### R4.4 Connect a Domain to a Site — Bind

Everything else in this part reads. **This writes, and it writes to a site the user's visitors are
looking at right now.** Read the gate before the payload.

**This is the operation behind *connect it to my site*, *assign it to my site* and *bind it to my
site*** — three ways of asking for the same thing (§A2). It is **not** what
*connect it to Wix* or *add it to Wix* means: those ask for a domain at an outside registrar to be
brought into the account, which is the connect link in §C3 and a precondition of
anything here. A domain the account does not hold fails condition 1 below, so the phrasing never
decides whether this call may run — the lookup in §R4.3 does.

```
POST https://manage.wix.com/_api/my-domains/v1/domains/{domain}/bind
```

```json
{ "domainName": "{domain}", "siteId": "{siteId}", "bindType": "PRIMARY" }
```

Goes through the same `manage.wix.com/_api/` session auth as `premiumStatus`, the cart and §R4.3 — via
`CallWixSiteAPI` with the resolved `siteId`, or `ManageWixSite`. **No headers, no account-level API
key.**

`{domain}` appears **twice** — once in the path, once in `domainName` — and both are the full
normalized domain (§R1). Never the truncated `displayName`, never the SLD alone, never a `www.` form.
Send no fields beyond the three above.

| `bindType` | Meaning in the product |
|------------|------------------------|
| `PRIMARY` | The domain becomes the site's **primary domain** — the address visitors are sent to. |
| `REDIRECT` | The domain becomes a **secondary domain** — it forwards visitors to the site's existing primary domain. |

Those two are the whole enum. There is no third value; do not invent `SECONDARY`, `ALIAS` or
`POINTING`.

#### ⚠️ The response shape is unverified

This call has **never been observed.** Until a real response has been seen and written down here:

- Treat **any 2xx as success**, and a non-2xx as a failure for §R8's silent retry.
- **Read no fields out of the body.** Not a status, not a returned domain name, not an ID, not a
  timestamp, not an ETA. Do not branch on anything in it.

This is the same rule that stops a price being fabricated (§R9). A field you have not seen is not
data, and a field name that sounds plausible is a guess with a colon after it.

#### The gate — all four, every time

| # | Condition | Where it comes from |
|---|-----------|---------------------|
| 1 | Ownership is **confirmed** by an exact match in §R4.3 **on the domain being connected** — an `unassigned` match, or an `assigned` match on any of the user's sites. A subdomain confirmed only by its root domain (§R1.1) does **not** satisfy this | §R4.3 |
| 2 | A `siteId` is resolved | §R3 |
| 3 | The site is **Premium** — `premiumState !== "FREE"` from `premiumStatus` (§R4.2), and from nothing else | §R4.2 |
| 4 | The user has answered the offer **in the affirmative** — and the offer named every live thing the bind changes: the primary domain it displaces on the target site, and the site the domain comes off if it is moving | §C3.2, §C3.3 |

**If any one of them fails, there is no POST.** The dashboard connect link (§R6) is the entire answer,
and it is a good one — it does the same job with the user's own hands.

The failure worth naming, because it looks like a pass:

- **Ownership merely *asserted*.** The user saying *"it's mine"* is not condition 1. A domain
  registered outside Wix and never connected to a Wix site is invisible to §R4.3, so the user may
  well own it — but "may well" is not the standard for writing to a live site, and such a domain
  needs work at its registrar that this skill is forbidden to discuss anyway.

#### ⚠️ A bind **re-assigns** — one POST, two live sites

Binding a domain that is already on another of the user's sites **moves** it: it comes off the site it
was on and lands on the new one. There is no unbind call because none is needed.

That makes condition 4 heavier than it looks. A move changes a site the user may not be thinking about
— possibly taking away its primary domain — so the offer has to name that site before the user can
agree to anything. §C0c and §C3.2d own that copy; this is the rule behind it.

What is **not** known, and must never be stated: what the site left behind does afterwards. Whether it
reverts to a `wix.com` address, whether one of its other domains is promoted, whether anything about it
breaks — no call here answers that. Name what the domain stops doing and stop.

#### Vocabulary is fixed

**"Primary domain"** and **"secondary domain"** are the product's own words — the dashboard, the
official docs and this API all use them. Say *primary domain*. **Never** *"main address"*, *"main
domain"*, *"main URL"*, *"root domain"*, or any other paraphrase. A user who says *"the main one"*
gets an answer that says *primary domain*.

**One exception, and it is a different concept entirely.** *Root domain* is the correct term for the
domain a subdomain sits under — `maximz.fr` under `shop.maximz.fr` (§R1.1, §A3.1). That sense is
permitted. It describes a relationship between two domain names and says nothing about the role
either one plays on a site, so it never stands in for *primary domain*. Both can be true at once
without touching: a root domain may be connected as a secondary domain, and a subdomain may be a
site's primary domain.

#### What never comes with a bind

No timing, no propagation, no "up to 48 hours", no SSL or certificates, no DNS, no nameservers. None
of it is known from this call and all of it is forbidden by §R9. A successful bind is one sentence.

## R5. Product IDs

| Item | ID |
|------|-----|
| Domain product **type** | `72af0602-1321-4897-8299-f507480b2bb8` |
| Domain product **id** | Read `products[0].productId` from the offering response — never hardcode |
| Addon product **type** (all three) | `b3d86a1d-9db3-4f69-bd54-c132808856b1` |
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
| **Connect domain** | `https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domain}&invoke=true` |
| **Upgrade — Studio editor** | `https://manage.wix.com/premium-pricing/studio/select-plan?siteGuid={siteId}` |
| **Upgrade — Classic editor** | `https://manage.wix.com/premium-pricing/sunrise/select-plan?siteGuid={siteId}` |
| **Fallback domain search** | `https://manage.wix.com/account/domains` |

Notes:

- The bundle link is the `premium-pricing/wix/select-plan` form above. An older
  `premium-domains/split-page?domainName=…` form also exists — **do not use it.**
- The connect link carries no `referralInfo`. A `referralInfo=mydomains__emptyState` value belongs to
  the My Domains empty-state entry point and does not apply to this channel. If the host channel
  supplies its own referral value, append it — otherwise omit it.
- Link label for the connect URL is `Connect it to {site name}`; use `displayName` wherever the
  domain itself is the visible label.

### Editor type (US-35, US-36)

Picks `studio` vs `sunrise` in the upgrade URL:

- Dashboard URL contains `/studio/`, or the site context exposes `editorType: "studio"` → `studio`
- Otherwise → `sunrise` (Classic). **When uncertain, default to `sunrise`.**

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
- Use `availability.premium` to decide anything.
- Fetch list of sites when a `siteId` is already in context. A partial roster the host preloaded is
  not that — see Case A.
- **Announce a site count instead of the sites.** *"You have 93 sites — want me to list them?"* asks
  permission for a step already required. Show them (§R3 Case B) — all of them up to eight, otherwise five
  and an invitation to name one.
- **Hedge about ownership the account already settled.** Once §R4.3 returns an exact match, the domain
  *is* the user's — no *"if it's yours"*, no *"do you own this?"*, no *"assuming it's yours"*. The
  hedge belongs to the branch where ownership is genuinely an inference, and nowhere else.
- **Treat a `searchTerm` hit as ownership.** It is a substring search. Compare the returned domain
  string to the normalized domain exactly, or you will tell a user they own a domain they do not.
- **Hedge about a subdomain whose root domain the account holds.** *"If shop.maximz.fr is yours"* to
  a user who owns `maximz.fr` asks them to vouch for something the account already proves. §R1.1 and
  §A3.1 settle this before any message goes out.
- **Check availability for a subdomain.** It is not separately registrable, so there is no answer to
  get. Go straight to the ownership lookups (§A3.1).
- **Read a multi-label TLD as a subdomain.** `mybrand.co.uk` is a root domain. Offering to connect
  `co.uk` is the failure the greedy extraction in §R1.1 exists to prevent.
- **Press the root-domain recommendation more than once.** It is stated one time
  (§A3.1d). A user who has declined twice has decided, and the subdomain link
  still works without it.
- **Read anything but the match and the site name out of a My Domains response.** Registrant names,
  addresses, phone numbers, expiry dates and contract IDs are all in there. None of it is in scope.
  The `filter.msid` variant adds one more permitted field and no others: the site's current primary
  domain.
- **Bind a domain with any part of the §R4.4 gate unmet.** Ownership asserted rather than confirmed, no
  `siteId`, a Free site, or no affirmative answer — each one on its own is a stop. The connect link is
  the answer instead, and it is not a lesser one.
- **Move a domain between sites without naming the site it leaves.** A bind re-assigns, so one POST can
  change two live sites. The offer names both before the user can agree to either (§C3.2d), and
  *"want me to move it?"* on its own is not that offer.
- **POST a bind the user has not agreed to.** Not from silence, not from a repeated request, not from
  an ambiguous reply, not from *"whatever you think"*. One explicit yes sits in front of every write,
  and a second, named yes in front of anything that displaces a live primary domain
  (§C3.3).
- **Guess a `bindType`.** One of the two values replaces the address the site's visitors use. An
  unclear answer is asked again, never resolved by inference.
- **Read a field out of the bind response.** Its shape has never been observed. A 2xx is the whole
  signal; anything else you claim to have read from it is invented.
- **Say "main address" for "primary domain"** — or "main domain", "main URL", "root domain", or any
  other paraphrase. It is the product's term (§R4.4) and it is not yours to reword.
- **Promise anything about what happens after a bind** — timing, propagation, SSL, certificates, "it
  may take a few hours". None of it comes from the call, and the DNS ban covers the rest.
- **Say what happens to the site a moved domain leaves behind** — no *"it'll go back to its wix.com
  address"*, no *"your other domain will take over"*. Unknown, and unknowable from these calls.
- **Step outside the skill's scope on a taken domain.** No WHOIS or registrant lookup, no naming the
  owner, no aftermarket/broker/acquisition advice, no valuation, no trademark opinion, no web
  browsing. A taken domain produces exactly one message — from whichever §A4b
  branch applies — and nothing is appended to it. The ownership check in §R4.3 is the sole exception,
  and it only ever looks inside the user's own account. Full boundary: §A1.1.
- **Use a tool this skill did not ask for.** Having WHOIS, web search, or browsing available is not
  permission to use them. The information sources are the three in §R4 — that is the complete list.

✅ **Always:**

- Normalize the domain before every call.
- Reuse the resolved `siteId` for the rest of the conversation.
- Reveal information only when it changes what the user must do next.
- Say the currency note (§R10) in the same message as any price shown to the user — and never name
  a currency or convert between two.
- Check the §R4.4 gate before every bind, and offer the do-it-yourself link in the same breath as the
  offer to do it. The user is never left with only one of the two.

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
