import { publicMetadata } from "@/lib/seo";
import { SeoJsonLd } from "@/components/SeoJsonLd";
import { ApiDocs } from "@/components/studios/ApiDocs";

export const metadata = publicMetadata("/api");

export default function ApiPage() {
  return <><SeoJsonLd path="/api" /><ApiDocs /></>;
}
