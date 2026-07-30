"""Database connection setup and session management for VirtualNet."""
import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, scoped_session
from app.models import Base

# Default to SQLite database path inside the data directory volume
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///data/virtualnet.db')


# For SQLite, check if we need to enable multi-thread access
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

# Create SQLAlchemy engine
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args
)

# Setup session factory
session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
db_session = scoped_session(session_factory)


def init_db():
    """Initializes the database schema and performs auto-migration for missing columns."""
    # Ensure database directory exists if database is written to a relative/absolute path
    if DATABASE_URL.startswith("sqlite:///"):
        db_path = DATABASE_URL.replace("sqlite:///", "")
        db_dir = os.path.dirname(db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)

    Base.metadata.create_all(bind=engine)

    # Auto-migrate missing last_seen column for existing SQLite databases
    try:
        inspector = inspect(engine)
        if 'stations' in inspector.get_table_names():
            columns = [c['name'] for c in inspector.get_columns('stations')]
            if 'last_seen' not in columns:
                with engine.connect() as conn:
                    conn.execute(text("ALTER TABLE stations ADD COLUMN last_seen DATETIME"))
                    conn.commit()
    except Exception as e:  # pylint: disable=broad-exception-caught
        print(f"Schema migration note: {e}")


def get_db():
    """Returns a new database session."""
    session = db_session()
    try:
        return session
    except Exception:
        session.rollback()
        raise
