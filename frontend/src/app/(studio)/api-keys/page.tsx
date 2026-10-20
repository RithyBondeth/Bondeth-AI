import { privateMetadata } from "@/lib/seo";

import { ApiKeysLibrary } from "@/components/studios/ApiKeysLibrary";

export const metadata = privateMetadata("API keys");

export default function ApiKeysPage() {
  return <ApiKeysLibrary />;
}
