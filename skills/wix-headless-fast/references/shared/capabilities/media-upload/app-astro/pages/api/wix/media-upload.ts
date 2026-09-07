import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { files } from "@wix/media";
import { mediaUploadPolicies } from "../../../wix/media-upload/policies.generated";

const elevatedGenerateUploadUrl = auth.elevate(files.generateFileUploadUrl);

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
  const policy = mediaUploadPolicies.find((candidate) => candidate.id === body.policyId);
  if (!policy) return json({ error: "Unknown upload policy" }, 404);
  if (!policy.accept.includes(body.mimeType as never)) return json({ error: "File type is not allowed" }, 415);
  if (body.sizeInBytes < 1 || body.sizeInBytes > policy.maxBytes) return json({ error: "File exceeds this policy's size limit" }, 413);

  // Do not accept a folder id, labels, privacy setting, or any other destination choice from
  // the browser. Add those as fixed policy fields only after the product actually needs them.
  const result = await elevatedGenerateUploadUrl(body.mimeType, {
    fileName: body.fileName.slice(0, 255),
  });
  return json({ uploadUrl: result.uploadUrl });
};
