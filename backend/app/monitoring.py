"""Optional error tracking (Sentry). Off unless BONDETH_SENTRY_DSN is set.

Errors only: no performance tracing. Request bodies, cookies, headers with
credentials and user details are never sent, because they carry transcripts,
text to speak, voice samples and tokens.
"""

import logging

from app.config import Settings

logger = logging.getLogger(__name__)


def init_error_tracking(settings: Settings, component: str) -> bool:
    if not settings.sentry_dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment or settings.env,
        release=f"bondeth-ai@{settings.version}",
        server_name=component,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,  # stack frames can hold transcripts and text to speak
        traces_sample_rate=0.0,
    )
    logger.info("Error tracking enabled for %s", component)
    return True
