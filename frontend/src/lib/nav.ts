import { AudioLines, CircleUserRound, FolderOpen, History, KeyRound, Library, Mic, Sparkles, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; km: string; icon: LucideIcon; description: string };

export const WORKSPACES: NavItem[] = [
  { href: "/stt", label: "Speech to Text", km: "សំឡេង → អក្សរ", icon: Mic,
    description: "Record or upload Khmer or English audio and get an editable transcript." },
  { href: "/tts", label: "Text to Speech", km: "អក្សរ → សំឡេង", icon: AudioLines,
    description: "Type Khmer, English or both. Numbers, prices and dates are read in full." },
  { href: "/clone", label: "Voice Clone", km: "ចម្លងសំឡេង", icon: Sparkles,
    description: "Make a saved voice say anything in Khmer or English." },
];

export const LIBRARY: NavItem[] = [
  { href: "/audio", label: "Audio library", km: "បណ្ណាល័យសំឡេង", icon: FolderOpen,
    description: "Your saved speech and voice-clone audio." },
  { href: "/history", label: "History", km: "ប្រវត្តិ", icon: History,
    description: "Every transcript you've saved." },
  { href: "/voices", label: "Voices", km: "សំឡេងរបស់អ្នក", icon: Library,
    description: "Voice samples you can clone from." },
  { href: "/api-keys", label: "API keys", km: "កូនសោ API", icon: KeyRound,
    description: "Keys for calling Bondeth AI from your own apps." },
];

// Reached from the signed-in user in the sidebar footer, not listed in the nav.
export const ACCOUNT: NavItem = { href: "/account", label: "Account", km: "គណនី", icon: CircleUserRound,
  description: "Profile, email confirmation, password and account deletion." };

export function findNav(pathname: string): NavItem | undefined {
  return [...WORKSPACES, ...LIBRARY, ACCOUNT].find((item) => pathname.startsWith(item.href));
}
