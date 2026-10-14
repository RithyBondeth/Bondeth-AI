import { StudioShell } from "@/components/shell/StudioShell";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <StudioShell>{children}</StudioShell>;
}
