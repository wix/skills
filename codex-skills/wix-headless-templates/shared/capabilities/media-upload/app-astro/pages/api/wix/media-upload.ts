import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { files } from "@wix/media";
import { members } from "@wix/members";
import { mediaUploadPolicies } from "../../../wix/media-upload/policies.generated";

const elevatedGenerateUploadUrl = auth.elevate(files.generateFileUploadUrl);

/**
 * Who may use a policy. `members` (the default) admits a logged-in member only: the caller's own
 * session is read server-side, so an anonymous visitor gets 401 before anything is elevated.
 * `visitors` admits anyone — only for a policy the product means for the public (a form's file
 * field on a free site). A members policy needs the Wix Members Area app (the members seed
 * installs it): without it a logged-in member reads back as nobody.
 */
// Typed loosely on purpose: the generated file is `as const`, and a literal-typed `audience` would
// make the comparison below a type error whenever every policy in it says the same thing.
type Policy = { id: string; accept: readonly string[]; maxBytes: number; audience?: "members" | "visitors" };
const policies: readonly Policy[] = mediaUploadPolicies;

async function callerIsMember(): Promise<boolean> {
  try {
    const { member } = await members.getCurrentMember();
    return Boolean(member?._id);
  } catch {
    return false;
  }
}

type UploadRequest = {
  policyId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeInBytes?: unknown;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async ({ request }) => {
  let body: UploadRequest;
  try {
    body = (await request.json()) as UploadRequest;
  } catch {
    return json({ error: "Expected JSON" }, 400);
  }

  if (
    typeof body.policyId !== "string" ||
    typeof body.fileName !== "string" ||
    typeof body.mimeType !== "string" ||
    typeof body.sizeInBytes !== "number" ||
    !Number.isSafeInteger(body.sizeInBytes)
  ) {
    return json({ error: "Invalid upload request" }, 400);
  }
  const policy = policies.find((candidate) => candidate.id === body.policyId);
  if (!policy) return json({ error: "Unknown upload policy" }, 404);
  if (policy.audience !== "visitors" && !(await callerIsMember())) return json({ error: "Log in to upload" }, 401);
  if (!policy.accept.includes(body.mimeType)) return json({ error: "File type is not allowed" }, 415);
  if (body.sizeInBytes < 1 || body.sizeInBytes > policy.maxBytes) return json({ error: "File exceeds this policy's size limit" }, 413);

  // Do not accept a folder id, labels, privacy setting, or any other destination choice from
  // the browser. Add those as fixed policy fields only after the product actually needs them.
  const result = await elevatedGenerateUploadUrl(body.mimeType, {
    fileName: body.fileName.slice(0, 255),
  });
  return json({ uploadUrl: result.uploadUrl });
};
