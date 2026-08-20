"""Service module for instructor PIN validation."""
from datetime import datetime
import json
from pathlib import Path

PINS_FILE = Path(__file__).resolve().parent.parent / "instructor_pins.json"


_CACHED_PINS = None
_CACHED_MTIME = 0.0


def _load_pins_data():
    # pylint: disable=global-statement
    global _CACHED_PINS, _CACHED_MTIME
    if not PINS_FILE.exists():
        return {}
    try:
        current_mtime = PINS_FILE.stat().st_mtime
        if _CACHED_PINS is None or current_mtime > _CACHED_MTIME:
            with open(PINS_FILE, 'r', encoding='utf-8') as f:
                _CACHED_PINS = json.load(f)
            _CACHED_MTIME = current_mtime
        return _CACHED_PINS
    except (OSError, KeyError, json.JSONDecodeError):
        return {}


def verify_instructor_pin(pin: str) -> bool:
    """Validate 6-digit instructor PIN against today's day-of-month PIN table (UTC or local time)."""
    if not pin or len(pin) != 6:
        return False
    pins_data = _load_pins_data()
    if not pins_data:
        return False
    exp_utc = pins_data.get(str(datetime.utcnow().day))
    exp_loc = pins_data.get(str(datetime.now().day))
    return (exp_utc is not None and pin == exp_utc) or (exp_loc is not None and pin == exp_loc)
