"use client";

import { useT } from "@/lib/useLocale";

import Link from "next/link";
import { TwinVoicesDoodle } from "@/components/doodles";

export function VoiceConsent() {
  const t = useT();
  const SECTIONS: { title: string; km: string; body: React.ReactNode }[] = [
    {
      title: "Only clone a voice you have the right to use",
      km: "ចម្លងតែសំឡេងដែលអ្នកមានសិទ្ធិ",
      body: (
        <>
          <p>{t("You may clone your own voice, or the voice of someone who has given you explicit permission to clone it. “Explicit” means they agreed to this use, not that they once shared a recording.")}</p>
          <p>{t("Do not clone a voice to impersonate someone, to deceive or defraud anyone, to put words in a real person’s mouth without their agreement, or to harass or harm anyone. This includes public figures.")}</p>
        </>
      ),
    },
    {
      title: "How consent is recorded",
      km: "របៀបកត់ត្រាការយល់ព្រម",
      body: (
        <>
          <p>{t("Before a sample can be used, you must confirm that the voice is yours or that you have the speaker’s permission. The studio and the API both refuse the request without that confirmation.")}</p>
          <p>{t("When you save a voice to your library, we store the time you confirmed consent alongside it.")}</p>
        </>
      ),
    },
    {
      title: "How samples are kept",
      km: "របៀបរក្សាទុកគំរូសំឡេង",
      body: (
        <>
          <p><strong>{t("Saved voices")}</strong> {t(" are private to your account. You can rename or delete them at any time from ")}<Link href="/voices" className="font-medium text-accent hover:underline">{t("Voices")}</Link>{t(", and deleting a voice removes its audio.")}</p>
          <p><strong>{t("One-off samples")}</strong> {t(" uploaded straight into Voice Clone are not saved: the sample is deleted once the clip has been generated.")}</p>
        </>
      ),
    },
    {
      title: "If your voice was cloned without permission",
      km: "ប្រសិនបើសំឡេងរបស់អ្នកត្រូវបានចម្លងដោយគ្មានការអនុញ្ញាត",
      body: (
        <p>{t("Tell us by opening an issue on")}{" "}
          <a href="https://github.com/RithyBondeth/Bondeth-AI/issues" target="_blank" rel="noreferrer"
            className="font-medium text-accent hover:underline">GitHub</a>{t(". If you run your own copy of Bondeth AI, you are responsible for how it is used on your server.")}</p>
      ),
    },
  ];

  return (
    <article className="mx-auto max-w-3xl py-14">
      <div className="flex flex-col items-start gap-8 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="khmer text-sm font-medium text-accent">គោលការណ៍យល់ព្រមលើសំឡេង</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">{t("Voice consent policy")}</h1>
          <p className="mt-4 text-lg text-ink-soft">
            {t("A voice belongs to the person who speaks with it. These are the rules for cloning one with Bondeth AI.")}</p>
        </div>
        <TwinVoicesDoodle className="w-56 shrink-0 text-ink" label={t("A speaker and her dashed-outline voice clone with a hand-drawn audio waveform")} />
      </div>

      <div className="mt-12 space-y-5">
        {SECTIONS.map((s, k) => (
          <section key={s.title} className="rounded-2xl border border-line bg-surface p-6 shadow-panel">
            <p className="khmer text-sm text-ink-faint">{k + 1} · {s.km}</p>
            <h2 className="text-xl font-bold">{t(s.title)}</h2>
            <div className="mt-3 space-y-3 text-ink-soft">{s.body}</div>
          </section>
        ))}
      </div>
    </article>
  );
}
