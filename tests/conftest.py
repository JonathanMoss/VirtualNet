"""Global Pytest configuration and path isolation setup."""
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import pytest

from app.database import Base, engine, db_session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Ensure testing flag and database path are isolated for pytest execution.
os.environ['TESTING'] = '1'
os.environ.setdefault('DATABASE_URL', f'sqlite:///{ROOT}/virtualnet_test.db')

PINS_FILE = ROOT / "app" / "instructor_pins.json"


def get_today_instructor_pin():
    """Helper to read today's expected 6-digit instructor PIN for testing."""
    with open(PINS_FILE, 'r', encoding='utf-8') as f:
        pins = json.load(f)
    return pins[str(datetime.utcnow().day)]


@pytest.fixture(scope="function")
def db(app):
    # pylint: disable=redefined-outer-name,unused-argument
    """Function-level isolated DB session fixture."""
    session = db_session()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield session
    session.rollback()
