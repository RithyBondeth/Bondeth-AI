"""Outgoing email: verification and password-reset links.

BONDETH_EMAIL_BACKEND=log (default) writes each email to the server log, which is
all local development needs. In production use smtp: any provider with an SMTP
relay works (Resend, Amazon SES, Mailgun, Gmail...).
"""

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


@dataclass
class Email:
    to: str
    subject: str
    body: str  # plain text


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
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
            if s.smtp_starttls:
                smtp.starttls()
            if s.smtp_username:
                smtp.login(s.smtp_username, s.smtp_password)
            smtp.send_message(msg)


def get_email_sender() -> EmailSender:
    settings = get_settings()
    return SmtpEmailSender(settings) if settings.email_backend == "smtp" else LogEmailSender()


def verification_email(to: str, link: str, hours: int) -> Email:
    return Email(to, "Confirm your email for Bondeth AI", (
        "សួស្តី! Welcome to Bondeth AI.\n\n"
        f"Confirm your email address to unlock your full daily allowance and voice cloning:\n\n{link}\n\n"
        f"The link works for {hours} hours. If you didn't create an account, you can ignore this email."))


def password_reset_email(to: str, link: str, minutes: int) -> Email:
    return Email(to, "Reset your Bondeth AI password", (
        "Someone (hopefully you) asked to reset the password for your Bondeth AI account.\n\n"
        f"Choose a new password here:\n\n{link}\n\n"
        f"The link works once, for {minutes} minutes. Resetting signs you out everywhere.\n"
        "If you didn't ask for this, ignore this email: your password stays the same."))
