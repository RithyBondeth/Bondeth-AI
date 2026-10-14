/** Shapes returned by the Bondeth AI API (see backend/app/api/v1). */

export type Lang = "auto" | "km" | "en";

export type SttResult = {
  detected_language: string;
  language_probability: number;
  duration: number;
  text: string;
  segmented_text: string;
  segments: { start: number; end: number; text: string }[];
  transcription_id: string | null;
};

export type Transcription = {
  id: string;
  language_code: string;
  transcribed_text: string;
  audio_duration_seconds: number | null;
  created_at: string;
};

export type TtsPreview = { primary_lang: string; chunks: { lang: string; text: string }[] };

export type Voice = {
  id: string;
  voice_alias: string;
  reference_text: string;
  reference_duration_seconds: number;
  consent_confirmed_at: string;
  created_at: string;
};

export type CloneJob = {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  queue_position: number | null;
  error: string | null;
  voice_id: string | null;
  reference_text: string | null;
  reference_text_source: "provided" | "transcribed" | "saved_voice";
  duration: number | null;
  status_url: string;
  audio_url: string | null;
};

export type QuotaName = "stt_seconds" | "tts_chars" | "clone_jobs";

export type Usage = {
  signed_in: boolean;
  resets_at: string;
  // limit and remaining are null when the server has limits switched off; clone_jobs only when signed in.
  quotas: Partial<Record<QuotaName, { used: number; limit: number | null; remaining: number | null }>>;
};

export type ApiKey = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null };
export type ApiKeyCreated = ApiKey & { key: string };
export type ApiKeyUsageDay = { day: string; requests: number; stt_seconds: number; tts_chars: number; clone_jobs: number };
