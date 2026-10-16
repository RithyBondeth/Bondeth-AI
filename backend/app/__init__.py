"""Runtime defaults applied before any model libraries are imported."""
import os
import sys

# Transformers 5 loads tensors concurrently by default. On macOS, concurrent
# Safetensors 0.8 lazy initialization can deadlock while one loader holds the GIL.
# Sequential loading also avoids transient copies on unified-memory devices.
if sys.platform == "darwin":
    os.environ.setdefault("HF_DEACTIVATE_ASYNC_LOAD", "1")
