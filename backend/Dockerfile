# syntax=docker/dockerfile:1.7
#
# Bondeth AI backend. CPU by default; build the GPU variant with
#   --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu126
# (docker-compose.gpu.yml does this for you).

FROM python:3.11-slim AS base

ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

RUN pip install --no-cache-dir uv==0.12.22 && uv venv $VIRTUAL_ENV

WORKDIR /app

# PyTorch comes from its own index (CPU or CUDA build); everything else from PyPI.
# torch/torchaudio are installed first so the requirements pin is already satisfied.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --index-url "$TORCH_INDEX_URL" torch==2.14.1 torchaudio==2.11.0 \
 && uv pip install -r requirements.txt

# CTranslate2 (faster-whisper) finds cuBLAS/cuDNN from the CUDA torch wheels here.
# These paths simply don't exist in the CPU image, which is harmless.
ENV LD_LIBRARY_PATH=/opt/venv/lib/python3.11/site-packages/nvidia/cublas/lib:/opt/venv/lib/python3.11/site-packages/nvidia/cudnn/lib

COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app

# Models (~6 GB) and user data live on volumes, never in the image.
RUN useradd --create-home --uid 1000 bondeth \
 && mkdir -p /app/models /app/data /app/tmp \
 && chown -R bondeth:bondeth /app
USER bondeth

ENV BONDETH_MODEL_DIR=/app/models \
    BONDETH_DATA_DIR=/app/data \
    BONDETH_TMP_DIR=/app/tmp \
    HF_HOME=/app/models/hf

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/v1/health', timeout=4).status == 200 else 1)"

# One worker: models are loaded per process and the clone worker assumes a single consumer.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
