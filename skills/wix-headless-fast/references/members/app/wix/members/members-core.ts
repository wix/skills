// Member rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./members.ts (the
// SDK, managed Astro and React) and the REST twin in references/members/rest/members.ts (fetch, a
// static site or a port to another language). The one rule about who a member "is" on screen lives
// HERE, once. A raw member comes from the SDK (`_id`, `_createdDate`) or from REST (`id`,
// `createdDate`); the mapper accepts both. Imports are type-only so a strip to JS emits no imports.
import type { CurrentMember } from "./types";

/** A raw Members V1 member as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

// Requested on the current-member read. FULL → loginEmail, status, the contact's names, the profile
// (nickname, photo), and the dates; the default PUBLIC fieldset has no login email and no names.
export const MEMBER_FIELDSETS = ["FULL"] as const;

/** The member's id on either transport; "" when the raw object isn't a member. */
export const memberId = (raw: Raw | undefined): string => raw?._id ?? raw?.id ?? "";

/**
 * Raw member → CurrentMember. displayName is the first non-empty of nickname, "first last", the
 * login email's local part, "Member". photoUrl is "" without a profile photo. memberSince is the
 * creation date as "YYYY-MM-DD" ("" when unknown).
 */
export function toCurrentMember(raw: Raw, imgSrc: ImgSrc): CurrentMember {
  const nickname: string = raw.profile?.nickname ?? "";
  const firstName: string = raw.contact?.firstName ?? "";
  const lastName: string = raw.contact?.lastName ?? "";
  const loginEmail: string = raw.loginEmail ?? "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const created = raw._createdDate ?? raw.createdDate;
  return {
    id: memberId(raw),
    loginEmail,
    displayName: nickname || fullName || loginEmail.split("@")[0] || "Member",
    firstName,
    lastName,
    nickname,
    photoUrl: imgSrc(raw.profile?.photo, 200, 200),
    contactId: raw.contactId ?? "",
    memberSince: created ? new Date(created).toISOString().slice(0, 10) : "",
  };
}
