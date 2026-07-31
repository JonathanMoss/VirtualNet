"""Service module for instructor PIN validation."""
from datetime import datetime
import json
from pathlib import Path

PINS_FILE = Path(__file__).resolve().parent.parent / "instructor_pins.json"


def verify_instructor_pin(pin: str) -> bool:
    """Validate 6-digit instructor PIN against today's day-of-month PIN table (UTC or local time)."""
    if not PINS_FILE.exists():
        return False
    try:
        with open(PINS_FILE, 'r', encoding='utf-8') as f:
            pins_data = json.load(f)
        exp_utc = pins_data.get(str(datetime.utcnow().day))
        exp_loc = pins_data.get(str(datetime.now().day))
        return (exp_utc is not None and pin == exp_utc) or (exp_loc is not None and pin == exp_loc)
    except (OSError, KeyError, json.JSONDecodeError):
        return False
