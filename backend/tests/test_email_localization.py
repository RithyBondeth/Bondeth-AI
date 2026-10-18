import pytest

from app.config import get_settings
from tests.test_account import PASSWORD, bearer


@pytest.mark.parametrize("locale", ["en", "km"])
def test_signup_and_resend_capture_current_language(client, locale):
    response = client.post("/api/v1/auth/register", headers={"Accept-Language": locale},
                           json={"email": "new@example.com", "password": PASSWORD})
    assert response.status_code == 201
    first = client.outbox.sent[-1]
    assert first.locale == locale and str(get_settings().email_verify_token_hours) in first.body
    assert "បញ្ជាក់អ៊ីមែល" in first.subject if locale == "km" else "Confirm your email" in first.subject
    # A newly selected interface language wins over the language used at sign-up.
    next_locale = "en" if locale == "km" else "km"
    headers = {**bearer(response.json()), "Accept-Language": next_locale}
    assert client.post("/api/v1/auth/verify-email/resend", headers=headers).status_code == 202
    resent = client.outbox.sent[-1]
    assert resent.locale == next_locale and resent.subject != first.subject
    token = client.outbox.link_token("new@example.com", "/verify-email")
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).json()["email_verified"] is True
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 400


@pytest.mark.parametrize("locale", ["en", "km", "fr"])
def test_reset_language_and_account_privacy(client, register, locale):
    register()
    previous = len(client.outbox.sent)
    headers = {"Accept-Language": locale}
    known = client.post("/api/v1/auth/password-reset", headers=headers, json={"email": "USER@example.com"})
    unknown = client.post("/api/v1/auth/password-reset", headers=headers, json={"email": "unknown@example.com"})
    assert known.status_code == unknown.status_code == 202 and known.json() == unknown.json()
    assert len(client.outbox.sent) == previous + 1
    email = client.outbox.sent[-1]
    assert email.to == "user@example.com" and email.locale == ("km" if locale == "km" else "en")
    assert "ពាក្យសម្ងាត់" in email.subject if locale == "km" else "Reset your" in email.subject
    assert str(get_settings().password_reset_token_minutes) in email.body
    token = client.outbox.link_token("user@example.com", "/reset-password")
    result = client.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "new-password-here"})
    assert result.status_code == 200
    assert client.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "another-password"}).status_code == 400
