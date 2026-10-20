import type { MetadataRoute } from "next";
import { absoluteUrl, INDEXING_ENABLED } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  // Let crawlers read private pages' noindex tags. robots.txt is not access control.
  return INDEXING_ENABLED
    ? { rules: { userAgent: "*", allow: "/" }, sitemap: absoluteUrl("/sitemap.xml") }
    : { rules: { userAgent: "*", disallow: "/" } };
}
