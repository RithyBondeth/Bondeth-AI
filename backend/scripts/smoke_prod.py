"""Check a deployed instance end to end, from outside, without an account.

From backend/: .venv/bin/python -m scripts.smoke_prod https://bondeth.example.org [--insecure]
Runs real models once: English and Khmer speech, then transcribes the English clip.
Uses a few seconds of the signed-out allowance for this machine's IP address.
"""

import argparse
import sys
from urllib.parse import urlsplit

import httpx

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str, detail: str = "") -> bool:
    results.append((ok, label))
    print(f"{'PASS' if ok else 'FAIL'}  {label}{f'  ({detail})' if detail and not ok else ''}")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("url", help="public address, e.g. https://bondeth.example.org")
    parser.add_argument("--insecure", action="store_true", help="skip TLS verification (local tests only)")
    args = parser.parse_args()
    base = args.url.rstrip("/")
    https = urlsplit(base).scheme == "https"

    with httpx.Client(base_url=base, verify=not args.insecure, timeout=300) as client:
        r = client.get("/api/v1/health")
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        check(r.status_code == 200 and body.get("status") == "ok", "API health", f"{r.status_code} {body or r.text[:120]}")
        check(body.get("env") == "production", "backend runs with BONDETH_ENV=production", str(body.get("env")))

        r = client.get("/")
        check(r.status_code == 200, "studio loads", str(r.status_code))
        csp = r.headers.get("content-security-policy", "")
        check("default-src 'self'" in csp and "frame-ancestors 'none'" in csp, "security headers on pages", csp[:120] or "missing")
        if https:
            check("max-age=" in r.headers.get("strict-transport-security", ""), "HSTS on https", "missing")
            plain = httpx.get("http://" + base.split("://", 1)[1] + "/", follow_redirects=False, timeout=30)
            check(plain.status_code in (301, 302, 307, 308) and plain.headers.get("location", "").startswith("https://"),
                  "http redirects to https", f"{plain.status_code} {plain.headers.get('location')}")
        else:
            check(False, "served over https", base)

        r = client.post("/api/v1/tts", json={"text": "Hello, this is a Bondeth AI deployment check.", "lang": "en"})
        english = r.content if r.status_code == 200 else b""
        check(r.headers.get("content-type", "").startswith("audio/wav") and len(english) > 10_000,
              "English text to speech", f"{r.status_code} {r.text[:200] if r.status_code != 200 else len(english)}")

        r = client.post("/api/v1/tts", json={"text": "សួស្តី! ខ្ញុំស្រលាញ់ភាសាខ្មែរ។", "lang": "km"})
        check(r.status_code == 200 and len(r.content) > 10_000, "Khmer text to speech",
              f"{r.status_code} {r.text[:200] if r.status_code != 200 else len(r.content)}")

        if english:
            r = client.post("/api/v1/stt", files={"file": ("check.wav", english, "audio/wav")}, data={"language": "en"})
            text = r.json().get("text", "") if r.status_code == 200 else ""
            check("deployment" in text.lower() or "bondeth" in text.lower(), "speech to text round trip",
                  f"{r.status_code} {text or r.text[:200]}")

    failed = [label for ok, label in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
