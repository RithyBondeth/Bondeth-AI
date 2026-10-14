import type { Metadata } from "next";

import { VoicesLibrary } from "@/components/studios/VoicesLibrary";

export const metadata: Metadata = { title: "Voices" };

export default function VoicesPage() {
  return <VoicesLibrary />;
}
