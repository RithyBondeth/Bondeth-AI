/** Shared copy keeps rendered browser titles aligned with server metadata. */
export const PUBLIC_PAGES = {
  "/": {
    title: "Khmer Speech to Text, Text to Speech & Voice Cloning",
    description: "Transcribe Khmer and English audio, turn text into speech, and clone voices with permission. Explore Bondeth AI’s open-source voice tools and developer API.",
  },
  "/stt": {
    title: "Khmer & English Speech to Text",
    description: "Record or upload Khmer and English audio and turn it into an editable transcript. Review timestamped segments and export text or subtitles with Bondeth AI.",
  },
  "/tts": {
    title: "Khmer & English Text to Speech",
    description: "Turn Khmer, English, or mixed-language text into speech online. Adjust the reading speed, preview your text, and download generated audio with Bondeth AI.",
  },
  "/clone": {
    title: "Khmer & English AI Voice Cloning",
    description: "Create Khmer and English speech from a voice sample you own or have permission to use. Save reference voices and generate audio with Bondeth AI voice cloning.",
  },
  "/api": {
    title: "Khmer Speech API Documentation",
    description: "Integrate Khmer and English transcription, text to speech, and voice cloning. Explore API authentication, Python, Next.js, Express, Laravel, and live requests.",
  },
  "/voice-consent": {
    title: "Voice consent policy",
    description: "Learn whose voice you may clone with Bondeth AI, how consent is recorded, and how reference voice samples are stored and deleted.",
  },
  "/privacy": {
    title: "Privacy policy",
    description: "What Bondeth AI stores about you, including recordings, transcripts and saved voices, why it is kept, for how long, and how to delete it.",
  },
  "/terms": {
    title: "Terms of use",
    description: "The rules for using the Bondeth AI studio and API, including voice consent, acceptable use, model licenses and account suspension.",
  },
} as const;

export type PublicPath = keyof typeof PUBLIC_PAGES;
