---
name: "Connect Domain"
description: Get a custom domain onto a user's Wix site when the request doesn't say whether the domain is a new one or one they already have — "set up a custom domain", "put a domain on my site", or a domain name with no word about buying or connecting it.
---

# Connect Domain

> **No domain named?** (*"set up a custom domain for my site"*, *"put a domain on my site"*) The whole
> reply is: *"What domain would you like to use?"* Stop there. Make no call: no suggestions, no
> availability check, no site lookup. Don't pick a domain for the user, and don't read further. §A2
> handles the answer.

The entry point for a domain request whose intent is not clear yet. It settles two things, **which
domain** and **what the user has**, then continues in the skill that does the work. It never buys,
assigns or changes DNS itself, and it says nothing about skills, steps or hand-offs: the user hears
one conversation.

| Then go to | For |
|------------|-----|
| [Purchase Domain](purchase-domain.md) | The user is buying a domain from Wix, or wants ideas for one for a business or topic they name — never for a request with no domain named |
| **[Assign Domain](assign-domain.md)** or **[Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)** | The user already owns the domain and wants it on their Wix site — Assign Domain when the account holds it, Connect External Domain or Sub Domain when it is registered elsewhere or is a subdomain |

Covers **US-01 – US-12**. §A4b routes **US-40 / US-41**, and decides whether the domain goes to
[Assign Domain](assign-domain.md) (**US-42 – US-46**) or to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md),
which hands over a link. Subdomains (**US-48 – US-50**) go straight there and skip the availability check entirely.

---

## A0. Before Any Call

**Normalize the domain** before any call, every time one is read from the user: strip `http://`,
`https://` and `www.`, strip any trailing path, query string or slash (`example.com/shop` →
`example.com`), lowercase. With no extension (`mybakery`), ask which one they want, as
[Check Domain Availability](check-domain-availability.md) step 1 says; never add one yourself. The result is `{domain}` everywhere below. `{displayName}` is the same name as the user sees it.

**A failed call:** retry once, silently — nothing said before or after. If the retry also fails,
say, verbatim: *Something went wrong on our end. Please try again in a moment.* If the user tries
again and it fails again: *Having trouble loading this — try again. You can also search for a domain
directly → [https://manage.wix.com/account/domains](https://manage.wix.com/account/domains)*

**Never expose internal mechanics** — no API, endpoint, tool, field or error names, no status codes —
and never narrate work in progress (*"let me check"*, *"one moment"*).

---

## A1. When To Use This Skill

The user wants a custom domain on their Wix site and has not said enough to know which flow it is:

- *"Set up a custom domain for my site"*, *"put a domain on my site"*, *"I want a custom domain"*
- *"mybakery.net"*, *"what about coolbrand.com for my site?"* — a domain, and no word about buying or
  connecting it
- A domain [Assign Domain](assign-domain.md) handed back because it is not in the account (§A4)

A request that already says which flow it is goes straight there: buying a domain, or ideas for one, is
[Purchase Domain](purchase-domain.md); a domain the user says they own goes to [Assign Domain](assign-domain.md); one registered with
another provider, or a subdomain, to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md). When one of those arrives here anyway, §A2 sends it on
without a question.

⛔ **Availability checks are never done by this recipe.** Every check of whether a domain is available,
taken, free or registered goes through [Check Domain Availability](check-domain-availability.md). Read
that skill, run the check as it describes, then come back with the result: §A4 only decides what
happens next. A bare availability question (*"is mybakery.com available?"*) is answered there and ends
there.

A question about the state of a domain already in the user's account — when it expires, whether it
renews, which site it is on — belongs to [Analyse Domain](analyse-domain.md). A question about its DNS
records, nameservers or propagation belongs to [Analyse Domain DNS](analyse-domain-dns.md), and a change
to them to [Update Domain DNS](update-domain-dns.md). A request to change which site a domain already in
the account is on, or its role there — *"make X the primary domain"*, *"remove X from my site"*,
*"move X to my other site"* — belongs to [Assign Domain](assign-domain.md).

**UX rule for everything below:** keep it natural, never expose internal mechanics, and reveal
information only when it changes what the user has to do next. See §A0.

---

## A1.1 ⛔ Out of Scope — Hard Boundary

This skill finds out which domain the user means and what they have, and passes it on. **That is the
whole job.** It has exactly three information sources: `check-domain-availability` (read
[Check Domain Availability](check-domain-availability.md)), `suggest-domains` ([Purchase Domain](purchase-domain.md) §S3), and the
account read in §A4b. Nothing else.

**Never do any of these, even if you have the tools and the user would find it useful:**

| ❌ Never | Why |
|---------|-----|
| WHOIS / RDAP lookups, or any registrant research | Not a source this skill uses. It also surfaces named individuals and addresses into a shopping conversation. |
| Name the owner of a domain, their company, city, or registrar | Same. A taken domain is *taken* — who holds it is not the user's next step, and it is not yours to publish. |
| Advise buying a domain **from its current owner** — outreach, brokers, escrow, Sedo/Efty, acquisition emails | Wix does not broker aftermarket sales. This is a different product, and a taken domain is a dead end here, not a negotiation. |
| Estimate what a domain is "worth", or quote four-to-five-figure ranges | Pure invention. The only prices come from the purchase flow's offering call. |
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
It searches what the user already has, and it returns nothing about anyone else. Use only whether
the domain is in the account, the site it is on and that site's name.

---

## A2. Intent Classification (US-01, US-02)

Two things to establish: the **domain** and the **intent**. **Take the first row that matches,
reading top-down.**

| Signal | Intent | Next |
|--------|--------|------|
| A domain the user has (named, or *"my domain"*, *"a domain I own"*) and a site to put it on, or a change of its role or site: *"connect / assign / bind / point / put X on my site"*, *"make X the primary domain"*, *"make X redirect to my site"*, *"remove / disconnect X from my site"*, *"move X to my other site"* | **CONNECT → a site** | **Go to [Assign Domain](assign-domain.md) and follow it.** No availability check first — it reads the account itself, and hands a domain the account doesn't hold back to §A4. No domain named (*"I want to connect a domain I already own to my site"*) is this row too: Assign Domain asks which domain. Send no steps, links or Help Center content first. |
| "buy", "purchase", "get", "register", "new domain" | **PURCHASE** | **Go to [Purchase Domain](purchase-domain.md) §S1 and follow it.** |
| No domain named, and nothing else to go on — no buy or own word, no business or topic: *"set up a custom domain for my site"*, *"put a domain on my site"*, *"I want a domain for my site"* | **UNKNOWN** | The whole reply is: *"What domain would you like to use?"* Nothing else in that message: no question about buying or owning, no site resolution, no suggestions, no link, no explanation. The answer decides the rest: a domain → §A3's named-domain row (the availability check and §A4 settle whether it is new or theirs); no domain yet, or a request for ideas → **[Purchase Domain](purchase-domain.md) §S1**; *"I have one"* with no name → *"What domain would you like to connect?"* |
| Wanting **a** domain for a business or topic the user names, no domain named: *"I need a domain for my pancakes restaurant"*, *"a domain for my bakery"* | **PURCHASE** | **Go to [Purchase Domain](purchase-domain.md) §S1 and follow it.** |
| "connect it **to Wix**", "add it to Wix", "bring it into Wix", "transfer it over", or "I have" / "I own" with no site in the request | **CONNECT → Wix** | §A3 |
| A specific domain, no buy/connect word, and no question about whether it is available | **UNKNOWN** | §A3 — the availability check (run with Check Domain Availability) and §A4 settle it |
| A specific domain, and the only question is whether it is available, taken or free | Not this recipe | [Check Domain Availability](check-domain-availability.md) |

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
Do not fall through to the question just because the words "buy" or "purchase" are absent —
*"I need a domain for my pancakes restaurant"* is a purchase. With nothing but the site to go on
(*"I want a domain for my site"*), it is the no-domain row: ask which domain.

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
| User named a specific domain — **even if they named a site too** | Normalize it (§A0). A **subdomain** (more than one label before the TLD, read greedily: `.co.uk`, never `.uk`, so `shop.maximz.fr` is one and `mybrand.co.uk` is not) → [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md), with no availability check. Anything else → §A4, **first**, before any site work |
| Anything else — no domain, and the request is to get one | **Go to [Purchase Domain](purchase-domain.md) §S1 and follow it.** |

---

## A4. What the Availability Result Means (US-07, US-08, US-09)

Check the normalized domain **silently** — no "let me check", no "one moment". This recipe does not run the
check: read [Check Domain Availability](check-domain-availability.md) and run it as that skill describes
(endpoints, request, response, errors), here as everywhere. This section only decides what happens next. Inside this flow §A4a, §A4b and §A6 decide the reply; the
"Reading the result" table in that skill does not apply. Map the result with this table, and keep the
intent §A2 settled — a result never changes it:

| Result | Next |
|--------|------|
| `availability.available: true`, or `availability.premium: true` whatever `available` says | §A4a |
| `availability.available: false` and `availability.premium: false` | §A4b |
| HTTP 400, `details.applicationError.code === "DOMAINS_UNSUPPORTED_TLD"` (no `availability` object) | §A6 |
| Any other failure | §A4d |

### A4a — `available: true` (US-08)

- **Intent is PURCHASE or UNKNOWN** → **go to [Purchase Domain](purchase-domain.md) §S2 and follow it.** It says the domain is
  available and continues into the purchase.
- **Intent is CONNECT** → the user cannot connect a domain nobody has registered. Say:
  *"{displayName} isn't registered yet — did you mean you'd like to purchase it?"*
    - Yes → **go to [Purchase Domain](purchase-domain.md) §P1 and follow it.**
    - No → *"Do you own a different domain you'd like to connect?"* → back to §A4 with the new domain.


### A4b — `available: false` (US-09)

The domain is registered. Registered by **whom** is the next question, and it decides everything that
follows — so answer it before you say a word.

#### Step 1 — whose domain is it? (silent)

Run the read in [Assign Domain](assign-domain.md)'s *Read the state* — one call, exactly as that skill
shows it — with `targetSiteId` set to the site the user named, or `null` when they named none. It
answers whether **this exact domain** is in the account and which site it is on. If it returns
`failed: true`, run the same call once more, silently (Assign Domain's `failed` row). Never look the
domain up in any other call.

- **User is not logged in**, or the read returns `failed: true` a second time → skip to **§A4b-C**.
  Ownership is unknown, which is what §A4b-C's copy already assumes.
- **Handed back by [Assign Domain](assign-domain.md)** — it found the domain is not in the account,
  or could not tell (signed out, or its read failed). Skip the read and go to **[Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)** with ownership
  **asserted** — §A4b-C's CONNECT rule: no suggestions.

**This runs before the suggestions call and before any message.** Alternatives are only fetched in
§A4b-C. Fetching them first means offering a user replacements for a domain they already own.

| Read result | Branch |
|-------------|--------|
| `assignment` is set | **§A4b-A** — theirs, already on a site |
| `owned: true` and `assignment: null` | **§A4b-B** — theirs, not on a site yet |
| `owned: false` | **§A4b-C** — not in their Wix account |

#### A4b-A — it is theirs, and already connected (US-40)

`{siteName}` is `sites[assignment.siteId].name` from the same read (*your site* when it is `null`). One
message, then stop:

> {displayName} is already connected to **{siteName}**.

No suggestions. No connect link — there is nothing to connect. No *"if it's yours"* — the account
just said it is. **Terminal state.**

If `assignment.role` is `REDIRECT`, the domain is in use as a forward:

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
wording here**, and do not promise here that the domain will be connected.

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
alternatives ([Purchase Domain](purchase-domain.md) §S3), then send **one** message containing **only** this:

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
  **go to [Purchase Domain](purchase-domain.md) §P1 and follow it.**
- Says it is theirs / wants to connect → **go to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) and follow it**, carrying the
  domain, the fact that it is already known to be taken, and ownership **asserted by the user**
  (not confirmed — the account search did not find it).
- Wants something else → back to §A3.


### A4c — `DOMAINS_UNSUPPORTED_TLD`

→ §A6.

### A4d — Any other failure

→ §A0. Retry once silently; the user should never learn a first attempt
happened.

---

## A5. Suggestions

Suggestions are [Purchase Domain](purchase-domain.md) §S3: the call, the paging and the copy. §A4b-C uses it for its three
alternatives.

---

## A6. Unsupported TLD — Split by Intent (US-10, US-11, US-12)

Detected as an HTTP 400 body with `details.applicationError.code === "DOMAINS_UNSUPPORTED_TLD"` —
there is no `availability` object on this response. See §A4.

The message opens the same way for both intents:

> We don't currently support .{TLD} domains.

What follows depends on intent — **these two branches are different and must not be merged.**

### A6a — PURCHASE intent (US-11)

**Go to [Purchase Domain](purchase-domain.md) §S4 and follow it.**

### A6b — CONNECT intent (US-12)

Do **not** show alternatives — a domain they do not own is no use for connecting. Ask for another
domain instead:

> We don't currently support .ws domains. Do you have a different domain you'd like to connect?

- User gives another domain → normalize → back to §A4.
- User has none → offer to buy one instead: *"Would you like to look for a domain to purchase
  instead?"* If yes → [Purchase Domain](purchase-domain.md) §S3, then **§P1**.

### A6c — UNKNOWN intent

Treat as PURCHASE: **go to [Purchase Domain](purchase-domain.md) §S4**, and let the alternatives list do the disambiguating.

---

## A7. Routing Summary

Every branch ends in exactly one of these. Name the destination to yourself, then follow that section —
do not improvise the next step from memory.

| State reached | Next |
|---------------|------|
| Buying, or ideas for a domain (§A2) | **Go to [Purchase Domain](purchase-domain.md) §S1 and follow it.** |
| Domain available, buying or intent unknown | **Go to [Purchase Domain](purchase-domain.md) §S2 and follow it.** |
| Connect intent, domain not registered, user wants to buy | **Go to [Purchase Domain](purchase-domain.md) §P1 and follow it.** |
| Suggestion picked (§A4b-C) | **Go to [Purchase Domain](purchase-domain.md) §P1 and follow it.** |
| Unsupported TLD, buying or intent unknown | **Go to [Purchase Domain](purchase-domain.md) §S4 and follow it.** |
| Domain is the user's and already on a site (§A4b-A) | **Nowhere — terminal.** One message, then stop. Unless the role or the site is wrong: **[Assign Domain](assign-domain.md)**. |
| Domain is the user's and unconnected (§A4b-B) | **Go to [Assign Domain](assign-domain.md) and follow it** — ownership **confirmed**. |
| A domain to put on a site, or a change of its role or site (§A2, *CONNECT → a site*) | **Go to [Assign Domain](assign-domain.md) and follow it.** |
| Handed back by Assign Domain — not in the account, or it could not tell | **§A4** with intent *CONNECT → a site*: available → §A4a; taken → **[Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)** with ownership **asserted**, no lookup, no suggestions. |
| Domain taken and the user says it is theirs (§A4b-C) | **Go to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) and follow it** — ownership **asserted**. Link only, **no assignment**. |
| A subdomain (§A3) | **Go to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) and follow it.** No availability check. |
| Persistent failure | §A0 — silent retry, then the two messages |

---

## A8. Fallback (US-38, US-39)

A call that fails twice is handled the same way everywhere in this skill — silent retry, then the two
messages. **§A0 is the rule**, including the verbatim copy. Never expose an error code, endpoint or
tool name in any of it.
