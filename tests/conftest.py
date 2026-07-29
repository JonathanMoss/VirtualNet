"""Global Pytest configuration and path isolation setup."""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Ensure test database path is isolated for pytest execution.
os.environ.setdefault('DATABASE_URL', f'sqlite:///{ROOT}/virtualnet_test.db')
