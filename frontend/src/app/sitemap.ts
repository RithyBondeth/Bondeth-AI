import type { MetadataRoute } from "next";
import { absoluteUrl, INDEXING_ENABLED } from "@/lib/seo";
import { PUBLIC_PAGES } from "@/lib/seo-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  // Do not list authentication, user libraries, transcript IDs, or preview deployments.
  // lastModified is omitted until there is a trustworthy per-page modification date.
  return INDEXING_ENABLED ? Object.keys(PUBLIC_PAGES).map((path) => ({ url: absoluteUrl(path) })) : [];
}
