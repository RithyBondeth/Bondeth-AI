import type { Metadata } from "next";
import { VoiceConsent } from "@/components/VoiceConsent";

export const metadata: Metadata = {
  title: "Voice consent policy",
  description: "Who you may clone with Bondeth AI, how consent is recorded, and how voice samples are kept and deleted.",
};

export default function VoiceConsentPage() { return <VoiceConsent />; }
