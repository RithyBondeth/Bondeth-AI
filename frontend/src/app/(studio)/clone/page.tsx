import { publicMetadata } from "@/lib/seo";
import { SeoJsonLd } from "@/components/SeoJsonLd";

import { CloneStudio } from "@/components/studios/CloneStudio";

export const metadata = publicMetadata("/clone");

export default function ClonePage() {
  return <><SeoJsonLd path="/clone" /><CloneStudio /></>;
}
