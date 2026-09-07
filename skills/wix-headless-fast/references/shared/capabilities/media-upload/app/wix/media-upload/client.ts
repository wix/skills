// Safe browser half of the optional Media Upload capability.
// The browser supplies bytes only. It cannot choose a destination or elevate a Wix call:
// the named policy is enforced by /api/wix/media-upload on the server.

export type UploadedMedia = {
  id: string;
  url?: string;
  uploadUrl: string;
};

type UploadPolicyRequest = {
  policyId: string;
  fileName: string;
  mimeType: string;
  sizeInBytes: number;
};

export async function uploadMedia(policyId: string, file: File | Blob, fileName?: string): Promise<UploadedMedia> {
  const mimeType = file.type;
  const request: UploadPolicyRequest = {
    policyId,
    fileName: fileName ?? (file instanceof File ? file.name : "upload"),
    mimeType,
    sizeInBytes: file.size,
  };
  const ticket = await fetch("/api/wix/media-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!ticket.ok) throw new Error(`Upload could not be authorized (${ticket.status})`);
  const { uploadUrl } = (await ticket.json()) as UploadedMedia;

  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
  });
  const payload = (await uploaded.json().catch(() => null)) as
    | { file?: { id?: string; url?: string }; id?: string; url?: string }
    | null;
  const media = payload?.file ?? payload;
  if (!uploaded.ok || !media?.id) throw new Error(`Upload failed (${uploaded.status})`);

  return { id: media.id, url: media.url, uploadUrl };
}
