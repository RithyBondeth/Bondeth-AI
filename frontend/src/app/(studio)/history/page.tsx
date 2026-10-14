import type { Metadata } from "next";

import { HistoryLibrary } from "@/components/studios/HistoryLibrary";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return <HistoryLibrary />;
}
