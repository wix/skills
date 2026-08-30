// Current-member read (Wix Members) — the only file that touches raw member entities.
// Identity vs. profile are different layers: "is this caller logged in?" needs no app
// install, but getCurrentMember returns profile DATA only once the Wix Members Area app is
// installed (the seed installs it). Copy as-is; extend by adding functions, not by editing
// these.
// docs: https://dev.wix.com/docs/api-reference/crm/members-contacts/members/members/get-my-member.md
import { membersApi } from "./client";
import { imgSrc } from "../media";
import type { CurrentMember } from "./types";

type Raw = Record<string, any>;

function toCurrentMember(raw: Raw): CurrentMember {
  const nickname = raw.profile?.nickname ?? "";
  const firstName = raw.contact?.firstName ?? "";
  const lastName = raw.contact?.lastName ?? "";
  const loginEmail = raw.loginEmail ?? "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  return {
    id: raw._id ?? "",
    loginEmail,
    displayName: nickname || fullName || loginEmail.split("@")[0] || "Member",
    firstName,
    lastName,
    nickname,
    photoUrl: imgSrc(raw.profile?.photo, 200, 200),
    contactId: raw.contactId ?? "",
    memberSince: raw._createdDate
      ? new Date(raw._createdDate).toISOString().slice(0, 10)
      : "",
  };
}

/**
 * The current member, or null for an anonymous visitor — and null for a LOGGED-IN member
 * when the Members Area app isn't installed (setup, not a code bug; the seed installs it).
 * Never throws: anonymous is a normal state for the client-side custom-login gate.
 * ⚠️ The SDK export is getCurrentMember — the REST name "Get My Member" does not exist on
 * the module; getMyMember(...) throws `is not a function`, and only once a real member
 * loads the page.
 */
export async function fetchCurrentMember(): Promise<CurrentMember | null> {
  try {
    const res = await membersApi.getCurrentMember({ fieldsets: ["FULL"] });
    const raw = res.member as Raw | undefined;
    return raw?._id ? toCurrentMember(raw) : null;
  } catch {
    return null;
  }
}
