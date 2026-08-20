"""
DOM Contract Integrity Tests for VirtualNet Client JavaScript and HTML.

Validates that every DOM element ID referenced by JavaScript files
(e.g., document.getElementById('xyz')) actually exists in static/templates/index.html.
"""

from html.parser import HTMLParser
import re
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
TEMPLATES_DIR_PATH = BASE_DIR / "static" / "templates"
JS_DIR_PATH = BASE_DIR / "static" / "js"


class IndexHTMLParser(HTMLParser):
    """Simple HTML parser to extract all element IDs and data-target attributes."""

    def __init__(self):
        super().__init__()
        self.element_ids = set()
        self.data_targets = set()

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        if "id" in attr_dict:
            self.element_ids.add(attr_dict["id"])
        if "data-target" in attr_dict:
            self.data_targets.add(attr_dict["data-target"])


def get_html_data(templates_dir: Path) -> tuple[set[str], set[str]]:
    """Parse all HTML templates in static/templates/ and return sets of element IDs and data-target values."""
    assert templates_dir.exists(), f"HTML template directory not found at {templates_dir}"
    parser = IndexHTMLParser()
    for html_file in templates_dir.rglob("*.html"):
        with open(html_file, "r", encoding="utf-8") as f:
            parser.feed(f.read())
    return parser.element_ids, parser.data_targets


def get_js_element_references(js_dir: Path) -> list[tuple[str, str, int]]:
    """
    Scan all JS files in static/js/ for document.getElementById('ID') calls.
    Returns a list of tuples: (filename, referenced_id, line_number)
    """
    assert js_dir.exists(), f"JS directory not found at {js_dir}"
    references = []

    # Regex matching document.getElementById('xyz') or document.getElementById("xyz")
    get_elem_pattern = re.compile(r"document\.getElementById\(['\"]([^'\"]+)['\"]\)")

    for js_file in js_dir.rglob("*.js"):
        with open(js_file, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                matches = get_elem_pattern.findall(line)
                for match in matches:
                    references.append((js_file.name, match, line_no))

    return references


def test_all_js_get_element_by_id_references_exist_in_html():
    """Verify that 100% of DOM IDs queried in static/js/*.js exist in index.html or card templates."""
    html_ids, _ = get_html_data(TEMPLATES_DIR_PATH)
    js_references = get_js_element_references(JS_DIR_PATH)

    assert len(html_ids) > 0, "No HTML IDs found in templates!"
    assert len(js_references) > 0, "No JS element ID references found in static/js/*.js!"

    missing_references = []
    for js_filename, elem_id, line_no in js_references:
        # Ignore elements dynamically created by JS modules (e.g. dialog.js modals)
        if elem_id.startswith("tactical-dialog-"):
            continue
        if elem_id not in html_ids:
            missing_references.append(f"{js_filename}:L{line_no} -> #{elem_id}")

    assert not missing_references, (
        f"Found {len(missing_references)} JavaScript element ID reference(s) "
        "that DO NOT exist in template HTML files:\n"
        + "\n".join(f"  - {ref}" for ref in missing_references)
    )


def test_all_html_data_zoom_targets_exist_in_html():
    """Verify that all data-target attributes in template HTML files refer to valid element IDs."""
    html_ids, data_targets = get_html_data(TEMPLATES_DIR_PATH)

    missing_targets = []
    for target_id in data_targets:
        if target_id not in html_ids:
            missing_targets.append(f"data-target=\"{target_id}\"")

    assert not missing_targets, (
        f"Found {len(missing_targets)} data-target reference(s) "
        "in template HTML files that DO NOT exist as HTML element IDs:\n"
        + "\n".join(f"  - {target}" for target in missing_targets)
    )


def test_no_inline_styles_in_html_templates():
    """Verify that zero inline style attributes (style="...") exist in HTML template files."""
    assert TEMPLATES_DIR_PATH.exists(), f"Templates directory not found at {TEMPLATES_DIR_PATH}"
    inline_style_pattern = re.compile(r'style\s*=\s*["\'][^"\']+["\']', re.IGNORECASE)

    violations = []
    for html_file in TEMPLATES_DIR_PATH.rglob("*.html"):
        with open(html_file, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                if inline_style_pattern.search(line):
                    violations.append(f"{html_file.relative_to(BASE_DIR)}:L{line_no} -> {line.strip()}")

    assert not violations, (
        f"Found {len(violations)} inline style attribute(s) in HTML templates. "
        "All CSS must be modularized into external CSS files:\n"
        + "\n".join(f"  - {v}" for v in violations)
    )


def test_no_embedded_style_blocks_in_html_templates():
    """Verify that no embedded <style> tags exist in HTML template files."""
    assert TEMPLATES_DIR_PATH.exists(), f"Templates directory not found at {TEMPLATES_DIR_PATH}"
    style_block_pattern = re.compile(r'<style[\s>]', re.IGNORECASE)

    style_blocks = []
    for html_file in TEMPLATES_DIR_PATH.rglob("*.html"):
        with open(html_file, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                if style_block_pattern.search(line):
                    style_blocks.append(f"{html_file.relative_to(BASE_DIR)}:L{line_no}")

    assert not style_blocks, (
        f"Found {len(style_blocks)} embedded <style> block(s) in HTML templates:\n"
        + "\n".join(f"  - {sb}" for sb in style_blocks)
    )


def test_socket_manager_app_callbacks_exist_in_app_js():
    """Verify that 100% of this.app.<methodName>(...) callbacks invoked in socket.js exist in app.js."""
    socket_js_path = JS_DIR_PATH / "socket.js"
    app_js_path = JS_DIR_PATH / "app.js"
    assert socket_js_path.exists(), f"socket.js not found at {socket_js_path}"
    assert app_js_path.exists(), f"app.js not found at {app_js_path}"

    app_call_pattern = re.compile(r"this\.app\.([a-zA-Z0-9_]+)\(")
    referenced_methods = set()
    with open(socket_js_path, "r", encoding="utf-8") as f:
        for line in f:
            matches = app_call_pattern.findall(line)
            for match in matches:
                if match not in ("audioEngine", "telemetryManager", "resourcesManager", "socketManager"):
                    referenced_methods.add(match)

    method_def_pattern = re.compile(r"^\s*([a-zA-Z0-9_]+)\s*\(", re.MULTILINE)
    with open(app_js_path, "r", encoding="utf-8") as f:
        app_js_content = f.read()

    defined_methods = set(method_def_pattern.findall(app_js_content))

    missing_methods = []
    for method_name in referenced_methods:
        if method_name not in defined_methods:
            missing_methods.append(method_name)

    assert not missing_methods, (
        f"Found {len(missing_methods)} SocketManager app callback(s) in socket.js "
        "that are NOT defined in app.js:\n"
        + "\n".join(f"  - this.app.{m}()" for m in missing_methods)
    )


def test_subcontroller_delegated_methods_exist():
    """Verify that all this.<controller>.<method>() calls in app.js exist in controller modules."""
    # pylint: disable=too-many-locals
    controllers_dir = JS_DIR_PATH / "controllers"
    app_js_path = JS_DIR_PATH / "app.js"
    assert controllers_dir.exists(), f"Controllers directory not found at {controllers_dir}"

    controller_methods = {}
    method_def_pattern = re.compile(r"^\s*(?:async\s+)?([a-zA-Z0-9_]+)\s*\(", re.MULTILINE)
    for js_file in controllers_dir.glob("*.js"):
        with open(js_file, "r", encoding="utf-8") as f:
            content = f.read()
            controller_methods[js_file.stem] = set(method_def_pattern.findall(content))

    controller_map = {
        "rosterController": "roster_controller",
        "sunrayController": "sunray_controller",
        "pttController": "ptt_controller"
    }

    ctrl_regex = r"this\.(rosterController|sunrayController|pttController)\.([a-zA-Z0-9_]+)\("
    call_pattern = re.compile(ctrl_regex)

    missing_delegations = []
    with open(app_js_path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            matches = call_pattern.findall(line)
            for ctrl_var, method_name in matches:
                module_name = controller_map.get(ctrl_var)
                defined_set = controller_methods.get(module_name, set())
                if method_name not in defined_set:
                    msg = f"app.js:L{line_no} -> this.{ctrl_var}.{method_name}() missing in {module_name}.js"
                    missing_delegations.append(msg)

    assert not missing_delegations, (
        f"Found {len(missing_delegations)} missing sub-controller method delegation(s):\n"
        + "\n".join(f"  - {d}" for d in missing_delegations)
    )


def test_ptt_state_text_wrapping_dom_contract():
    """Verify transceiver_card.html and style.css contain wrapping rules for #ptt-state-text."""
    card_html_path = BASE_DIR / "static" / "templates" / "cards" / "transceiver_card.html"
    style_css_path = BASE_DIR / "static" / "css" / "style.css"

    with open(card_html_path, "r", encoding="utf-8") as f:
        card_content = f.read()

    with open(style_css_path, "r", encoding="utf-8") as f:
        css_content = f.read()

    assert 'id="ptt-state-text"' in card_content
    assert 'text-wrap' in card_content or 'text-break' in card_content
    assert '#ptt-state-text' in css_content
    assert 'white-space: normal' in css_content or 'word-break: break-word' in css_content
