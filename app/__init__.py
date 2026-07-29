"""Application factory and initialization module for VirtualNet."""
import os
from flask import Flask
from flask_socketio import SocketIO
from app.database import init_db, db_session

# Create SocketIO instance at module level (to be imported by sockets.py)
socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode='eventlet',
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


def create_app():
    """Create and configure the Flask application instance."""
    app = Flask(__name__, static_folder='../static', static_url_path='/static')
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
    socketio.init_app(app)

    # Import sockets inside create_app to register event handlers
    # pylint: disable=import-outside-toplevel,unused-import
    from . import sockets

    return app
