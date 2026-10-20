import { privateMetadata } from "@/lib/seo";

import { AccountSettings } from "@/components/studios/AccountSettings";

export const metadata = privateMetadata("Account");

export default function AccountPage() {
  return <AccountSettings />;
}
