import { privateMetadata } from "@/lib/seo";

import { VerifyEmail } from "@/components/AccountRecovery";

export const metadata = privateMetadata("Confirm your email");

export default function VerifyEmailPage() {
  return <VerifyEmail />;
}
