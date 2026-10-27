import { publicMetadata } from "@/lib/seo";
import { SeoJsonLd } from "@/components/SeoJsonLd";
import { PrivacyPolicy } from "@/components/LegalPages";

export const metadata = publicMetadata("/privacy");

export default function PrivacyPage() { return <><SeoJsonLd path="/privacy" /><PrivacyPolicy /></>; }
