import type { Metadata } from "next";
import { Suspense } from "react";

import { SavedTranscript } from "@/components/studios/SavedTranscript";

export const metadata: Metadata = { title: "Edit transcript" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SavedTranscript id={id} backLink />;
}

export default function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
    <Content params={params} />
  </Suspense>;
}
