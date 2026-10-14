import type { Metadata } from "next";

import { TtsStudio } from "@/components/studios/TtsStudio";

export const metadata: Metadata = { title: "Text to Speech" };

export default function TtsPage() {
  return <TtsStudio />;
}
