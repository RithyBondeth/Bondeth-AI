import { privateMetadata } from "@/lib/seo";

import { AuthForm } from "@/components/AuthForm";

export const metadata = privateMetadata("Sign in");

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
