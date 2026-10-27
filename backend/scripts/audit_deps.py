"""Fail on known-vulnerable Python dependencies, except documented exceptions.

From backend/: .venv/bin/python -m scripts.audit_deps
Audits the installed environment with pip-audit, the same way CI does.

Every exception names the package and why its advisories cannot reach this app.
Remove an entry as soon as the fixed version can be installed.
"""

import json
import subprocess
import sys

ACCEPTED = {
    # gradio (via omnivoice) requires pillow<13, and every fix is in 13.0. Pillow is only
    # loaded by omnivoice's demo CLI; the API never opens images, so image-parsing
    # advisories have no input to act on. Forcing pillow 13 downgrades gradio to 3.x.
    "pillow": "image parsing only; never used by the API (gradio pins pillow<13)",
}


def main() -> int:
    run = subprocess.run(
        [sys.executable, "-m", "pip_audit", "--format", "json", "--progress-spinner", "off", "--skip-editable"],
        capture_output=True, text=True,
    )
    if not run.stdout.strip():
        print(run.stderr, file=sys.stderr)
        return 2
    report = json.loads(run.stdout)
    failures, accepted = [], []
    for dep in report["dependencies"]:
        for vuln in dep.get("vulns", []):
            entry = f"{dep['name']} {dep['version']}: {vuln['id']} (fixed in {', '.join(vuln['fix_versions']) or 'no release'})"
            (accepted if dep["name"].lower() in ACCEPTED else failures).append(entry)
    for name, reason in ACCEPTED.items():
        count = sum(e.startswith(f"{name} ") for e in accepted)
        if count:
            print(f"Accepted {count} advisories in {name}: {reason}")
    if failures:
        print("Vulnerable dependencies:", *sorted(set(failures)), sep="\n  ")
        return 1
    print("No unaccepted vulnerabilities.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
