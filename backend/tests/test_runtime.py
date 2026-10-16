"""Runtime defaults must apply before model-library imports, while respecting overrides."""
import os
import subprocess
import sys


def test_macos_uses_sequential_loading_by_default():
    env = dict(os.environ)
    env.pop("HF_DEACTIVATE_ASYNC_LOAD", None)
    result = subprocess.run([sys.executable, "-c", "import app, os; print(os.getenv('HF_DEACTIVATE_ASYNC_LOAD', 'unset'))"],
                            env=env, capture_output=True, text=True, check=True)
    assert result.stdout.strip() == ("1" if sys.platform == "darwin" else "unset")


def test_explicit_loading_override_is_preserved():
    result = subprocess.run([sys.executable, "-c", "import app, os; print(os.environ['HF_DEACTIVATE_ASYNC_LOAD'])"],
                            env={**os.environ, "HF_DEACTIVATE_ASYNC_LOAD": "0"},
                            capture_output=True, text=True, check=True)
    assert result.stdout.strip() == "0"
