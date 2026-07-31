"""Global Pytest configuration and path isolation setup."""
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Ensure testing flag and database path are isolated for pytest execution.
os.environ['TESTING'] = '1'
os.environ.setdefault('DATABASE_URL', f'sqlite:///{ROOT}/virtualnet_test.db')

# pylint: disable=wrong-import-position
from app import create_app
from app.database import Base, engine, db_session, init_db

PINS_FILE = ROOT / "app" / "instructor_pins.json"


def get_today_instructor_pin():
    """Helper to read today's expected 6-digit instructor PIN for testing."""
    with open(PINS_FILE, 'r', encoding='utf-8') as f:
        pins = json.load(f)
    return pins[str(datetime.utcnow().day)]


@pytest.fixture(scope="module")
def app():
    """Module-level Flask app test fixture."""
    app_instance = create_app()
    app_instance.config['TESTING'] = True

    # Initialize database
    init_db()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    yield app_instance

    # Cleanup
    Base.metadata.drop_all(bind=engine)
    db_session.remove()


@pytest.fixture(scope="function")
def db(app):
    # pylint: disable=redefined-outer-name,unused-argument
    """Function-level isolated DB session fixture."""
    session = db_session()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield session
    session.rollback()
