import { getCloudflareContext } from "@opennextjs/cloudflare";

/** R2 bucket for report artifacts (PDFs, overlays, imagery), bound as BUCKET. */
export function bucket() {
  return getCloudflareContext().env.BUCKET;
}

/** Fetch an object's bytes from R2, or null if it doesn't exist. */
export async function getObjectBytes(key: string): Promise<ArrayBuffer | null> {
  const obj = await bucket().get(key);
  return obj ? await obj.arrayBuffer() : null;
}
