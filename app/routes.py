from flask import Blueprint, render_template, jsonify, send_from_directory, current_app
from app.database import get_db
from app.models import NetSession, LogEntry, Station

bp = Blueprint('routes', __name__)

@bp.route('/')
def index():
    """Serves the main application page."""
    # Since we are using standard static HTML, we will serve index.html
    return current_app.send_static_file('templates/index.html')

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
