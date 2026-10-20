import { privateMetadata } from "@/lib/seo";

import { ResetPassword } from "@/components/AccountRecovery";

export const metadata = privateMetadata("Reset password");

export default function ResetPasswordPage() {
  return <ResetPassword />;
}
