#!/usr/bin/env bash
# GPU evaluation inside the GPU Docker image (a VM with Docker + the NVIDIA Container Toolkit).
# Usage, from anywhere in the repo:   deploy/gpu/run-eval.sh [eval_gpu.py options, e.g. --clips 30]
# Results land in ./eval-results (report.md, report.json, audio samples).
set -euo pipefail
cd "$(dirname "$0")/../.."

compose=(docker compose -f docker-compose.yml -f docker-compose.gpu.yml)
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || { echo "No NVIDIA GPU visible." >&2; exit 1; }

"${compose[@]}" build backend
mkdir -p eval-results

# --no-deps: the evaluation needs no database. Scripts and their two extra packages aren't in the
# image, so they're mounted and installed for this run only. Models download into backend/models.
"${compose[@]}" run --rm --no-deps --user root \
  -e BONDETH_ENV=development \
  -v "$PWD/backend/scripts:/app/scripts:ro" \
  -v "$PWD/eval-results:/eval" \
  backend sh -c 'uv pip install -q jiwer==4.0.0 pyarrow==26.0.0 && python -m scripts.eval_gpu --out /eval "$@"' -- "$@"

echo "Done: eval-results/report.md"
