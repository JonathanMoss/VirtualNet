"""HTTP routes and API endpoints for VirtualNet."""
import os
import markdown
from sqlalchemy import text
from flask import Blueprint, jsonify, render_template, request
from app.database import get_db, db_session
from app.models import NetSession, Station, Transmission
from app.services import transmission_service
from app.services.transmission_service import format_transmission_dtg

bp = Blueprint('routes', __name__)
DOCS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'docs'))


@bp.route('/healthz')
def health_check():
    """Liveness and readiness container health check probe endpoint."""
    try:
        db_session.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as err:  # pylint: disable=broad-exception-caught
        db_status = f"error: {str(err)}"
        return jsonify({"status": "unhealthy", "database": db_status}), 500

    return jsonify({"status": "ok", "database": db_status}), 200


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

    html_content = markdown.markdown(
        md_text,
        extensions=['fenced_code', 'tables', 'nl2br', 'toc', 'attr_list']
    )
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


@bp.route('/guide/<guide_id>')
def custom_guide(guide_id):
    """Serves user guides dynamically or returns 404 if guide is invalid."""
    guides = {
        'student': ('student_guide.md', 'Student User Guide', 'STUDENT GUIDE'),
        'sunray': ('sunray_guide.md', 'Sunray User Guide', 'SUNRAY GUIDE')
    }
    if guide_id in guides:
        filename, title, guide_type = guides[guide_id]
        return render_guide_markdown(filename, title, guide_id, guide_type)

    return render_template(
        'guide_layout.html',
        title='Guide Not Found',
        guide_id=guide_id,
        guide_type='NOT FOUND',
        content='<h2>404 - Guide Not Found</h2><p>The requested guide documentation does not exist.</p>'
    ), 404


@bp.route('/favicon.ico')
def favicon():
    """Serves a blank 204 response for favicon requests."""
    return '', 204



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


@bp.route('/api/session/<pin>/transmissions', methods=['GET', 'DELETE'])
def session_transmissions(pin):
    """API endpoint to get or clear completed transmission log for Sunray review."""
    db = get_db()
    session = db.query(NetSession).filter_by(pin=pin.upper()).first()
    if not session:
        return jsonify({"error": "Session not found"}), 404

    if request.method == 'DELETE':
        transmission_service.clear_session_transmissions(db, session.id)
        return jsonify({"pin": pin, "status": "cleared", "transmissions": []})

    transmissions = db.query(Transmission).filter(
        Transmission.net_id == session.id,
        Transmission.end_time.isnot(None)
    ).order_by(Transmission.start_time.desc()).all()

    tx_data = []
    for tx in transmissions:
        duration_sec = round((tx.end_time - tx.start_time).total_seconds(), 1)
        status_str = transmission_service.get_tx_status_string(tx.id, tx)
        rx_summary = transmission_service.get_rx_summary_string(tx.id)
        tx_data.append({
            "id": tx.id,
            "transmissionId": tx.id,
            "callSign": tx.sender_call_sign,
            "dtg": format_transmission_dtg(tx.start_time),
            "duration": f"{duration_sec}s",
            "reason": tx.termination_reason or status_str,
            "status": status_str,
            "rxSummary": rx_summary,
            "startTime": tx.start_time.isoformat(),
            "endTime": tx.end_time.isoformat()
        })

    return jsonify({"pin": pin, "transmissions": tx_data})
