// Members DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. The photo is a
// resolved https URL.

/** The logged-in member as the header/account surfaces need it. */
export interface CurrentMember {
  id: string;
  /** Email the member logs in with ("" when the fieldset hides it). */
  loginEmail: string;
  /** Best display name: nickname → first+last → the login email's local part. */
  displayName: string;
  firstName: string;
  lastName: string;
  nickname: string;
  /** Resolved https URL ("" when the member has no photo). */
  photoUrl: string;
  /** Contact-list id — the key for member-owned CMS/content lookups. */
  contactId: string;
  /** "YYYY-MM-DD" the membership was created ("" when unknown). */
  memberSince: string;
}
