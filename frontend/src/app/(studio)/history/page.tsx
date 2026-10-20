import { privateMetadata } from "@/lib/seo";

import { HistoryLibrary } from "@/components/studios/HistoryLibrary";

export const metadata = privateMetadata("History");

export default function HistoryPage() {
  return <HistoryLibrary />;
}
