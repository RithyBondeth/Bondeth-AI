import type { Metadata } from "next";

import { SttStudio } from "@/components/studios/SttStudio";

export const metadata: Metadata = { title: "Speech to Text" };

export default function SttPage() {
  return <SttStudio />;
}
