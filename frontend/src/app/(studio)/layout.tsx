import { StudioShell } from "@/components/shell/StudioShell";
import { Suspense } from "react";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-dvh animate-pulse bg-paper" />}><StudioShell>{children}</StudioShell></Suspense>;
}
