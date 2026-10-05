// Author reads (Wix Members) — the only file that touches raw member entities on this transport.
// Goes over `wixFetch` (the SDK's own authenticated fetch, same identity as every module call)
// rather than the `@wix/members` module: the blog template does not depend on that package, and
// two small reads don't warrant it. The mappers live in ./authors-core (shared with the REST twin
// in templates/blog/rest/authors.ts). Both reads are non-fatal: authors are decoration.
// docs: https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/query-members.md
// docs: https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/get-my-member.md
import { wixFetch } from "../sdk";
import { imgSrc } from "../media";
import { authorsQuery, indexAuthors, toAuthor, uniqueIds } from "./authors-core";
import type { Raw } from "./posts-core";
import type { BlogAuthor } from "./types";

/**
 * Every distinct author of one page in ONE request, keyed by member id. {} on failure or when the
 * visitor may not read members — the cards render without a byline then.
 * POST /members/v1/members/query  { fieldsets: ["PUBLIC"], query: { filter: { id: { $in } }, paging: { limit } } }
 */
export async function fetchAuthorsByIds(ids: readonly (string | null | undefined)[]): Promise<Record<string, BlogAuthor>> {
  const unique = uniqueIds(ids);
  if (!unique.length) return {};
  try {
    const res = await wixFetch("/members/v1/members/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authorsQuery(unique)),
    });
    if (!res.ok) return {};
    const json = (await res.json()) as Raw;
    return indexAuthors(((json?.members ?? []) as Raw[]).map((m) => toAuthor(m, imgSrc)));
  } catch {
    return {};
  }
}

/**
 * The current member's id, or null for an anonymous visitor (the read answers 401/403 then). Used
 * to mark a member's own comments; never a login gate — the server decides who may comment.
 * GET /members/v1/members/my
 */
export async function fetchCurrentMemberId(): Promise<string | null> {
  try {
    const res = await wixFetch("/members/v1/members/my", { method: "GET" });
    if (!res.ok) return null;
    const json = (await res.json()) as Raw;
    return json?.member?.id ?? json?.member?._id ?? null;
  } catch {
    return null;
  }
}
