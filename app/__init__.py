"""Application factory and initialization module for VirtualNet."""
import os
from flask import Flask
from flask_socketio import SocketIO
from app.database import init_db, db_session

# Check for Redis URL for SocketIO message queue / PubSub multi-worker routing
REDIS_URL = os.environ.get('REDIS_URL')
IS_TESTING = os.environ.get('FLASK_ENV') in ('testing', 'test') or os.environ.get('TESTING') == '1'

# Create SocketIO instance at module level (to be imported by sockets.py)
# Note: message_queue is disabled when TESTING is set to support SocketIOTestClient
socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode='eventlet',
    message_queue=REDIS_URL if (REDIS_URL and not IS_TESTING) else None,
    logger=False,
    engineio_logger=False,
    engineio_options={
        'transports': ['websocket', 'polling'],
        'allow_upgrades': True,
        'pingInterval': 2,
        'pingTimeout': 10,
        'max_http_buffer_size': 2000000
    }
)


def create_app(testing=False):
    """Create and configure the Flask application instance."""
    app = Flask(__name__, static_folder='../static', static_url_path='/static')
    if testing or IS_TESTING:
        app.config['TESTING'] = True
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'virtualnet-secret-key-1234')

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

    # Initialize SocketIO app context
    app.extensions['socketio'] = socketio
    if not hasattr(socketio, 'server') or socketio.server is None:
        socketio.init_app(app)
    else:
        socketio.app = app

    # Import sockets inside create_app to register event handlers
    # pylint: disable=import-outside-toplevel,unused-import
    from . import sockets

    return app
