import { publicMetadata } from "@/lib/seo";
import { SeoJsonLd } from "@/components/SeoJsonLd";

import { SttStudio } from "@/components/studios/SttStudio";

export const metadata = publicMetadata("/stt");

export default function SttPage() {
  return <><SeoJsonLd path="/stt" /><SttStudio /></>;
}
