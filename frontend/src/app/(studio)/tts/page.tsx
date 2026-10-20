import { publicMetadata } from "@/lib/seo";
import { SeoJsonLd } from "@/components/SeoJsonLd";

import { TtsStudio } from "@/components/studios/TtsStudio";

export const metadata = publicMetadata("/tts");

export default function TtsPage() {
  return <><SeoJsonLd path="/tts" /><TtsStudio /></>;
}
