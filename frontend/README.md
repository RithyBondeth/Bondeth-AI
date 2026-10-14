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
| `/` | Landing page with the animated doodle hero |
| `/stt` | Record or upload audio → transcript; history when signed in |
| `/tts` | Text → speech, with a live preview of what each voice will read |
| `/clone` | Saved voices + voice cloning jobs (sign-in required) |
| `/login`, `/register` | Accounts |

## Design system

- **Fonts:** Ubuntu for Latin text; Kantumruy Pro for Khmer (picked per character), with extra line height for stacked Khmer glyphs.
- **Theme:** colour tokens in `src/app/globals.css` under `[data-theme]`. An inline script in `<head>` applies the saved or system theme before the first paint (no flash).
- **Doodles:** `src/components/doodles` holds hand-drawn SVGs drawn in code. They use the theme's ink and accent colours and sketch themselves in on scroll.
- **Motion:** page transitions (`app/template.tsx`), springy buttons, tilt cards, animated audio bars. Everything respects the OS reduce-motion setting.
