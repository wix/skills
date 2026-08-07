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
