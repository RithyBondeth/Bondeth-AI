# Bondeth AI · Frontend

Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + Motion.

## Run it

```bash
docker compose up -d                      # from the repo root: Postgres + Redis
cd backend && .venv/bin/uvicorn app.main:app --port 8000
cd frontend && npm install && npm run dev  # http://localhost:3000
```

The API address comes from `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`; see `.env.example`).

## Pages

| Route | What it does |
| --- | --- |
| `/` | Landing page with doodle illustrations and an interactive studio preview |
| `/stt` | Record or upload audio → transcript; history when signed in |
| `/tts` | Text → speech, with a live preview of what each voice will read |
| `/clone` | Saved voices + voice cloning jobs (sign-in required) |
| `/login`, `/register` | Accounts |
| `/account` | Verification, subscription/Stripe portal, password reset, deletion |
| `/history` | Server-side transcript search, language filtering and pagination |
| `/history/[id]` | Transcript editing with autosave, conflict handling, and TXT/SRT/VTT export |
| `/audio` | Persistent generated speech and clones, with search, playback, download and deletion |
| `/voices`, `/api-keys` | Saved voice samples and developer access |
| `/forgot-password`, `/reset-password`, `/verify-email` | Email account recovery |
| `/voice-consent` | Voice ownership and consent information |

## Browser regression tests

Run `npm run build`, `npx playwright install chromium`, then `npm run test:e2e`.
The tests run the production frontend on port 3100 with controlled API fixtures,
on desktop and mobile Chromium. Use `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`
to run with an installed Chrome locally. See [operations](../docs/operations.md)
for backend and deployment verification and [billing](../docs/billing.md) for Stripe.

## Interface language

The header on public pages, account forms, and the studio includes a Khmer/English
switch. English is the default. The choice is stored in `localStorage` as
`bondeth.locale`, survives navigation and reloads, and syncs across tabs. If storage
is blocked, the choice still works for the current tab. It is a browser preference,
independent of the account and the speech input/output language.

`src/lib/messages-km.ts` contains Khmer translations keyed by English source copy;
`useT()` subscribes components to the preference. Use interpolation for variable
copy, and keep user text, voice names, API keys, code examples and subtitle content
out of translation calls. Dates follow the interface locale; subtitle timecodes
retain their standard format. The document language and page title update too.
Known API errors are translated; unrecognized model diagnostics remain verbatim.
API requests send the current preference in `Accept-Language`. Verification emails
(including resends) and password reset emails use that language for their subject
and body. The language is captured when the email is requested, including signed-out
recovery. Unsupported or missing languages fall back to English. API documentation
retains its existing language.

See `tests/e2e/localization.spec.ts` for persistence, cross-tab synchronization,
storage fallback, editing/export preservation and responsive Khmer coverage.

## Design system

- **Fonts:** Ubuntu for all Latin headings, body and interface text; Kantumruy Pro for Khmer (picked per character), with extra line height for stacked Khmer glyphs. Keep text upright and readable; the doodle treatment belongs to illustrations and surfaces.
- **Theme:** colour tokens in `src/app/globals.css` under `[data-theme]`. An inline script in `<head>` applies the saved or system theme before the first paint (no flash).
- **Paper and ink:** warm cream and charcoal surfaces, orange highlighter accents, outlined buttons with solid offset shadows, and softly irregular paper panels. Shared styles include `paper-panel`, `ink-button`, and `marker-label`. Bright accent fills and readable accent text use separate tokens.
- **Doodles:** responsive transparent artwork in `public/illustrations`, served with `next/image`, alongside native SVG waveforms, arrows, and speech bubbles in `src/components/doodles`. See [illustration prompts](../docs/illustrations.md). The logo and SVG favicon share an orange ink-stamp mark.
- **Motion:** page transitions (`app/template.tsx`), gentle illustration entrances, button press feedback, animated audio bars. The studio preview pauses its tour on hover. Everything respects the OS reduce-motion setting.
