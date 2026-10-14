import type { Metadata } from "next";

import { AccountSettings } from "@/components/studios/AccountSettings";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return <AccountSettings />;
}
