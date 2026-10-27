import { publicMetadata } from "@/lib/seo";
import { SeoJsonLd } from "@/components/SeoJsonLd";
import { TermsOfUse } from "@/components/LegalPages";

export const metadata = publicMetadata("/terms");

export default function TermsPage() { return <><SeoJsonLd path="/terms" /><TermsOfUse /></>; }
