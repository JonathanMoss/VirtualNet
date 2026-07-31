"""
DOM Contract Integrity Tests for VirtualNet Client JavaScript and HTML.

Validates that every DOM element ID referenced by JavaScript files
(e.g., document.getElementById('xyz')) actually exists in static/templates/index.html.
"""

from html.parser import HTMLParser
import re
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
INDEX_HTML_PATH = BASE_DIR / "static" / "templates" / "index.html"
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


def get_html_data(html_path: Path) -> tuple[set[str], set[str]]:
    """Parse index.html and return sets of element IDs and data-target values."""
    assert html_path.exists(), f"HTML template file not found at {html_path}"
    parser = IndexHTMLParser()
    with open(html_path, "r", encoding="utf-8") as f:
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

    for js_file in js_dir.glob("*.js"):
        with open(js_file, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                matches = get_elem_pattern.findall(line)
                for match in matches:
                    references.append((js_file.name, match, line_no))

    return references


def test_all_js_get_element_by_id_references_exist_in_html():
    """Verify that 100% of DOM IDs queried in static/js/*.js exist in index.html."""
    html_ids, _ = get_html_data(INDEX_HTML_PATH)
    js_references = get_js_element_references(JS_DIR_PATH)

    assert len(html_ids) > 0, "No HTML IDs found in index.html!"
    assert len(js_references) > 0, "No JS element ID references found in static/js/*.js!"

    missing_references = []
    for js_filename, elem_id, line_no in js_references:
        # Ignore elements dynamically created by JS modules (e.g. dialog.js modals)
        if elem_id.startswith("tactical-dialog-"):
            continue
        if elem_id not in html_ids:
            missing_references.append(f"{js_filename}:L{line_no} -> #{elem_id}")

    assert not missing_references, (
        f"Found {len(missing_references)} JavaScript element ID reference(s) that DO NOT exist in index.html:\n"
        + "\n".join(f"  - {ref}" for ref in missing_references)
    )


def test_all_html_data_zoom_targets_exist_in_html():
    """Verify that all data-target attributes in index.html refer to valid element IDs."""
    html_ids, data_targets = get_html_data(INDEX_HTML_PATH)

    missing_targets = []
    for target_id in data_targets:
        if target_id not in html_ids:
            missing_targets.append(f"data-target=\"{target_id}\"")

    assert not missing_targets, (
        f"Found {len(missing_targets)} data-target reference(s) in index.html that DO NOT exist as HTML element IDs:\n"
        + "\n".join(f"  - {target}" for target in missing_targets)
    )
