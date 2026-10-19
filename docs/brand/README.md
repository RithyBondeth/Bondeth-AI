# Bubble B identity

The approved identity combines a speech-bubble B, saffron marker hatching,
three loose ink ticks, and the original Bondeth-AI lettering and underline.
Logo lockups use the Bubble B and Bondeth-AI wordmark only, without a Khmer subtitle.

## Assets

- `bubble-b-selected.png`: the user's approved concept sheet.
- `bubble-b-master.png`: transparent main lockup extracted with the built-in
  image-generation tool. Extraction prompt: preserve the exact central Bubble B,
  Bondeth-AI lettering and underline; remove the paper, concept label and small
  previews; preserve cream counters and scribble gaps; transparent background.
- `../../frontend/public/brand/`: automatically traced SVG mark, wordmark and
  full lockup, each with light/dark exports, plus a 512px app icon.

Use the shared `Logo`, `LogoMark` and `LogoWordmark` components in the interface.
They use theme-specific assets without waiting for hydration and respect reduced
motion. The home link retains its localized accessible name. Do not retype the
wordmark, stretch the artwork, or substitute the previous waveform stamp.

The default assets use ink `#292720`, saffron `#ffb544`, cream `#fff7e3` and
paper `#faf9f6`. Dark assets retain saffron and use light ink `#f5efdf` with
dark counters `#1b1b18`. Browser and home-screen icons have a paper backing
so they remain readable against browser chrome of either theme.

## Regenerate

From the repository root, with frontend dependencies installed:

```sh
uv run --with pillow==13.0.0 --with vtracer==0.6.15 python frontend/scripts/generate-brand-assets.py
```

The script quantizes the master to the theme palette and automatically traces
the artwork; no logo paths are hand drawn. It exports the light/dark vectors,
multi-resolution favicon, SVG browser icon, Apple touch icon, and both 1200×630
sharing images. It uses the existing voice-studio doodle on sharing cards.
Generation dependencies are only needed to regenerate assets, not to run the app.
