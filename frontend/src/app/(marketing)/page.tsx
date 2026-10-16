import { CreativeUses } from "@/components/CreativeUses";
import { ClosingCta, Features, Hero, StudioPreview } from "@/components/marketing";

export default function Home() {
  return (
    <>
      <Hero />
      <StudioPreview />
      <Features />
      <CreativeUses />
      <ClosingCta />
    </>
  );
}
