"""Verify the APK that will be distributed; never read or publish signing private keys."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone


def main():
    root = Path(__file__).resolve().parents[2]
    source = root / "android/app/build/outputs/apk/debug/app-debug.apk"
    output = root / "artifacts/android"
    output.mkdir(parents=True, exist_ok=True)
    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ["ANDROID_SDK_ROOT"])
    build_tools = sdk / "build-tools/35.0.0"
    suffix = ".bat" if os.name == "nt" else ""
    aapt = build_tools / ("aapt.exe" if os.name == "nt" else "aapt")
    signer = build_tools / ("apksigner" + suffix)
    assert source.is_file(), "APK output missing"
    def run(*args):
        result = subprocess.run([str(arg) for arg in args], check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        return result.stdout
    badging = run(aapt, "dump", "badging", source)
    signature = run(signer, "verify", "--verbose", "--print-certs", source)
    permissions = run(aapt, "dump", "permissions", source)
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    assert package, "Package metadata missing"
    assert package[1] == "tw.tony.luckynote.debug", "Unexpected APK identity"
    minimum = re.search(r"^sdkVersion:'(\d+)'", badging, re.MULTILINE)
    target = re.search(r"^targetSdkVersion:'(\d+)'", badging, re.MULTILINE)
    assert minimum and int(minimum[1]) == 26, "Unexpected minimum Android version"
    assert target and int(target[1]) == 35, "Unexpected target Android version"
    assert "application-debuggable" in badging, "Expected clearly labeled debug build"
    assert "CN=Android Debug" in signature, "Expected Android development certificate"
    assert "android.permission.INTERNET" not in permissions, "Device-only APK must not gain network permission"
    for denied in ("READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "CAMERA"):
        assert "android.permission." + denied not in permissions, "Unexpected broad permission: " + denied
    certificate = re.search(r"Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)", signature)
    assert certificate, "Signer fingerprint missing"
    version = package[3]
    destination = output / ("LuckyNote-" + version + ".apk")
    shutil.copy2(source, destination)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    (output / "SHA256SUMS.txt").write_text(digest + "  " + destination.name + "\n", encoding="utf-8")
    (output / "apk-badging.txt").write_text(badging, encoding="utf-8")
    (output / "apk-signature.txt").write_text(signature, encoding="utf-8")
    (output / "apk-permissions.txt").write_text(permissions, encoding="utf-8")
    report = {
        "status": "passed", "checkedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCommit": os.environ.get("GITHUB_SHA", "local-unrecorded"),
        "package": package[1], "versionCode": package[2], "versionName": version,
        "kind": "debug", "productionSigned": False,
        "signerSha256": certificate[1].lower(), "sha256": digest, "bytes": destination.stat().st_size,
        "artifact": destination.name, "targetSdk": int(target[1]), "minSdk": int(minimum[1]),
        "nativeLaunch": "See emulator-smoke.json; package verification does not prove launch.",
        "updateCaution": "Ephemeral CI debug certificates are not a stable release signing identity. Export notes before uninstall/reinstall."
    }
    (output / "apk-verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
