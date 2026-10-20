import { publicMetadata } from "@/lib/seo";
import { SeoJsonLd } from "@/components/SeoJsonLd";
import { VoiceConsent } from "@/components/VoiceConsent";

export const metadata = publicMetadata("/voice-consent");

export default function VoiceConsentPage() { return <><SeoJsonLd path="/voice-consent" /><VoiceConsent /></>; }
