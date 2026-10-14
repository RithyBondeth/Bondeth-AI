import type { Metadata } from "next";

import { CloneStudio } from "@/components/studios/CloneStudio";

export const metadata: Metadata = { title: "Voice Clone" };

export default function ClonePage() {
  return <CloneStudio />;
}
