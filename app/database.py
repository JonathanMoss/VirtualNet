import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from app.models import Base

# Default to SQLite database path inside the application folder or container volume
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///virtualnet.db')

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
    """Initializes the database schema."""
    # Ensure database directory exists if database is written to a relative/absolute path
    if DATABASE_URL.startswith("sqlite:///"):
        db_path = DATABASE_URL.replace("sqlite:///", "")
        db_dir = os.path.dirname(db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
            
    Base.metadata.create_all(bind=engine)

def get_db():
    """Returns a new database session."""
    session = db_session()
    try:
        return session
    except Exception:
        session.rollback()
        raise
    finally:
        # Note: scoped_session.remove() is typically called at the end of the web request
        pass
