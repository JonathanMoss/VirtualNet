"""HTTP routes and API endpoints for VirtualNet."""
import os
import markdown
from flask import Blueprint, jsonify, render_template
from app.database import get_db
from app.models import NetSession, LogEntry, Station

bp = Blueprint('routes', __name__)
DOCS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'docs'))


def render_guide_markdown(filename, title, guide_id, guide_type):
    """Reads a markdown guide file and renders it using guide_layout.html."""
    filepath = os.path.join(DOCS_DIR, filename)
    if not os.path.exists(filepath):
        return render_template(
            'guide_layout.html',
            title=title,
            guide_id=guide_id,
            guide_type=guide_type,
            content="<p>Guide documentation file not found.</p>"
        ), 404

    with open(filepath, 'r', encoding='utf-8') as f:
        md_text = f.read()

    html_content = markdown.markdown(md_text, extensions=['fenced_code', 'tables', 'nl2br'])
    return render_template(
        'guide_layout.html',
        title=title,
        guide_id=guide_id,
        guide_type=guide_type,
        content=html_content
    )


@bp.route('/')
def index():
    """Serves the main application page."""
    return render_template('index.html')


@bp.route('/guide/student')
def student_guide():
    """Serves the Student User Guide rendered from Markdown."""
    return render_guide_markdown('student_guide.md', 'Student User Guide', 'student', 'STUDENT GUIDE')


@bp.route('/guide/sunray')
def sunray_guide():
    """Serves the Sunray (Instructor) User Guide rendered from Markdown."""
    return render_guide_markdown('sunray_guide.md', 'Sunray User Guide', 'sunray', 'SUNRAY GUIDE')


@bp.route('/favicon.ico')
def favicon():
    """Serves a blank 204 response for favicon requests."""
    return '', 204


@bp.route('/api/session/<pin>/logs')
def get_session_logs(pin):
    """API endpoint to get all log entries for a given session PIN (for instructor review)."""
    db = get_db()
    session = db.query(NetSession).filter_by(pin=pin.upper()).first()
    if not session:
        return jsonify({"error": "Session not found"}), 404

    logs = db.query(LogEntry).filter_by(net_id=session.id).order_by(LogEntry.created_at.asc()).all()

    # Group logs by station for easy comparison
    logs_data = []
    for log in logs:
        station = db.query(Station).filter_by(id=log.owner_station_id).first()
        logs_data.append({
            "id": log.id,
            "ownerCallSign": station.call_sign if station else "UNKNOWN",
            "ownerNickname": station.nickname if station else "UNKNOWN",
            "dtg": log.dtg,
            "fromCallSign": log.from_call_sign,
            "toCallSign": log.to_call_sign,
            "precedence": log.precedence,
            "eventText": log.event_text,
            "operatorInitials": log.operator_initials,
            "createdAt": log.created_at.isoformat()
        })
    return jsonify({"pin": pin, "logs": logs_data})


@bp.route('/api/session/<pin>/roster')
def get_session_roster(pin):
    """API endpoint to get the current active roster."""
    db = get_db()
    session = db.query(NetSession).filter_by(pin=pin.upper()).first()
    if not session:
        return jsonify({"error": "Session not found"}), 404

    stations = db.query(Station).filter_by(net_id=session.id).all()
    roster_data = [{
        "id": s.id,
        "nickname": s.nickname,
        "callSign": s.call_sign,
        "role": s.role,
        "status": s.status,
        "signalQuality": s.signal_quality,
        "transmissionStatus": s.transmission_status
    } for s in stations]

    return jsonify({"pin": pin, "roster": roster_data})
