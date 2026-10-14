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
