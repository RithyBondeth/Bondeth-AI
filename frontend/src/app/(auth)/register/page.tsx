import { privateMetadata } from "@/lib/seo";

import { AuthForm } from "@/components/AuthForm";

export const metadata = privateMetadata("Create account");

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
