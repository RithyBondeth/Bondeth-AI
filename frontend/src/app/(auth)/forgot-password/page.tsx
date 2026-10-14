import type { Metadata } from "next";

import { ForgotPassword } from "@/components/AccountRecovery";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return <ForgotPassword />;
}
