"""Localized transactional copy and UTF-8 SMTP delivery without sending messages."""

from email import policy
from email.parser import BytesParser
from unittest.mock import MagicMock

import pytest

from app.config import get_settings
from app.services.email import SmtpEmailSender, email_locale, password_reset_email, verification_email


@pytest.mark.parametrize(("header", "expected"), [
    (None, "en"), ("", "en"), ("en", "en"), ("km", "km"), ("KM-kh", "km"),
    ("en-US,en;q=0.9", "en"), ("fr,km-KH;q=0.8,en;q=0.5", "km"),
    ("km;q=0.2,en;q=0.9", "en"), ("km;q=0,en;q=0.2", "en"),
    ("km;q=oops,en", "en"), ("km;q=nan", "en"), ("km;q=2", "en"),
    ("km;q=-1", "en"), ("fr,*;q=0.5", "en"), ("km;q=0.7,en;q=0.7", "km"),
])
def test_email_language_negotiation(header, expected):
    assert email_locale(header) == expected


@pytest.mark.parametrize("locale", ["en", "km"])
@pytest.mark.parametrize("factory", [verification_email, password_reset_email])
@pytest.mark.parametrize("duration", [1, 17])
def test_localized_email_keeps_link_duration_and_recipient(locale, factory, duration):
    link = "https://voice.example.com/verify-email?token=one-time-token"
    email = factory("person@example.com", link, duration, locale)
    assert email.to == "person@example.com" and email.locale == locale
    assert email.body.count(link) == 1 and str(duration) in email.body
    if locale == "km":
        assert "បញ្ជាក់អ៊ីមែល" in email.subject if factory is verification_email else "ពាក្យសម្ងាត់" in email.subject
        assert "ម៉ោង" in email.body if factory is verification_email else "នាទី" in email.body
        assert "មិនអើពើនឹងអ៊ីមែលនេះ" in email.body
        if factory is password_reset_email:
            assert "តែម្ដង" in email.body and "គ្រប់ឧបករណ៍" in email.body and "នៅដដែល" in email.body
    else:
        assert "Confirm your email" in email.subject if factory is verification_email else "Reset your" in email.subject
        assert "ignore this email" in email.body
        if factory is password_reset_email:
            assert "once" in email.body and "signs you out everywhere" in email.body and "stays the same" in email.body


@pytest.mark.parametrize("factory", [verification_email, password_reset_email])
def test_legacy_email_calls_default_to_english(factory):
    email = factory("person@example.com", "https://voice.example.com/link", 1)
    assert email.locale == "en"
    assert "1 hours" not in email.body and "1 minutes" not in email.body
    assert not any("\u1780" <= char <= "\u17ff" for char in email.body)


@pytest.mark.parametrize("factory", [verification_email, password_reset_email])
@pytest.mark.parametrize("locale", ["en", "km"])
def test_smtp_serializes_localized_subject_body_and_language(monkeypatch, factory, locale):
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    monkeypatch.setattr("app.services.email.smtplib.SMTP", lambda *args, **kwargs: smtp)
    settings = get_settings().model_copy(update={"email_from": "Bondeth AI <hello@example.com>", "smtp_username": ""})
    email = factory("person@example.com", "https://voice.example.com/link?token=secret", 17, locale)
    SmtpEmailSender(settings).send(email)
    message = BytesParser(policy=policy.default).parsebytes(smtp.send_message.call_args.args[0].as_bytes())
    assert message["Content-Language"] == locale
    assert message["Subject"] == email.subject and message["To"] == email.to
    assert message.get_content_charset() == "utf-8"
    assert message.get_content().rstrip("\n") == email.body
