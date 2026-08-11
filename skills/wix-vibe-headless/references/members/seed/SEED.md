# Members — seeding

**Nothing to seed.** Members login is the identity layer: members **self-register** through the
Wix login page, so there is no member to create at build time and nothing lands in a `seeded`
map. There is intentionally no `seed-*.js` here.

The members work is entirely **frontend wiring** (custom login, account area, gated content) —
see this vertical's `INSTRUCTIONS.md` and the reference components.

_Optional, off by default:_ only if a run's prompt explicitly asks to exercise the pricing-plans
purchase path end-to-end, one test member may be created — keep this off so headless runs stay
deterministic and don't stall on an interactive login. If you need that, use the **`wix-docs`**
skill for the current member-create shape (source: `wix-headless/references/SEED.md` § members).

## Reference
Members self-register, so this vertical seeds nothing. These are the methods to read if you do reach
for one — each page carries the exact body shape, the required permission scope, and the response
envelope. `Create Member` needs an elevated credential; the rest run from the client.
- Create Member (admin — pre-creating a member, e.g. a blog author): https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/create-member.md
- Login: https://dev.wix.com/docs/api-reference/business-management/headless/authentication/login-v-2.md
- Register: https://dev.wix.com/docs/api-reference/business-management/headless/authentication/register-v-2.md
- Retrieve Tokens: https://dev.wix.com/docs/api-reference/business-management/headless/authentication/retrieve-tokens.md
