import { executeInviteLinkRetentionDelete } from "@/lib/prisma-internal";

export function deleteRetainedInviteLinks(
  target: object,
  cutoff: Date,
): PromiseLike<unknown> {
  return executeInviteLinkRetentionDelete(target, cutoff);
}
