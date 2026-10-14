import type { Metadata } from "next";

import { ResetPassword } from "@/components/AccountRecovery";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return <ResetPassword />;
}
