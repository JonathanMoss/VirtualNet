"""Application factory and initialization module for VirtualNet."""
import os
import secrets

# pylint: disable=wrong-import-position,wrong-import-order
import eventlet
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO
from app.database import init_db, db_session

# Check for Redis URL for SocketIO message queue / PubSub multi-worker routing
REDIS_URL = os.environ.get('REDIS_URL')
ENABLE_REDIS_QUEUE = os.environ.get('ENABLE_REDIS_QUEUE', 'false').lower() in ('true', '1', 'yes')
IS_TESTING = os.environ.get('FLASK_ENV') in ('testing', 'test') or os.environ.get('TESTING') == '1'

# Create SocketIO instance at module level (to be imported by sockets.py)
socketio = SocketIO()

# Import sockets module at top level so event handlers register on socketio.handlers before init_app
# pylint: disable=wrong-import-position,unused-import
from . import sockets


def parse_cors_origins():
    """Parse CORS_ALLOWED_ORIGINS environment variable into string or origin list."""
    raw_cors = os.environ.get('CORS_ALLOWED_ORIGINS', '*').strip()
    if raw_cors == '*' or not raw_cors:
        return '*'
    origins = [origin.strip() for origin in raw_cors.split(',') if origin.strip()]
    return origins if len(origins) > 1 else (origins[0] if origins else '*')


def create_app(testing=False):
    """Create and configure the Flask application instance."""
    app = Flask(__name__, static_folder='../static', static_url_path='/static', template_folder='../static/templates')
    is_test_env = testing or IS_TESTING
    if is_test_env:
        app.config['TESTING'] = True
        app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'virtualnet-secret-key-1234')
    else:
        app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

    # Session Cookie Security Hardening
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    if not is_test_env and os.environ.get('FLASK_ENV') == 'production':
        app.config['SESSION_COOKIE_SECURE'] = True

    # Initialize Database Schema
    init_db()

    # Register Blueprints
    # pylint: disable=import-outside-toplevel
    from app.routes import bp as routes_bp
    app.register_blueprint(routes_bp)

    # Teardown database session at the end of each request/socket lifecycle
    @app.teardown_appcontext
    def shutdown_session(_exception=None):
        db_session.remove()

    # Apply Production HTTP Security Headers
    @app.after_request
    def apply_security_headers(response):
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Permissions-Policy'] = 'microphone=(self)'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        if not is_test_env and os.environ.get('FLASK_ENV') == 'production':
            response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        return response

    cors_allowed = parse_cors_origins()

    # Initialize SocketIO app context with full server configuration
    socketio.init_app(
        app,
        cors_allowed_origins=cors_allowed,
        async_mode='eventlet',
        message_queue=REDIS_URL if (REDIS_URL and ENABLE_REDIS_QUEUE and not is_test_env) else None,
        logger=False,
        engineio_logger=False,
        pingInterval=2,
        pingTimeout=10,
        max_http_buffer_size=2000000
    )

    return app
