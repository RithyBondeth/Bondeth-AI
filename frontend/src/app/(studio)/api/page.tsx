import type { Metadata } from "next";
import { ApiDocs } from "@/components/studios/ApiDocs";

export const metadata: Metadata = { title: "API docs", description: "Integrate Khmer and English speech, transcription, and voice cloning with the Bondeth AI API." };

export default function ApiPage() {
  return <ApiDocs />;
}
