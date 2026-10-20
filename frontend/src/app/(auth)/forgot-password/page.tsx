import { privateMetadata } from "@/lib/seo";

import { ForgotPassword } from "@/components/AccountRecovery";

export const metadata = privateMetadata("Forgot password");

export default function ForgotPasswordPage() {
  return <ForgotPassword />;
}
