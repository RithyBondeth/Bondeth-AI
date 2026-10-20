import { CreativeUses } from "@/components/CreativeUses";
import { ClosingCta, Features, Hero, StudioPreview } from "@/components/marketing";
import { publicMetadata } from "@/lib/seo";
import { SeoJsonLd } from "@/components/SeoJsonLd";

export const metadata = publicMetadata("/");

export default function Home() {
  return (
    <>
      <SeoJsonLd path="/" />
      <Hero />
      <StudioPreview />
      <Features />
      <CreativeUses />
      <ClosingCta />
    </>
  );
}
