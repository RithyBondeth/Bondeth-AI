import { privateMetadata } from "@/lib/seo";

import { VoicesLibrary } from "@/components/studios/VoicesLibrary";

export const metadata = privateMetadata("Voices");

export default function VoicesPage() {
  return <VoicesLibrary />;
}
