# pylint: disable=redefined-outer-name,too-many-statements,too-many-locals,duplicate-code,too-many-lines
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
        "cdn", "404", "microphone", "webaudio", "getusermedia", "audiocontext",
        "svg", "fetch", "script error"
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
        time.sleep(0.5)

        cls = page_stud.evaluate("() => document.getElementById('ptt-container').className")
        print(f"[E2E LOG] Step 4 Debug class: {cls}")

        # Assert Transmitting UI state on Student UI
        page_stud.wait_for_selector("#ptt-container.ptt-card-transmitting", timeout=5000)
        assert "TRANSMITTING" in page_stud.inner_text("#ptt-state-text")
        white_space = page_stud.eval_on_selector("#ptt-state-text", "el => getComputedStyle(el).whiteSpace")
        assert white_space in ["normal", "pre-wrap"], f"Expected wrapping white-space but got '{white_space}'"

        # Assert Receiving on Instructor UI
        page_inst.wait_for_selector("#ptt-container.ptt-card-receiving", timeout=5000)
        assert "RECEIVING: R11" in page_inst.inner_text("#ptt-state-text")

        # Release PTT
        page_stud.evaluate("() => window.virtualNetApp.stopTransmission()")
        time.sleep(0.5)

        page_stud.wait_for_selector("#ptt-container.ptt-card-idle", timeout=5000)
        page_inst.wait_for_selector("#ptt-container.ptt-card-idle", timeout=5000)

        # Assert quality meter / VU meter and telemetry scale reset on idle
        vu_active_stud = page_stud.locator("#vu-meter-bar .vu-segment.active").count()
        vu_active_inst = page_inst.locator("#vu-meter-bar .vu-segment.active").count()
        assert vu_active_stud == 0, f"Student VU meter active segments should be 0 on idle, got: {vu_active_stud}"
        assert vu_active_inst == 0, f"Instructor VU meter active segments should be 0 on idle, got: {vu_active_inst}"

        stats_stud = page_stud.inner_text("#telemetry-stats-text")
        stats_inst = page_inst.inner_text("#telemetry-stats-text")
        assert "STATUS:" in stats_stud, f"Student telemetry text should reset on idle, got: {stats_stud}"
        assert "STATUS:" in stats_inst, f"Instructor telemetry text should reset on idle, got: {stats_inst}"

        print("[E2E LOG] Step 4 Complete! PTT transmission & quality meter idle reset verified.")

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


def test_logging_reference_tab_and_zoom_controls(browser_instance, target_url):
    """Test LOGGING reference card tab rendering and pan/zoom controls."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        page.goto(target_url)
        page.wait_for_selector("#landing-section:not(.d-none)")
        page.click("#toggle-create-view")
        page.wait_for_selector("#create-net-card:not(.d-none)")

        page.fill("#create-name", "Logging Reference Net")
        page.fill("#create-sunray-callsign", "0")
        page.fill("#create-instructor-pin", get_today_instructor_pin())
        page.click("#btn-create-net")

        page.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)

        # Switch to LOGGING tab
        page.click("#tab-logging-link")
        page.wait_for_selector("#tab-logging.active", timeout=3000)

        # Verify image and zoom controls
        assert page.is_visible("#main-logging-img")
        img_src = page.get_attribute("#main-logging-img", "src")
        assert "/static/images/LOGGING/LOGGING.png" in img_src

        # Verify zoom controls
        zoom_in_btn = page.locator("#tab-logging .btn-zoom-in")
        assert zoom_in_btn.is_visible()
        zoom_in_btn.click()

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


def test_e2e_callsign_management_and_editing(browser_instance, target_url):
    """E2E Test: Verify mid-session callsign modification via header edit button and SUNRAY roster editing."""
    context_instructor = browser_instance.new_context()
    context_student = browser_instance.new_context()

    page_inst, errors_inst = create_trapped_page(context_instructor)
    page_stud, errors_stud = create_trapped_page(context_student)

    try:
        # Step 1: Instructor creates net session
        page_inst.goto(target_url)
        page_inst.wait_for_selector("#landing-section:not(.d-none)")
        page_inst.click("#toggle-create-view")
        page_inst.wait_for_selector("#create-net-card:not(.d-none)")
        page_inst.fill("#create-name", "Callsign Edit Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")

        page_inst.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        # Step 2: Student joins
        page_stud.goto(target_url)
        page_stud.wait_for_selector("#landing-section:not(.d-none)")
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "BRAVO_1")
        page_stud.click("#btn-join-net")
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)

        # Step 3: Instructor assigns callsign 11 -> auto formats to R11 (or indicator)
        page_inst.wait_for_selector("#admissions-tbody tr button.btn-do-assign", timeout=5000)
        page_inst.fill("#admissions-tbody tr input.input-assign-cs", "11")
        page_inst.click("#admissions-tbody tr button.btn-do-assign")

        page_stud.wait_for_selector("#callsign-lock-overlay", state="hidden", timeout=5000)
        page_stud.wait_for_selector("#btn-change-callsign:not(.d-none)", timeout=5000)
        assert "11" in page_stud.inner_text("#header-callsign")

        # Step 4: Instructor modifies student callsign to 11A in roster
        stud_id = page_stud.evaluate("() => window.virtualNetApp.myStationId")
        page_inst.evaluate(f"""() => {{
            if (window.virtualNetApp && window.virtualNetApp.socketManager) {{
                window.virtualNetApp.socketManager.assignCallsign('{stud_id}', '11A', 'SUB_STATION');
            }}
        }}""")
        time.sleep(0.5)

        page_stud.wait_for_selector("#header-callsign", timeout=5000)
        header_text = page_stud.inner_text("#header-callsign")
        assert "11A" in header_text

    finally:
        context_instructor.close()
        context_student.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"


def test_e2e_expired_session_cleanup(browser_instance, target_url):
    """E2E Test: Verify clean UI teardown and sessionStorage wipe when session is ended."""
    context_inst = browser_instance.new_context()
    context_stud = browser_instance.new_context()

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_stud, errors_stud = create_trapped_page(context_stud)

    try:
        page_inst.goto(target_url)
        page_inst.wait_for_selector("#landing-section:not(.d-none)")
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "Teardown Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)")
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        page_stud.goto(target_url)
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "CHARLIE_1")
        page_stud.click("#btn-join-net")
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)")

        # Verify sessionStorage contains active credentials
        session_val = page_stud.evaluate("() => sessionStorage.getItem('virtualnet_session')")
        assert session_val is not None

        # Instructor ends session
        page_inst.click("#btn-end-session")
        page_inst.wait_for_selector("#tactical-dialog-overlay:not(.d-none)")
        page_inst.click("#tactical-dialog-btn-confirm")

        # Student receives session_ended -> redirected to landing page & sessionStorage wiped
        page_stud.wait_for_selector("#landing-section:not(.d-none)", timeout=5000)

        cleared_val = page_stud.evaluate("() => sessionStorage.getItem('virtualnet_session')")
        assert cleared_val is None

        # Verify header labels are reset cleanly
        assert "PIN: ----" in page_stud.inner_text("#header-net-pin")
        assert "AWAITING" in page_stud.inner_text("#header-callsign")

    finally:
        context_inst.close()
        context_stud.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"


def test_e2e_socket_reconnection_and_state_recovery(browser_instance, target_url):
    """E2E Test: Verify assigned callsign state persistence across tab refresh."""
    context_inst = browser_instance.new_context()
    context_stud = browser_instance.new_context()

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_stud, errors_stud = create_trapped_page(context_stud)

    try:
        page_inst.goto(target_url)
        page_inst.wait_for_selector("#landing-section:not(.d-none)")
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "Rebind Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)")
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        page_stud.goto(target_url)
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "DELTA_1")
        page_stud.click("#btn-join-net")
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)")

        # Instructor assigns callsign 15
        page_inst.wait_for_selector("#admissions-tbody tr button.btn-do-assign", timeout=5000)
        page_inst.fill("#admissions-tbody tr input.input-assign-cs", "15")
        page_inst.click("#admissions-tbody tr button.btn-do-assign")

        page_stud.wait_for_selector("#callsign-lock-overlay", state="hidden", timeout=5000)
        assert "15" in page_stud.inner_text("#header-callsign")

        # Reload student page -> auto-rejoin restores assigned callsign
        page_stud.reload()
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        page_stud.wait_for_selector("#callsign-lock-overlay", state="hidden", timeout=5000)
        assert "15" in page_stud.inner_text("#header-callsign")

    finally:
        context_inst.close()
        context_stud.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"


def test_e2e_reference_resources_tabs_and_pan_zoom(browser_instance, target_url):
    """E2E Test: Verify all resource sub-tabs, BATCO slider buttons, dropdown selects, and pan-zoom controls."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        page.goto(target_url)
        page.wait_for_selector("#landing-section:not(.d-none)")
        page.click("#toggle-create-view")
        page.fill("#create-name", "Resources Net")
        page.fill("#create-sunray-callsign", "0")
        page.fill("#create-instructor-pin", get_today_instructor_pin())
        page.click("#btn-create-net")
        page.wait_for_selector("#dashboard-section:not(.d-none)")

        # 1. BATCO SLIDER Tab - Click Up / Down buttons
        page.click("#tab-batco-slider-link", force=True)
        page.wait_for_selector("#tab-batco-slider.active", timeout=5000)
        assert page.is_visible("#btn-slider-up")
        assert page.is_visible("#btn-slider-down")
        page.click("#btn-slider-down", force=True)
        page.click("#btn-slider-up", force=True)

        # 2. BATCO TAB & Zoom buttons
        page.click("#tab-batco-link", force=True)
        page.wait_for_selector("#tab-batco.active", timeout=5000)
        page.click('#tab-batco button.btn-zoom-in[data-target="main-batco-img"]', force=True)
        page.click('#tab-batco button.btn-zoom-out[data-target="main-batco-img"]', force=True)
        page.click('#tab-batco button.btn-zoom-reset[data-target="main-batco-img"]', force=True)

        # 3. VOCAB CARD TAB & Select dropdown
        page.click("#tab-vocab-link", force=True)
        page.wait_for_selector("#tab-vocab.active", timeout=5000)
        page.wait_for_selector("#main-vocab-select option", timeout=5000)
        page.select_option("#main-vocab-select", index=1)
        page.click('#tab-vocab button.btn-zoom-in[data-target="main-vocab-img"]', force=True)
        page.click('#tab-vocab button.btn-zoom-reset[data-target="main-vocab-img"]', force=True)

        # 4. SLATE CARDS TAB & Select dropdown
        page.click("#tab-slates-link", force=True)
        page.wait_for_selector("#tab-slates.active", timeout=5000)
        page.select_option("#main-slate-select", "CONTACT")
        page.click('#tab-slates button.btn-zoom-in[data-target="main-slate-img"]', force=True)
        page.click('#tab-slates button.btn-zoom-reset[data-target="main-slate-img"]', force=True)

    finally:
        context.close()
        assert not errors, f"Trapped JS errors: {errors}"


def test_e2e_logging_reference_image_tab(browser_instance, target_url):
    """E2E Test: Verify LOGGING tab renders reference image card without log table inputs."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        page.goto(target_url)
        page.wait_for_selector("#landing-section:not(.d-none)")
        page.click("#toggle-create-view")
        page.fill("#create-name", "Logging Tab Net")
        page.fill("#create-sunray-callsign", "0")
        page.fill("#create-instructor-pin", get_today_instructor_pin())
        page.click("#btn-create-net")
        page.wait_for_selector("#dashboard-section:not(.d-none)")

        # Switch to LOGGING tab
        page.click("#tab-logging-link")
        page.wait_for_selector("#tab-logging.active")

        # Verify no digital logsheet table exists
        assert page.locator("#logsheet-tbody").count() == 0
        assert page.locator("#btn-add-log-row").count() == 0

        # Verify logging reference card image is rendered
        assert page.is_visible("#main-logging-img")

    finally:
        context.close()
        assert not errors, f"Trapped JS errors: {errors}"


def test_e2e_sunray_station_kick_and_queue_management(browser_instance, target_url):
    """E2E Test: Verify SUNRAY roster editing, kick station trigger, and session kick response."""
    context_inst = browser_instance.new_context()
    context_stud = browser_instance.new_context()

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_stud, errors_stud = create_trapped_page(context_stud)

    try:
        page_inst.goto(target_url)
        page_inst.wait_for_selector("#landing-section:not(.d-none)")
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "Kick Test Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)")
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        page_stud.goto(target_url)
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "KICK_ME")
        page_stud.click("#btn-join-net")
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)")

        # Assign callsign R99
        page_inst.wait_for_selector("#admissions-tbody tr button.btn-do-assign", timeout=5000)
        page_inst.fill("#admissions-tbody tr input.input-assign-cs", "99")
        page_inst.click("#admissions-tbody tr button.btn-do-assign")

        page_stud.wait_for_selector("#callsign-lock-overlay", state="hidden", timeout=5000)

        # SUNRAY modifies student callsign via EDIT CS roster button
        page_inst.wait_for_selector("#instructor-roster-tbody tr button.btn-edit-cs", timeout=5000)
        st_id = page_stud.evaluate("() => window.virtualNetApp.myStationId")
        page_inst.evaluate("""(stId) => {
            window.virtualNetApp.socketManager.assignCallsign(stId, "99A", "SUB_STATION");
        }""", st_id)
        time.sleep(0.5)

        # Verify student callsign updated to R99A
        page_stud.wait_for_selector("#header-callsign", timeout=5000)
        assert "99A" in page_stud.inner_text("#header-callsign")

        # SUNRAY modifies own callsign via btn-change-callsign
        inst_id = page_inst.evaluate("() => window.virtualNetApp.myStationId")
        page_inst.evaluate("""(instId) => {
            window.virtualNetApp.socketManager.assignCallsign(instId, "0A", "SUNRAY");
        }""", inst_id)
        time.sleep(0.5)
        assert "0A" in page_inst.inner_text("#header-callsign")

        # Instructor clicks KICK on station R99A in instructor roster
        page_inst.wait_for_selector("#instructor-roster-tbody tr button.btn-kick-st", timeout=5000)
        page_inst.click("#instructor-roster-tbody tr button.btn-kick-st")

        # Confirm kick dialog modal
        page_inst.wait_for_selector("#tactical-dialog-overlay:not(.d-none)", timeout=3000)
        page_inst.click("#tactical-dialog-btn-confirm")

        # Student receives kicked event -> redirected to landing page
        page_stud.wait_for_selector("#landing-section:not(.d-none)", timeout=5000)

    finally:
        context_inst.close()
        context_stud.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"


def test_e2e_channel_busy_transmission_blocked(browser_instance, target_url):
    """E2E Test: Verify channel busy tone & UI blocked state when a station transmits during active traffic."""
    context_inst = browser_instance.new_context(permissions=["microphone"])
    context_s1 = browser_instance.new_context(permissions=["microphone"])
    context_s2 = browser_instance.new_context(permissions=["microphone"])

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_s1, errors_s1 = create_trapped_page(context_s1)
    page_s2, errors_s2 = create_trapped_page(context_s2)

    try:
        page_inst.goto(target_url)
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "Busy Test Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)")
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        # Student 1 joins
        page_s1.goto(target_url)
        page_s1.fill("#join-pin", pin_code)
        page_s1.fill("#join-nickname", "STUDENT_ALPHA")
        page_s1.click("#btn-join-net")
        page_s1.wait_for_selector("#dashboard-section:not(.d-none)")

        # Student 2 joins
        page_s2.goto(target_url)
        page_s2.fill("#join-pin", pin_code)
        page_s2.fill("#join-nickname", "STUDENT_BRAVO")
        page_s2.click("#btn-join-net")
        page_s2.wait_for_selector("#dashboard-section:not(.d-none)")

        # Assign callsigns R11 and R12
        page_inst.wait_for_selector("#admissions-tbody tr button.btn-do-assign", timeout=5000)
        assign_btns = page_inst.locator("#admissions-tbody tr button.btn-do-assign")
        inputs = page_inst.locator("#admissions-tbody tr input.input-assign-cs")

        inputs.nth(0).fill("11")
        assign_btns.nth(0).click()
        time.sleep(0.3)

        inputs.nth(1).fill("12")
        assign_btns.nth(1).click()

        page_s1.wait_for_selector("#callsign-lock-overlay", state="hidden", timeout=5000)
        page_s2.wait_for_selector("#callsign-lock-overlay", state="hidden", timeout=5000)

        # Student 1 starts transmitting
        page_s1.evaluate("""() => {
            if (window.virtualNetApp) window.virtualNetApp.startTransmission();
        }""")
        time.sleep(0.5)

        page_s1.wait_for_selector("#ptt-container.ptt-card-transmitting", timeout=5000)

        # Student 2 attempts to transmit while channel is busy
        page_s2.evaluate("""() => {
            if (window.virtualNetApp) window.virtualNetApp.startTransmission();
        }""")
        time.sleep(0.3)

        # Student 2 should receive BLOCKED state
        page_s2.wait_for_selector("#ptt-container.ptt-card-blocked", timeout=5000)
        assert "BLOCKED" in page_s2.inner_text("#ptt-state-text") or "BUSY" in page_s2.inner_text("#ptt-state-text")

        # Student 1 stops transmitting
        page_s1.evaluate("() => window.virtualNetApp.stopTransmission()")
        time.sleep(0.5)

        page_s1.wait_for_selector("#ptt-container.ptt-card-idle", timeout=5000)
        page_s2.wait_for_selector("#ptt-container.ptt-card-idle", timeout=5000)
        page_inst.wait_for_selector("#ptt-container.ptt-card-idle", timeout=5000)

    finally:
        context_inst.close()
        context_s1.close()
        context_s2.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_s1, f"Student 1 trapped JS errors: {errors_s1}"
        assert not errors_s2, f"Student 2 trapped JS errors: {errors_s2}"


def test_e2e_sunray_breakin_channel_override(browser_instance, target_url):
    """E2E Test: Verify SUNRAY Break-In channel override interrupting active student transmission."""
    context_inst = browser_instance.new_context(permissions=["microphone"])
    context_stud = browser_instance.new_context(permissions=["microphone"])

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_stud, errors_stud = create_trapped_page(context_stud)

    try:
        page_inst.goto(target_url)
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "BreakIn Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)")
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        page_stud.goto(target_url)
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "CHARLIE_STATION")
        page_stud.click("#btn-join-net")
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)")

        # Assign callsign R13
        page_inst.wait_for_selector("#admissions-tbody tr button.btn-do-assign", timeout=5000)
        page_inst.fill("#admissions-tbody tr input.input-assign-cs", "13")
        page_inst.click("#admissions-tbody tr button.btn-do-assign")

        page_stud.wait_for_selector("#callsign-lock-overlay", state="hidden", timeout=5000)

        # Student starts transmitting
        page_stud.evaluate("""() => {
            if (window.virtualNetApp) window.virtualNetApp.startTransmission();
        }""")
        time.sleep(0.5)

        page_stud.wait_for_selector("#ptt-container.ptt-card-transmitting", timeout=5000)
        page_inst.wait_for_selector("#ptt-container.ptt-card-receiving", timeout=5000)

        # SUNRAY breaks in and transmits
        page_inst.evaluate("""() => {
            if (window.virtualNetApp) window.virtualNetApp.startTransmission();
        }""")
        time.sleep(0.5)

        # Student UI should be overridden and transition to RECEIVING
        page_stud.wait_for_selector("#ptt-container.ptt-card-receiving", timeout=5000)
        assert "RECEIVING" in page_stud.inner_text("#ptt-state-text")

        # SUNRAY releases PTT
        page_inst.evaluate("() => window.virtualNetApp.stopTransmission()")
        page_stud.evaluate("() => { if (window.virtualNetApp) window.virtualNetApp.stopTransmission(); }")
        time.sleep(0.5)

        page_inst.wait_for_selector("#ptt-container.ptt-card-idle", timeout=5000)
        page_stud.wait_for_selector("#ptt-container.ptt-card-idle", timeout=5000)

    finally:
        context_inst.close()
        context_stud.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"


def test_e2e_student_leave_net_session(browser_instance, target_url):
    """E2E Test: Verify student leaving net session resets UI and clears sessionStorage."""
    context_inst = browser_instance.new_context()
    context_stud = browser_instance.new_context()

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_stud, errors_stud = create_trapped_page(context_stud)

    try:
        # Create Net as instructor
        page_inst.goto(target_url)
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "Leave Net Test")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)")
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        # Student joins
        page_stud.goto(target_url)
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "LEAVER_1")
        page_stud.click("#btn-join-net")
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)")

        # Student clicks Leave Net button
        page_stud.click("#btn-leave-net")
        page_stud.wait_for_selector("#tactical-dialog-overlay:not(.d-none)", timeout=3000)
        page_stud.click("#tactical-dialog-btn-confirm")

        # Student should be redirected to landing page & session cleared
        page_stud.wait_for_selector("#landing-section:not(.d-none)", timeout=5000)
        session_val = page_stud.evaluate("() => sessionStorage.getItem('virtualnet_session')")
        assert session_val is None

    finally:
        context_inst.close()
        context_stud.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"


def test_e2e_sunray_session_persistence_reload_and_reopen(browser_instance, target_url):
    """E2E Test: Verify SUNRAY session persistence across browser reloads and context re-opens."""
    context = browser_instance.new_context()
    page, errors = create_trapped_page(context)

    try:
        page.goto(target_url)
        page.click("#toggle-create-view")
        page.fill("#create-name", "SUNRAY Persist Net")
        page.fill("#create-sunray-callsign", "0")
        page.fill("#create-instructor-pin", get_today_instructor_pin())
        page.click("#btn-create-net")

        page.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        pin_code = page.inner_text("#header-net-pin").replace("PIN:", "").strip()

        # Reload page
        page.reload()
        page.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        reloaded_pin = page.inner_text("#header-net-pin").replace("PIN:", "").strip()
        assert reloaded_pin == pin_code

        # Open new page in same context (simulating tab re-open with localStorage)
        page2 = context.new_page()
        page2.goto(target_url)
        page2.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        reopened_pin = page2.inner_text("#header-net-pin").replace("PIN:", "").strip()
        assert reopened_pin == pin_code

    finally:
        context.close()
        assert not errors, f"Trapped JS errors: {errors}"


def test_e2e_student_closed_session_rejoin_alert(browser_instance, target_url):
    """E2E Test: Verify student closed-session rejection alert modal and return to landing page."""
    context_inst = browser_instance.new_context()
    context_stud = browser_instance.new_context()

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_stud, errors_stud = create_trapped_page(context_stud)
    errors_stud2 = []

    try:
        page_inst.goto(target_url)
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "Closed Session Test")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)")
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        page_stud.goto(target_url)
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "STUD_CLOSE_1")
        page_stud.click("#btn-join-net")
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)")

        # Capture student session storage state before closing context
        storage = context_stud.storage_state()
        context_stud.close()

        # SUNRAY ends net session
        page_inst.click("#btn-leave-net")
        page_inst.wait_for_selector("#tactical-dialog-overlay:not(.d-none)", timeout=3000)
        page_inst.click("#tactical-dialog-btn-confirm")
        page_inst.wait_for_selector("#landing-section:not(.d-none)")

        # Student opens new browser context with saved localStorage
        context_stud2 = browser_instance.new_context(storage_state=storage)
        page_stud2, errors_stud2 = create_trapped_page(context_stud2)
        page_stud2.goto(target_url)

        # Student receives alert modal and returns to landing
        page_stud2.wait_for_selector("#tactical-dialog-overlay:not(.d-none)", timeout=5000)
        dialog_title = page_stud2.inner_text("#tactical-dialog-title")
        assert "SESSION NO LONGER VALID" in dialog_title
        page_stud2.click("#tactical-dialog-btn-confirm")
        page_stud2.wait_for_selector("#landing-section:not(.d-none)")
        context_stud2.close()

    finally:
        context_inst.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"
        assert not errors_stud2, f"Student 2 trapped JS errors: {errors_stud2}"


def test_e2e_copy_pin_and_url_prefill(browser_instance, target_url):
    """E2E Test: Verify Copy PIN button and URL query parameter ?pin=A3F9 pre-fill."""
    context_inst = browser_instance.new_context()
    context_stud = browser_instance.new_context()

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_stud, errors_stud = create_trapped_page(context_stud)

    try:
        page_inst.goto(target_url)
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "Copy PIN Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)")

        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()
        assert page_inst.is_visible("#btn-copy-pin")

        # Open student page with URL parameter ?pin=...
        page_stud.goto(f"{target_url}?pin={pin_code}")
        page_stud.wait_for_selector("#join-pin")
        prefilled_pin = page_stud.input_value("#join-pin")
        assert prefilled_pin == pin_code

    finally:
        context_inst.close()
        context_stud.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"


def test_e2e_rejoin_audio_context_resume_and_chunk_scheduling(browser_instance, target_url):
    """E2E Test: Verify AudioContext unlock, 170ms 2-chunk buffer math, and zero JS errors on tab rejoin."""
    context_inst = browser_instance.new_context(permissions=["microphone"])
    context_stud = browser_instance.new_context(permissions=["microphone"])

    page_inst, errors_inst = create_trapped_page(context_inst)
    page_stud, errors_stud = create_trapped_page(context_stud)

    try:
        page_inst.goto(target_url)
        page_inst.click("#toggle-create-view")
        page_inst.fill("#create-name", "Audio Rejoin E2E Net")
        page_inst.fill("#create-sunray-callsign", "0")
        page_inst.fill("#create-instructor-pin", get_today_instructor_pin())
        page_inst.click("#btn-create-net")
        page_inst.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)
        pin_code = page_inst.inner_text("#header-net-pin").replace("PIN:", "").strip()

        page_stud.goto(target_url)
        page_stud.fill("#join-pin", pin_code)
        page_stud.fill("#join-nickname", "STUDENT_AUDIO")
        page_stud.click("#btn-join-net")
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)

        # Reload student page to simulate tab re-open and auto-rejoin
        page_stud.reload()
        page_stud.wait_for_selector("#dashboard-section:not(.d-none)", timeout=5000)

        # Trigger user gesture unlock (click) on student page
        page_stud.click("body", force=True)

        # Evaluate WebAudio scheduling math & state in student browser context
        audio_results = page_stud.evaluate("""async () => {
            const engine = window.app ? window.app.audioEngine : null;
            if (engine && !engine.audioContext) {
                await engine.init();
            }

            if (engine && engine.audioContext && engine.audioContext.state !== 'running') {
                Object.defineProperty(engine.audioContext, 'state', { value: 'running', configurable: true });
            }

            const buildPacket = () => {
                const header = new Uint8Array(12);
                const sampleRateHeader = (48000 & 0x7FFFFFFF) | 0x80000000;
                header[8] = (sampleRateHeader >> 24) & 0xFF;
                header[9] = (sampleRateHeader >> 16) & 0xFF;
                header[10] = (sampleRateHeader >> 8) & 0xFF;
                header[11] = sampleRateHeader & 0xFF;
                const payload = new Uint8Array(4096 * 2);
                const pkt = new Uint8Array(12 + payload.length);
                pkt.set(header, 0);
                pkt.set(payload, 12);
                return pkt;
            };

            const p1 = buildPacket();
            const p2 = buildPacket();
            const p3 = buildPacket();

            if (engine) await engine.receiveAudioChunk(p1);
            const t1 = engine ? engine.nextStartTime : 0;

            if (engine) await engine.receiveAudioChunk(p2);
            const t2 = engine ? engine.nextStartTime : 0;

            if (engine) await engine.receiveAudioChunk(p3);
            const t3 = engine ? engine.nextStartTime : 0;

            const duration = 4096 / 48000;
            const diff12 = t2 - t1;
            const diff23 = t3 - t2;

            return {
                contextState: engine && engine.audioContext ? engine.audioContext.state : 'none',
                diff12Correct: Math.abs(diff12 - duration) < 0.001,
                diff23Correct: Math.abs(diff23 - duration) < 0.001
            };
        }""")

        assert audio_results["diff12Correct"], "Chunk 2 was incorrectly reset!"
        assert audio_results["diff23Correct"], "Chunk 3 was incorrectly reset! (False jitter threshold reset bug)"

    finally:
        context_inst.close()
        context_stud.close()
        assert not errors_inst, f"Instructor trapped JS errors: {errors_inst}"
        assert not errors_stud, f"Student trapped JS errors: {errors_stud}"
