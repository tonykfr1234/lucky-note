"""Use installed emulator/images, optionally install an official image under preaccepted runner terms.

Never send yes, invoke --licenses, or accept a new SDK agreement.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid


def main():
    root = Path(__file__).resolve().parents[2]
    output = root / "artifacts/android"
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "emulator-smoke.json"
    def report(status, reason, **extra):
        value = {"status": status, "reason": reason, "physicalDeviceTested": False, **extra}
        report_path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(value))
    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT", "/nonexistent"))
    emulator = sdk / "emulator/emulator"
    adb = sdk / "platform-tools/adb"
    managers = list((sdk / "cmdline-tools").glob("*/bin/avdmanager"))
    images = [path for path in (sdk / "system-images").glob("android-*/*/x86_64")
              if (path / "package.xml").is_file() and int(path.parent.parent.name.split("-")[-1]) >= 26]
    if (not emulator.is_file() or not images) and os.environ.get("LUCKYNOTE_TRY_PRELICENSED_IMAGE") == "true":
        installers = list((sdk / "cmdline-tools").glob("*/bin/sdkmanager"))
        if installers:
            # stdin EOF cannot accept an interactive agreement. Only the disposable CI runner's
            # existing license grants may authorize this official API 35 image installation.
            install_log = output / "emulator-image-install.txt"
            try:
                installed = subprocess.run([str(installers[-1]), "--install", "emulator", "system-images;android-35;google_apis;x86_64"],
                                           input="", text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=240)
                install_log.write_text(installed.stdout[-50000:], encoding="utf-8")
            except subprocess.TimeoutExpired:
                install_log.write_text("Official package installation timed out; no agreement was accepted.\n", encoding="utf-8")
            images = [path for path in (sdk / "system-images").glob("android-35/google_apis/x86_64") if (path / "package.xml").is_file()]
    if not emulator.is_file() or not managers or not images:
        report("not-run", "No complete emulator/system-image set. Official image installation was unavailable or needs terms/network access; no new agreement was accepted.")
        return
    if not os.access("/dev/kvm", os.R_OK | os.W_OK):
        report("not-run", "Preinstalled emulator has no usable KVM access; this workflow does not alter runner device permissions.")
        return
    image = sorted(images, key=lambda item: item.as_posix())[-1]
    package = ";".join(image.relative_to(sdk).parts)
    name = "luckynote-ci-" + uuid.uuid4().hex[:8]
    serial = "emulator-5556"
    environment = os.environ.copy()
    environment["ANDROID_AVD_HOME"] = str(output / "temporary-avd")
    Path(environment["ANDROID_AVD_HOME"]).mkdir(exist_ok=True)
    def run(args, timeout=60, **kwargs):
        return subprocess.run([str(arg) for arg in args], env=environment, timeout=timeout, check=True,
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs).stdout
    process = None
    try:
        run([managers[-1], "create", "avd", "--name", name, "--package", package], input="no\n")
        with (output / "emulator-console.txt").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(emulator), "-avd", name, "-port", "5556", "-no-window", "-no-audio",
                                        "-no-boot-anim", "-no-snapshot", "-gpu", "swiftshader_indirect"], env=environment,
                                       stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("emulator_exited_before_boot")
                try:
                    if run([adb, "-s", serial, "shell", "getprop", "sys.boot_completed"], timeout=10).strip() == "1": break
                except (subprocess.SubprocessError, OSError): pass
                time.sleep(3)
            else: raise RuntimeError("emulator_boot_timeout")
            apk = next(output.glob("LuckyNote-*-debug.apk"))
            run([adb, "-s", serial, "install", "-r", apk])
            run([adb, "-s", serial, "shell", "input", "keyevent", "82"])
            launch = run([adb, "-s", serial, "shell", "am", "start", "-W", "-n", "tw.tony.luckynote.debug/tw.tony.luckynote.MainActivity"])
            (output / "emulator-launch.txt").write_text(launch, encoding="utf-8")
            if "Status: ok" not in launch: raise RuntimeError("activity_launch_failed")
            time.sleep(5)
            pid = run([adb, "-s", serial, "shell", "pidof", "tw.tony.luckynote.debug"]).strip()
            if not re.fullmatch(r"\d+", pid): raise RuntimeError("app_process_not_running")
            run([adb, "-s", serial, "forward", "tcp:9223", "localabstract:webview_devtools_remote_" + pid])
            web_check = run(["node", root / "android/tools/webview-smoke.mjs"], timeout=90)
            (output / "emulator-webview.txt").write_text(web_check, encoding="utf-8")
            screenshot = subprocess.run([str(adb), "-s", serial, "exec-out", "screencap", "-p"], check=True, stdout=subprocess.PIPE).stdout
            (output / "android-emulator.png").write_bytes(screenshot)
            report("passed", "Installed debug APK, launched its activity, and verified bundled local page/IndexedDB with WebView DevTools.", systemImage=package, device="generic Android emulator, not Galaxy S26")
    except Exception as error:
        report("failed", str(error)[:500], systemImage=package)
        raise
    finally:
        if process is not None:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired: process.kill()
        # Do not publish a generated AVD or its user data as an artifact.
        import shutil
        temporary = Path(environment["ANDROID_AVD_HOME"]).resolve()
        if temporary.parent == output.resolve() and temporary.name == "temporary-avd": shutil.rmtree(temporary)


if __name__ == "__main__":
    main()
