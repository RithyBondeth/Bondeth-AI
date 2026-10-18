"""Outgoing email: verification and password-reset links.

BONDETH_EMAIL_BACKEND=log (default) writes each email to the server log, which is
all local development needs. In production use smtp: any provider with an SMTP
relay works (Resend, Amazon SES, Mailgun, Gmail...).
"""

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Literal, Protocol

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)
EmailLocale = Literal["en", "km"]


def email_locale(accept_language: str | None) -> EmailLocale:
    """Choose a supported request language; legacy/API callers default to English."""
    preferred: EmailLocale = "en"
    best_quality = 0.0
    for entry in (accept_language or "").lower().split(","):
        tag, *parameters = entry.strip().split(";")
        language = tag.strip().split("-", 1)[0]
        if language not in ("en", "km"):
            continue
        quality = 1.0
        try:
            for parameter in parameters:
                name, _, value = parameter.partition("=")
                if name.strip() == "q":
                    quality = float(value.strip())
        except ValueError:
            continue
        if 0 < quality <= 1 and quality > best_quality:
            preferred, best_quality = language, quality
    return preferred


@dataclass
class Email:
    to: str
    subject: str
    body: str  # plain text
    locale: EmailLocale = "en"


class EmailSender(Protocol):
    def send(self, email: Email) -> None: ...


class LogEmailSender:
    def send(self, email: Email) -> None:
        logger.info("Email to %s: %s\n%s", email.to, email.subject, email.body)


class SmtpEmailSender:
    def __init__(self, settings: Settings):
        self._s = settings

    def send(self, email: Email) -> None:
        s = self._s
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = s.email_from, email.to, email.subject
        msg.set_content(email.body)
        # set_content clears existing Content-* headers, so declare language afterwards.
        msg["Content-Language"] = email.locale
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
            if s.smtp_starttls:
                smtp.starttls()
            if s.smtp_username:
                smtp.login(s.smtp_username, s.smtp_password)
            smtp.send_message(msg)


def get_email_sender() -> EmailSender:
    settings = get_settings()
    return SmtpEmailSender(settings) if settings.email_backend == "smtp" else LogEmailSender()


def verification_email(to: str, link: str, hours: int, locale: EmailLocale = "en") -> Email:
    if locale == "km":
        return Email(to, "បញ្ជាក់អ៊ីមែលរបស់អ្នកសម្រាប់ Bondeth AI", (
            "សួស្តី! សូមស្វាគមន៍មកកាន់ Bondeth AI។\n\n"
            "បញ្ជាក់អាសយដ្ឋានអ៊ីមែលរបស់អ្នក ដើម្បីទទួលបានកម្រិតប្រើប្រាស់ប្រចាំថ្ងៃពេញលេញ និងការចម្លងសំឡេង៖\n\n"
            f"{link}\n\n"
            f"តំណនេះមានសុពលភាពរយៈពេល {hours} ម៉ោង។ "
            "ប្រសិនបើអ្នកមិនបានបង្កើតគណនីទេ អ្នកអាចមិនអើពើនឹងអ៊ីមែលនេះបាន។"), locale="km")
    unit = "hour" if hours == 1 else "hours"
    return Email(to, "Confirm your email for Bondeth AI", (
        "Hello! Welcome to Bondeth AI.\n\n"
        f"Confirm your email address to unlock your full daily allowance and voice cloning:\n\n{link}\n\n"
        f"The link works for {hours} {unit}. If you didn't create an account, you can ignore this email."))


def password_reset_email(to: str, link: str, minutes: int, locale: EmailLocale = "en") -> Email:
    if locale == "km":
        return Email(to, "កំណត់ពាក្យសម្ងាត់ Bondeth AI របស់អ្នកឡើងវិញ", (
            "យើងបានទទួលសំណើកំណត់ពាក្យសម្ងាត់សម្រាប់គណនី Bondeth AI របស់អ្នកឡើងវិញ។\n\n"
            f"ជ្រើសរើសពាក្យសម្ងាត់ថ្មីនៅទីនេះ៖\n\n{link}\n\n"
            f"តំណនេះអាចប្រើបានតែម្ដង ក្នុងរយៈពេល {minutes} នាទី។ "
            "ការកំណត់ពាក្យសម្ងាត់ឡើងវិញនឹងនាំឱ្យអ្នកចេញពីគណនីលើគ្រប់ឧបករណ៍។\n"
            "ប្រសិនបើអ្នកមិនបានស្នើសុំទេ សូមមិនអើពើនឹងអ៊ីមែលនេះ៖ ពាក្យសម្ងាត់របស់អ្នកនឹងនៅដដែល។"), locale="km")
    unit = "minute" if minutes == 1 else "minutes"
    return Email(to, "Reset your Bondeth AI password", (
        "Someone (hopefully you) asked to reset the password for your Bondeth AI account.\n\n"
        f"Choose a new password here:\n\n{link}\n\n"
        f"The link works once, for {minutes} {unit}. Resetting signs you out everywhere.\n"
        "If you didn't ask for this, ignore this email: your password stays the same."))
