"use client";

import Link from "next/link";
import { useT } from "@/lib/useLocale";

// Effective date of the current wording; update it whenever either page changes.
const EFFECTIVE = "27 October 2026";
const ISSUES = "https://github.com/RithyBondeth/Bondeth-AI/issues";
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

type Section = { title: string; km: string; body: React.ReactNode };

const linkClass = "font-medium text-accent hover:underline";

function Contact() {
  const t = useT();
  return CONTACT_EMAIL
    ? <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>{CONTACT_EMAIL}</a>
    : <a href={ISSUES} target="_blank" rel="noreferrer" className={linkClass}>{t("GitHub issues")}</a>;
}

function LegalPage({ title, km, intro, sections }: { title: string; km: string; intro: string; sections: Section[] }) {
  const t = useT();
  return (
    <article className="mx-auto max-w-3xl py-14">
      <p className="khmer text-sm font-medium text-accent">{km}</p>
      <h1 className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">{t(title)}</h1>
      <p className="mt-4 text-lg text-ink-soft">{t(intro)}</p>
      <p className="mt-2 text-sm text-ink-faint">{t("Effective {date}", { date: EFFECTIVE })}</p>
      <div className="mt-12 space-y-5">
        {sections.map((s, k) => (
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

export function PrivacyPolicy() {
  const t = useT();
  const sections: Section[] = [
    {
      title: "What we store for your account",
      km: "ទិន្នន័យគណនីដែលយើងរក្សាទុក",
      body: (
        <>
          <p>{t("Your email address, the name you give us (optional), a one-way hash of your password, and when you confirmed your email. If you subscribe to a paid plan, we also keep your Stripe customer and subscription IDs and the subscription status; card details stay with Stripe and never reach us.")}</p>
          <p>{t("Developer API keys are stored only as a hash, with the number of requests and the amount of work each key used per day.")}</p>
        </>
      ),
    },
    {
      title: "Your recordings, text and voices",
      km: "ការថតសំឡេង អត្ថបទ និងសំឡេងរបស់អ្នក",
      body: (
        <>
          <p>{t("Uploaded and recorded audio is processed on our own servers by open-source models. It is not sent to any third-party AI service.")}</p>
          <p>{t("When you are signed in, we keep your transcripts (text, timings and your edits), the speech and cloned clips you generate, and the voices you save with the time you confirmed consent. The original recording of a transcript is kept only if you choose to save it. All of this is private to your account and stays until you delete it or your account.")}</p>
          <p>{t("Everything else is temporary: uploads are deleted once processed, one-off cloning samples are deleted after the clip is made, queued job results expire after about an hour, and repeated text-to-speech phrases are cached as audio for up to seven days.")}</p>
        </>
      ),
    },
    {
      title: "Usage limits and security records",
      km: "កំណត់ការប្រើប្រាស់ និងកំណត់ត្រាសុវត្ថិភាព",
      body: (
        <p>{t("To enforce rate limits and daily allowances we count requests per account, or per IP address when you are signed out. Failed sign-ins are counted per email and IP address for 15 minutes to stop password guessing. These counters expire on their own. Our servers also keep ordinary technical logs.")}</p>
      ),
    },
    {
      title: "Your browser",
      km: "កម្មវិធីរុករករបស់អ្នក",
      body: (
        <p>{t("We don't use advertising or analytics cookies. Your browser keeps your sign-in session, interface language and theme in local storage so they survive a reload.")}</p>
      ),
    },
    {
      title: "Who else handles your data",
      km: "អ្នកផ្សេងទៀតដែលដំណើរការទិន្នន័យរបស់អ្នក",
      body: (
        <p>{t("Only the services needed to run the site: our email provider, to send verification and password-reset messages, and Stripe, if you subscribe. We don't sell your data or share it for advertising.")}</p>
      ),
    },
    {
      title: "Your choices",
      km: "ជម្រើសរបស់អ្នក",
      body: (
        <>
          <p>{t("You can edit or delete any transcript, clip or saved voice, download your transcripts and audio, and permanently delete your account from ")}<Link href="/account" className={linkClass}>{t("Account")}</Link>{t(". Deleting your account removes your history, saved voices, generated audio, API keys and their usage records.")}</p>
          <p>{t("For any other privacy request or question, contact us at ")}<Contact />.</p>
        </>
      ),
    },
    {
      title: "Changes",
      km: "ការផ្លាស់ប្ដូរ",
      body: <p>{t("If we change this policy, we will update this page and its effective date. Significant changes will be announced on the site before they apply.")}</p>,
    },
  ];
  return <LegalPage title="Privacy policy" km="គោលការណ៍ឯកជនភាព" sections={sections}
    intro="What Bondeth AI stores about you, why, for how long, and how to remove it." />;
}

export function TermsOfUse() {
  const t = useT();
  const sections: Section[] = [
    {
      title: "Using Bondeth AI",
      km: "ការប្រើប្រាស់ Bondeth AI",
      body: (
        <>
          <p>{t("By creating an account or using the studio or API, you agree to these terms and the ")}<Link href="/privacy" className={linkClass}>{t("Privacy policy")}</Link>{t(". If you don't agree, please don't use the service.")}</p>
          <p>{t("You are responsible for your account, for keeping your password and API keys secret, and for everything done with them.")}</p>
        </>
      ),
    },
    {
      title: "Voices and consent",
      km: "សំឡេង និងការយល់ព្រម",
      body: (
        <p>{t("You may only clone your own voice or the voice of someone who has given you explicit permission, as described in the ")}<Link href="/voice-consent" className={linkClass}>{t("Voice consent policy")}</Link>{t(". Confirming consent you don't have is a breach of these terms.")}</p>
      ),
    },
    {
      title: "What you must not do",
      km: "អ្វីដែលអ្នកមិនត្រូវធ្វើ",
      body: (
        <ul className="list-disc space-y-1.5 pl-5">
          <li>{t("Impersonate anyone, or create audio meant to deceive, defraud, harass, threaten or defame someone.")}</li>
          <li>{t("Upload audio or text you have no right to use, or that is illegal where you or we are.")}</li>
          <li>{t("Get around rate limits or allowances, for example with multiple accounts, or disrupt or probe the service.")}</li>
          <li>{t("Present generated speech as a real recording of a person who never said it.")}</li>
        </ul>
      ),
    },
    {
      title: "Your content",
      km: "ខ្លឹមសាររបស់អ្នក",
      body: (
        <p>{t("You keep the rights to what you upload and generate. You give us permission to store and process it only to provide the service to you.")}</p>
      ),
    },
    {
      title: "Speech model licenses",
      km: "អាជ្ញាប័ណ្ណម៉ូដែលសំឡេង",
      body: (
        <p>{t("Bondeth AI's code is MIT-licensed, but some speech models it can use are licensed for non-commercial use only. Unless this site says it uses commercially licensed engines, use generated speech and cloned audio for non-commercial purposes.")}</p>
      ),
    },
    {
      title: "No guarantees",
      km: "គ្មានការធានា",
      body: (
        <>
          <p>{t("Transcripts and generated speech can contain mistakes. Check anything important before you rely on it. The service is provided “as is”, without warranties, and may change, pause or have downtime.")}</p>
          <p>{t("To the extent the law allows, we are not liable for indirect losses or for losses caused by mistakes in transcripts or generated audio.")}</p>
        </>
      ),
    },
    {
      title: "Suspension and changes",
      km: "ការផ្អាក និងការផ្លាស់ប្ដូរ",
      body: (
        <p>{t("We may suspend or close accounts that break these terms, and remove content that does. We may update these terms; the effective date above shows the current version, and continuing to use the service means you accept it. Questions: ")}<Contact />.</p>
      ),
    },
  ];
  return <LegalPage title="Terms of use" km="លក្ខខណ្ឌប្រើប្រាស់" sections={sections}
    intro="The rules for using the Bondeth AI studio and API." />;
}
