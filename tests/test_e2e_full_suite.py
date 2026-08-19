# pylint: disable=redefined-outer-name,too-many-statements,too-many-locals,duplicate-code
"""
End-to-End (E2E) Headless Browser Test Suite for VirtualNet.

Executes client-side JavaScript across concurrent Playwright Chromium browser contexts,
verifying multi-user Net session workflows, callsign assignment, PTT keying & VU meter,
transmission history logging, fold toggles, logsheet grid shortcuts, session refresh persistence,
and documentation guides with zero uncaught client JS errors.
"""

import json
import os
import socket
import threading
import time
from datetime import datetime
import pytest

from app import create_app, socketio

def get_today_instructor_pin() -> str:
    """Read today's valid instructor PIN from instructor_pins.json."""
    pins_file = os.path.join(os.path.dirname(__file__), "..", "app", "instructor_pins.json")
    if os.path.exists(pins_file):
        with open(pins_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get(str(datetime.utcnow().day), "139204")
    return "139204"

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = (
        os.environ.get("E2E_TESTING") == "1"
        or os.environ.get("PLAYWRIGHT_TEST") == "1"
    )
except (ImportError, OSError):
    HAS_PLAYWRIGHT = False

pytestmark = pytest.mark.skipif(not HAS_PLAYWRIGHT, reason="Playwright is not installed in this environment")

HOST = "127.0.0.1"


def find_free_port() -> int:
    """Find a free TCP port for running the local test server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def target_url():
    """Returns external target URL if E2E_BASE_URL env var is provided, else boots local server."""
    env_url = os.environ.get("E2E_BASE_URL")
    if env_url:
        yield env_url
        return

    port = find_free_port()
    app = create_app()
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "e2e-test-secret"

    server_thread = threading.Thread(
        target=lambda: socketio.run(app, host=HOST, port=port, use_reloader=False, log_output=False),
        daemon=True
    )
    server_thread.start()
    time.sleep(0.8)

    base_url = f"http://{HOST}:{port}"
    yield base_url


@pytest.fixture(scope="module")
def browser_instance():
    """Launches Playwright headless Chromium instance."""
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--unsafely-treat-insecure-origin-as-secure=http://web-app:5000"
            ]
        )
        yield browser
        browser.close()


def _is_ignorable_console_error(text: str) -> bool:
    """Helper to check if a console error message is a known harmless browser environment warning."""
    ignored = [
        "failed to load resource", "net::err", "socket.io", "favicon",
        "cdn", "404", "microphone", "webaudio", "getusermedia"
    ]
    return any(term in text for term in ignored)


def create_trapped_page(context):
    """Creates a new page with console error and pageerror traps attached."""
    page = context.new_page()
    js_errors = []

    def handle_page_error(error):
        print(f"[BROWSER PAGE ERROR] {error}")
        js_errors.append(f"Uncaught JS Error: {error}")

    def handle_console(msg):
        print(f"[BROWSER CONSOLE {msg.type.upper()}] {msg.text}")
        if msg.type == "error":
            text = msg.text.lower()
            if _is_ignorable_console_error(text):
                return
            js_errors.append(f"Console Error: {msg.text}")

    page.on("pageerror", handle_page_error)
    page.on("console", handle_console)
    return page, js_errors


def test_full_multi_user_net_workflow(browser_instance, target_url):
    """
    Test complete multi-user workflow:
    1. Instructor creates Net Session -> receives PIN.
    2. Student 1 joins Net Session -> locked awaiting callsign.
    3. Instructor sees admissions queue & waiting badge -> assigns callsign R11.
    4. Student 1 unlocks dashboard -> keys PTT -> transmits audio & updates VU meter.
    5. Instructor receives transmission & logs duration in history.
    6. Instructor terminates session -> all users wiped & redirected to landing page.
    """
    context_instructor = browser_instance.new_context(permissions=["microphone"])
    context_student = browser_instance.new_context(permissions=["microphone"])

    page_inst, errors_inst = create_trapped_page(context_instructor)
    page_stud, errors_stud = create_trapped_page(context_student)

    try:
        # Step 1: Instructor Creates Net Session
        print("[E2E LOG] Step 1: Navigating instructor to page...")
        page_inst.goto(target_url)
        page_inst.wait_for_selector("#landing-section:not(.d-none)")
        page_inst.click("#toggle-create-view")
        page_inst.wait_for_selector("#create-net-card:not(.d-none)")

        page_inst.fill("#create-name", "E2E Tactical Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")

        page_inst.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        pin_text = page_inst.inner_text("#header-net-pin")
        assert "PIN:" in pin_text
        pin_code = pin_text.replace("PIN:", "").strip()
        assert len(pin_code) == 4
        print(f"[E2E LOG] Step 1 Complete! PIN generated: {pin_code}")

        # Step 2: Student 1 Joins Net Session
        print("[E2E LOG] Step 2: Student joining net session...")
        page_stud.goto(target_url)
        page_stud.wait_for_selector("#landing-section:not(.d-none)")
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "ALPHA_1")
        page_stud.click("#btn-join-net")

        page_stud.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        page_stud.wait_for_selector("#callsign-lock-overlay:not(.d-none)")
        print("[E2E LOG] Step 2 Complete! Student locked awaiting callsign assignment.")

        # Step 3: Instructor Sees Admissions Queue & Assigns Callsign
        print("[E2E LOG] Step 3: Instructor assigning callsign R11...")
        page_inst.wait_for_selector("#admissions-tbody tr button.btn-do-assign", timeout=5000)
        badge_text = page_inst.inner_text("#sunray-queue-badge")
        assert "WAITING" in badge_text

        # Assign callsign R11
        page_inst.fill("#admissions-tbody tr input.input-assign-cs", "R11")
        page_inst.click("#admissions-tbody tr button.btn-do-assign")
        print("[E2E LOG] Step 3 Complete! Callsign assigned.")

        # Step 4: Student 1 Unlocks & Keys PTT
        print("[E2E LOG] Step 4: Student unlocking & keying PTT...")
        page_stud.wait_for_selector("#callsign-lock-overlay", state="hidden", timeout=10000)
        assert "R11" in page_stud.inner_text("#header-callsign")

        # Directly invoke startTransmission on Student VirtualNetApp instance
        page_stud.evaluate("""() => {
            const btn = document.getElementById('ptt-btn');
            if (btn) {
                btn.disabled = false;
                btn.removeAttribute('disabled');
            }
            if (window.virtualNetApp) window.virtualNetApp.startTransmission();
        }""")
        time.sleep(2.0)

        cls = page_stud.evaluate("() => document.getElementById('ptt-container').className")
        print(f"[E2E LOG] Step 4 Debug class: {cls}")

        # Assert Transmitting UI state on Student UI
        page_stud.wait_for_selector("#ptt-container.ptt-card-transmitting", timeout=5000)
        assert "TRANSMITTING" in page_stud.inner_text("#ptt-state-text")

        # Assert Receiving on Instructor UI
        page_inst.wait_for_selector("#ptt-container.ptt-card-receiving", timeout=5000)
        assert "RECEIVING: R11" in page_inst.inner_text("#ptt-state-text")

        # Release PTT
        page_stud.evaluate("() => window.virtualNetApp.stopTransmission()")
        time.sleep(0.5)

        page_stud.wait_for_selector("#ptt-container.ptt-card-idle", timeout=5000)
        print("[E2E LOG] Step 4 Complete! PTT transmission verified.")

        # Step 5: Verify Transmission Log Record
        page_inst.wait_for_selector("#sunray-tx-log-tbody tr", timeout=5000)
        log_html = page_inst.inner_html("#sunray-tx-log-tbody")
        assert "R11" in log_html

        # Step 6: Instructor Ends Session
        page_inst.click("#btn-end-session")
        page_inst.wait_for_selector("#tactical-dialog-overlay:not(.d-none)", timeout=3000)
        page_inst.click("#tactical-dialog-btn-confirm")

        # Verify both redirect to landing page
        page_inst.wait_for_selector("#landing-section:not(.d-none)", timeout=5000)
        page_stud.wait_for_selector("#landing-section:not(.d-none)", timeout=5000)

    finally:
        context_instructor.close()
        context_student.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"


def test_spacebar_page_scroll_prevention(browser_instance, target_url):
    """Regression Test 4: Verify pressing spacebar on active dashboard does NOT scroll page to bottom."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        page.goto(target_url)
        page.wait_for_selector("#landing-section:not(.d-none)")
        page.click("#toggle-create-view")
        page.wait_for_selector("#create-net-card:not(.d-none)")

        page.fill("#create-name", "Scroll Test Net")
        page.fill("#create-sunray-callsign", "0")
        page.fill("#create-instructor-pin", get_today_instructor_pin())
        page.click("#btn-create-net")

        page.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)

        initial_scroll = page.evaluate("() => window.scrollY")
        page.focus("body")
        page.keyboard.down("Space")
        time.sleep(0.5)
        page.keyboard.up("Space")

        final_scroll = page.evaluate("() => window.scrollY")
        assert final_scroll == initial_scroll == 0, f"Page scrolled from {initial_scroll} to {final_scroll}!"
    finally:
        context.close()
        assert not errors, f"Trapped JS errors: {errors}"


def test_fold_expand_ui_controls(browser_instance, target_url):
    """Regression Test 2: Test sidebar, SUNRAY card, PTT container, and header collapse toggles."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        page.goto(target_url)
        page.wait_for_selector("#landing-section:not(.d-none)")
        page.click("#toggle-create-view")
        page.wait_for_selector("#create-net-card:not(.d-none)")

        page.fill("#create-name", "UI Control Net")
        page.fill("#create-sunray-callsign", "0")
        page.fill("#create-instructor-pin", get_today_instructor_pin())
        page.click("#btn-create-net")

        page.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)

        # 1. Sidebar Fold Toggle
        page.click("#btn-toggle-roster")
        assert "collapsed" in page.get_attribute("#net-roster-sidebar", "class")
        page.click("#btn-toggle-roster")
        assert "collapsed" not in page.get_attribute("#net-roster-sidebar", "class")

        # 2. SUNRAY Panel Fold Toggle
        page.click("#btn-toggle-sunray-panel")
        assert "d-none" in page.get_attribute("#sunray-collapse-body", "class")
        page.click("#btn-toggle-sunray-panel")
        assert "d-none" not in page.get_attribute("#sunray-collapse-body", "class")

        # 3. PTT Container Minimise Toggle
        page.click("#btn-toggle-ptt-panel")
        assert "minimised" in page.get_attribute("#ptt-container", "class")
        page.click("#btn-toggle-ptt-panel")
        assert "minimised" not in page.get_attribute("#ptt-container", "class")

        # 4. Header Collapse Toggle
        page.click("#btn-toggle-header-details")
        assert "d-none" in page.get_attribute("#header-collapse-body", "class")
        page.click("#btn-expand-header-details")
        assert "d-none" not in page.get_attribute("#header-collapse-body", "class")

    finally:
        context.close()
        assert not errors, f"Trapped JS errors: {errors}"


def test_logsheet_grid_and_keyboard_shortcuts(browser_instance, target_url):
    """Test radio logsheet table entry addition, cell input, keyboard navigation, and export modal."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        page.goto(target_url)
        page.wait_for_selector("#landing-section:not(.d-none)")
        page.click("#toggle-create-view")
        page.wait_for_selector("#create-net-card:not(.d-none)")

        page.fill("#create-name", "Logsheet Net")
        page.fill("#create-sunray-callsign", "0")
        page.fill("#create-instructor-pin", get_today_instructor_pin())
        page.click("#btn-create-net")

        page.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)

        # Switch to LOGGING tab
        page.click("#tab-logging-link")
        page.wait_for_selector("#tab-logging.active", timeout=3000)

        # Add Entry
        page.click("#btn-add-log-row")
        page.wait_for_selector("#logsheet-tbody tr", timeout=3000)

        # Fill Row inputs
        first_row = page.locator("#logsheet-tbody tr").first
        first_row.locator("input.log-from").fill("R11")
        first_row.locator("input.log-to").fill("0")
        first_row.locator("input.log-text").fill("ROGER OUT")
        first_row.locator("input.log-initials").fill("JM")

        # Test Export Logsheet Buttons
        assert page.is_visible("#btn-export-log-json")
        assert page.is_visible("#btn-export-log-txt")

    finally:
        context.close()
        assert not errors, f"Trapped JS errors: {errors}"


def test_session_refresh_persistence(browser_instance, target_url):
    """Test session persistence on page reload via sessionStorage."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        page.goto(target_url)
        page.wait_for_selector("#landing-section:not(.d-none)")
        page.click("#toggle-create-view")
        page.wait_for_selector("#create-net-card:not(.d-none)")

        page.fill("#create-name", "Refresh Persistence Net")
        page.fill("#create-sunray-callsign", "0")
        page.fill("#create-instructor-pin", get_today_instructor_pin())
        page.click("#btn-create-net")

        page.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        pin_text = page.inner_text("#header-net-pin")
        assert "PIN:" in pin_text

        # Perform page reload
        page.reload()

        # Verify auto-rejoin restores dashboard state without landing page lock
        page.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        assert page.is_visible("#instructor-section")
        assert "PIN:" in page.inner_text("#header-net-pin")

    finally:
        context.close()
        assert not errors, f"Trapped JS errors: {errors}"


def test_documentation_guides(browser_instance, target_url):
    """Test Student, Sunray, and 404 documentation guide pages."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        # Student Guide
        resp_student = page.goto(f"{target_url}/guide/student")
        assert resp_student.status == 200
        assert "Student User Guide" in page.title()

        # Sunray Guide
        resp_sunray = page.goto(f"{target_url}/guide/sunray")
        assert resp_sunray.status == 200
        assert "Sunray User Guide" in page.title()

        # 404 Unknown Guide
        resp_404 = page.goto(f"{target_url}/guide/unknown_guide_slug")
        assert resp_404.status == 404
        assert "404 - Guide Not Found" in page.content()

    finally:
        context.close()
        assert not errors, f"Trapped JS errors: {errors}"
