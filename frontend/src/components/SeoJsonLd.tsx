import { pageStructuredData } from "@/lib/seo";
import type { PublicPath } from "@/lib/seo-pages";

/** Server-rendered, authored facts only: no user text, invented reviews, or ratings. */
export function SeoJsonLd({ path }: { path: PublicPath }) {
  const json = JSON.stringify(pageStructuredData(path)).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
