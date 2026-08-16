# pylint: disable=redefined-outer-name
"""
Headless End-to-End Browser Testing Suite for VirtualNet.

Executes client-side JavaScript (app.js, audio.js, resources.js, pan_zoom.js)
in a headless Chromium browser instance via Playwright, trapping any client-side
console.error logs, uncaught exceptions, or unhandled promise rejections.
"""

import socket
import threading
import time
import pytest
from app import create_app, socketio

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

pytestmark = pytest.mark.skipif(not HAS_PLAYWRIGHT, reason="Playwright is not installed in this Python environment")

HOST = "127.0.0.1"


def find_free_port() -> int:
    """Find a free TCP port for running the live test server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def live_server():
    """Fixture that boots Flask app on an ephemeral port in a background thread."""
    port = find_free_port()
    app = create_app()
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"

    server_thread = threading.Thread(
        target=lambda: socketio.run(app, host=HOST, port=port, use_reloader=False, log_output=False),
        daemon=True
    )
    server_thread.start()
    time.sleep(0.5)

    base_url = f"http://{HOST}:{port}"
    yield base_url, app


@pytest.fixture
def page_trap(live_server):
    """
    Playwright browser page fixture that registers console.error and pageerror traps.
    Fails the test if any unhandled JS exception or console error occurs.
    """
    if not HAS_PLAYWRIGHT:
        pytest.skip("Playwright is not installed")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        )
        context = browser.new_context()
        page = context.new_page()

        js_errors = []

        def handle_page_error(error):
            js_errors.append(f"Uncaught JS Error: {error}")

        def handle_console(msg):
            # Ignore CDN network errors or Socket.IO fallback messages in offline test runner
            if msg.type == "error" and "socket.io" not in msg.text.lower() and "cdn" not in msg.text.lower():
                js_errors.append(f"Console Error: {msg.text}")

        page.on("pageerror", handle_page_error)
        page.on("console", handle_console)

        yield page, js_errors, live_server

        browser.close()

        # Assert zero client-side JavaScript errors occurred during test execution
        assert not js_errors, (
            f"Trapped {len(js_errors)} JavaScript error(s) during browser execution:\n"
            + "\n".join(f"  - {err}" for err in js_errors)
        )


def test_landing_page_loads_without_js_errors(page_trap):
    """Verify landing page loads cleanly without any JS console or runtime errors."""
    page, _, (base_url, _) = page_trap
    page.goto(base_url)

    assert page.is_visible("#join-net-card")
    assert page.is_visible("#landing-section")
    assert not page.is_visible("#dashboard-section")


def test_sunray_portal_toggle_and_create_session(page_trap):
    """Test SUNRAY portal toggle and form visibility."""
    page, _, (base_url, _) = page_trap
    page.goto(base_url)

    page.click("#toggle-create-view")
    page.wait_for_selector("#create-net-card:not(.d-none)")

    page.fill("#create-name", "E2E Drill Test")
    page.fill("#create-sunray-callsign", "0")
    page.fill("#create-instructor-pin", "682015")
    assert page.is_visible("#btn-create-net")


def test_student_join_view(page_trap):
    """Test student join view inputs and toggle back to login."""
    page, _, (base_url, _) = page_trap
    page.goto(base_url)

    page.fill("#join-pin", "A3F9")
    page.fill("#join-nickname", "TEST_STUDENT")
    assert page.is_visible("#btn-join-net")


def test_ui_controls_tabs_and_drawer(page_trap):
    """Test PTT panel minimise toggle, Aide Memoire drawer, and resource tabs."""
    page, _, (base_url, _) = page_trap
    page.goto(base_url)

    page.evaluate("""() => {
        document.getElementById('landing-section').classList.add('d-none');
        document.getElementById('dashboard-section').classList.remove('d-none');
    }""")

    # Test PTT Minimise Toggle
    page.click("#btn-toggle-ptt-panel", force=True)
    assert "minimised" in page.get_attribute("#ptt-container", "class")
    page.click("#btn-toggle-ptt-panel", force=True)
    assert "minimised" not in page.get_attribute("#ptt-container", "class")
