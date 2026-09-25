// Current-member read over REST — the twin of app/wix/members/members.ts. Same export, same DTO;
// the mapper comes from members-core (the SAME file the SDK transport uses, deployed flat next to
// this one by deploy.mjs --stack static), so this file is only the transport: one GET. It runs with
// whatever token ./client.js holds — a member's after a rest/auth.ts login → the profile; a
// visitor's → 403 → null. Porting: keep the path and the fieldsets, port the core once.
// docs: https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/get-my-member.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { MEMBER_FIELDSETS, memberId, toCurrentMember, type Raw } from "./members-core.js";
import type { CurrentMember } from "./types.js";

/**
 * The current member, or null: for a visitor (the call is refused — "Missing site member id"), for
 * a logged-in member whose site lacks the Members Area app (no profile), and on any failure —
 * anonymous is a normal state, never an error.
 * GET /members/v1/members/my?fieldsets=FULL  → { member: { id, loginEmail, contactId, contact: { firstName, lastName }, profile: { nickname, photo? }, createdDate, … } }
 */
export async function fetchCurrentMember(): Promise<CurrentMember | null> {
  try {
    const res = await wixRequest<Raw>("/members/v1/members/my", { method: "GET", query: { fieldsets: MEMBER_FIELDSETS } });
    const raw: Raw | undefined = res?.member;
    return raw && memberId(raw) ? toCurrentMember(raw, imgSrc) : null;
  } catch {
    return null;
  }
}
