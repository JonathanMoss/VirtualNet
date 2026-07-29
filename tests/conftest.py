"""Global Pytest configuration and path isolation setup."""
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


@pytest.fixture(scope="function")
def db(app):
    # pylint: disable=redefined-outer-name,unused-argument
    """Function-level isolated DB session fixture."""
    session = db_session()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield session
    session.rollback()
