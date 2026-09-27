// Current-member read (Wix Members) over the SDK — the only file that touches raw member entities
// on this transport. The DTO mapper lives in ./members-core (shared with the REST twin in
// references/members/rest/members.ts); this file is the transport only. Identity vs. profile are
// different layers: "is this caller logged in?" needs no app install, but getCurrentMember returns
// profile DATA only once the Wix Members Area app is installed (the seed installs it). Copy as-is;
// extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/get-my-member.md
import { membersApi } from "./client";
import { imgSrc } from "../media";
import { MEMBER_FIELDSETS, memberId, toCurrentMember, type Raw } from "./members-core";
import type { CurrentMember } from "./types";

/**
 * The current member, or null for an anonymous visitor — and null for a LOGGED-IN member
 * when the Members Area app isn't installed (setup, not a code bug; the seed installs it).
 * Never throws: anonymous is a normal state for the client-side custom-login gate.
 * The SDK export is getCurrentMember — the REST name "Get My Member" does not exist on
 * the module; getMyMember(...) throws `is not a function`, and only once a real member
 * loads the page.
 */
export async function fetchCurrentMember(): Promise<CurrentMember | null> {
  try {
    const res = await membersApi.getCurrentMember({ fieldsets: [...MEMBER_FIELDSETS] as any });
    const raw = res.member as Raw | undefined;
    return raw && memberId(raw) ? toCurrentMember(raw, imgSrc) : null;
  } catch {
    return null;
  }
}
