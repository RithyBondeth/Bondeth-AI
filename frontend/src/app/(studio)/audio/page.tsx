import { privateMetadata } from "@/lib/seo";

import { AudioLibrary } from "@/components/studios/AudioLibrary";

export const metadata = privateMetadata("Audio library");

export default function AudioPage() {
  return <AudioLibrary />;
}
