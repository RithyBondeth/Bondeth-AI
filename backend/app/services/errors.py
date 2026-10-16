class EngineUnavailable(RuntimeError):
    """A selected optional audio engine is missing its runtime dependencies."""


class SpeechGenerationError(RuntimeError):
    """The speech engine returned no usable audio, rather than a valid WAV."""
