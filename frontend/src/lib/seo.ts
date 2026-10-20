import type { Metadata } from "next";
import { PUBLIC_PAGES, type PublicPath } from "@/lib/seo-pages";

function configuredOrigin(): URL {
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_APP_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.");
  }
  return url;
}

export const SITE_URL = configuredOrigin();
const localHost = /^(localhost|127(?:\.\d+){3}|\[::1\])$/.test(SITE_URL.hostname) || SITE_URL.hostname.endsWith(".localhost");
// Development and explicitly disabled previews must never advertise indexable URLs.
export const INDEXING_ENABLED = !localHost && process.env.SEO_INDEXING !== "false";
export const NO_INDEX: Metadata["robots"] = { index: false, follow: false, noarchive: true, nosnippet: true };
export const PUBLIC_ROBOTS: Metadata["robots"] = INDEXING_ENABLED
  ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } }
  : NO_INDEX;

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).href;
}

export function publicMetadata(path: PublicPath): Metadata {
  const { title, description } = PUBLIC_PAGES[path];
  const url = absoluteUrl(path);
  const socialTitle = `${title} · Bondeth AI`;
  return {
    title, description,
    alternates: { canonical: url },
    robots: PUBLIC_ROBOTS,
    openGraph: { type: "website", siteName: "Bondeth AI", locale: "en_US", url, title: socialTitle, description,
      images: [{ url: absoluteUrl("/opengraph-image.png"), width: 1200, height: 630, alt: "Bondeth AI — Khmer and English voice tools" }] },
    twitter: { card: "summary_large_image", title: socialTitle, description,
      images: [{ url: absoluteUrl("/twitter-image.png"), alt: "Bondeth AI — Khmer and English voice tools" }] },
  };
}

export function privateMetadata(title: string): Metadata {
  // Never derive metadata or canonical URLs from private IDs, query strings, or user content.
  return { title, robots: NO_INDEX };
}

export function pageStructuredData(path: PublicPath) {
  const { title, description } = PUBLIC_PAGES[path];
  const url = absoluteUrl(path);
  const websiteId = absoluteUrl("/#website");
  const page = { "@type": path === "/api" ? "TechArticle" : "WebPage", "@id": `${url}#webpage`, url,
    name: title, description, inLanguage: "en", isPartOf: { "@id": websiteId } };
  const graph: object[] = [page];
  if (path === "/") graph.push(
    { "@type": "WebSite", "@id": websiteId, url, name: "Bondeth AI", alternateName: "បណ្ឌិត AI", inLanguage: "en" },
    { "@type": "WebApplication", "@id": absoluteUrl("/#application"), name: "Bondeth AI", url, description,
      applicationCategory: "MultimediaApplication", operatingSystem: "Web browser",
      featureList: ["Khmer and English speech to text", "Text to speech", "Consented voice cloning", "Developer API"] },
  );
  else graph.push({ "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Bondeth AI", item: absoluteUrl("/") },
    { "@type": "ListItem", position: 2, name: title, item: url },
  ] });
  return { "@context": "https://schema.org", "@graph": graph };
}
