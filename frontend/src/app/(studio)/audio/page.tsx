import type { Metadata } from "next";

import { AudioLibrary } from "@/components/studios/AudioLibrary";

export const metadata: Metadata = { title: "Audio library" };

export default function AudioPage() {
  return <AudioLibrary />;
}
