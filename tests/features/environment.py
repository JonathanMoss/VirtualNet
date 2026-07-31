"""Behave BDD test environment lifecycle hooks."""
import os
import sys

# Ensure project root is in the path
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
sys.path.insert(0, ROOT)

os.environ['TESTING'] = '1'
os.environ.setdefault('DATABASE_URL', f'sqlite:///{ROOT}/virtualnet_test.db')

# pylint: disable=wrong-import-position
from app import create_app
from app.database import Base, engine, db_session
from app.sockets import sid_to_station_id, station_id_to_sid, transmitting_sids


def before_all(context):
    """Setup test Flask app and in-memory database before running features."""
    context.app = create_app()
    context.app.config['TESTING'] = True
    context.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    # Initialize DB
    Base.metadata.create_all(bind=engine)
    context.db = db_session()


def after_all(context):
    """Teardown database schema after all features complete."""
    # pylint: disable=unused-argument
    Base.metadata.drop_all(bind=engine)
    db_session.remove()


def before_scenario(context, scenario):
    """Reset database tables and active socket mappings before each scenario."""
    # pylint: disable=unused-argument
    # Clear tables before each scenario to isolate tests
    context.db.rollback()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    # Clean memory mappings
    sid_to_station_id.clear()
    station_id_to_sid.clear()
    transmitting_sids.clear()

    # Track open client sockets to close them after the scenario
    context.clients = {}
