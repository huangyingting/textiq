import { redirect } from "next/navigation";

/**
 * The bare `/app/documents` index (issue #2022). There is no list rendered at
 * this segment — the real documents list lives at `/app` — so without a page
 * here `/app/documents` fell through to the 404 boundary while
 * `/app/documents/[id]` kept working. This permanently redirects to `/app`.
 */
export default function DocumentsIndexPage() {
  redirect("/app");
}
