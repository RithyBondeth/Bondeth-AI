import type { Metadata } from "next";

import { ApiKeysLibrary } from "@/components/studios/ApiKeysLibrary";

export const metadata: Metadata = { title: "API keys" };

export default function ApiKeysPage() {
  return <ApiKeysLibrary />;
}
