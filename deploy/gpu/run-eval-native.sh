#!/usr/bin/env bash
# GPU evaluation without Docker, for container platforms such as RunPod where Docker isn't available.
# Needs Python 3.11 (3.10+ works) and an NVIDIA driver. Usage:  deploy/gpu/run-eval-native.sh [options]
set -euo pipefail
cd "$(dirname "$0")/../../backend"

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || { echo "No NVIDIA GPU visible." >&2; exit 1; }
command -v uv >/dev/null || python3 -m pip install --user -q uv
export PATH="$HOME/.local/bin:$PATH"

venv=.venv-gpu
[ -d $venv ] || uv venv --python 3.11 $venv
# CUDA PyTorch first (its cuBLAS/cuDNN also serve CTranslate2), then everything else.
uv pip install --python $venv -q --index-url https://download.pytorch.org/whl/cu126 torch==2.14.1 torchaudio==2.11.0
uv pip install --python $venv -q -r requirements-dev.txt -r requirements-voxcpm.txt

site=$($venv/bin/python -c "import sysconfig; print(sysconfig.get_paths()['purelib'])")
export LD_LIBRARY_PATH="$site/nvidia/cublas/lib:$site/nvidia/cudnn/lib:${LD_LIBRARY_PATH:-}"
export BONDETH_STT_DEVICE=cuda BONDETH_STT_COMPUTE_TYPE=float16 BONDETH_STT_KM_COMPUTE_TYPE=int8_float16 \
       BONDETH_CLONE_DEVICE=cuda BONDETH_VOXCPM_DEVICE=cuda

$venv/bin/python -m scripts.eval_gpu --out ../eval-results "$@"
echo "Done: eval-results/report.md"
