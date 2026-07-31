"""Service module for managing net sessions creation, management, and termination."""
import random
import string
from flask_socketio import join_room, leave_room
from pydantic import ValidationError
from app import socketio
from app.models import NetSession, Station, InstructorInject, LogEntry, Transmission
from app.schemas import NetSessionCreate
from app.services.pin_service import verify_instructor_pin


def generate_unique_net_pin(db) -> str:
    """Generate a unique 4-character alphanumeric PIN."""
    while True:
        pin = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
        existing = db.query(NetSession).filter_by(pin=pin).first()
        if not existing:
            return pin


def create_net_session(db, data: dict, client_info: dict, station_registry, broadcast_roster):
    """Host a new net session and initialize SUNRAY station."""
    remote_addr = client_info.get('remote_addr')
    sid = client_info.get('sid')

    try:
        validated = NetSessionCreate(**data)
    except ValidationError as e:
        return {"success": False, "reason": str(e)}

    if not verify_instructor_pin(validated.instructor_pin):
        return {"success": False, "reason": "Invalid 6-digit Instructor PIN for today."}

    pin = generate_unique_net_pin(db)
    session = NetSession(
        name=validated.name,
        pin=pin,
        callsign_indicator=validated.callsign_indicator
    )
    db.add(session)
    db.flush()

    raw_cs = (validated.sunray_callsign or "0").strip().upper()
    if raw_cs.isdigit() and validated.callsign_indicator:
        sunray_callsign = f"{validated.callsign_indicator}{raw_cs}"
    else:
        sunray_callsign = raw_cs

    station = Station(
        net_id=session.id,
        nickname="SUNRAY",
        role="SUNRAY",
        call_sign=sunray_callsign,
        status="CONNECTED",
        ip_address=remote_addr
    )
    db.add(station)
    db.commit()

    station_registry.register(sid, station.id, session.id)
    join_room(session.id)

    broadcast_roster(db, session.id)

    return {
        "success": True,
        "pin": pin,
        "netId": session.id,
        "netName": session.name,
        "stationId": station.id,
        "role": "SUNRAY",
        "callSign": sunray_callsign,
        "status": "CONNECTED"
    }


def end_net_session(db, instructor_station: Station, station_registry, transmission_service):
    """End a net session and purge all ephemeral data."""
    if not instructor_station or instructor_station.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        return {"success": False, "reason": "Unauthorized action."}

    net_id = instructor_station.net_id
    session = db.query(NetSession).filter_by(id=net_id).first()
    if session:
        session.status = "CLOSED"
        socketio.emit('session_ended', {"reason": "SESSION_CLOSED_BY_SUNRAY"}, room=net_id)

        stations = db.query(Station).filter_by(net_id=net_id).all()
        for s in stations:
            sid = station_registry.get_sid(s.id)
            if sid:
                leave_room(net_id, sid=sid)
                transmission_service.unregister_transmitting_sid(sid)
                station_registry.unregister_sid(sid)

        # Ephemeral Purge
        db.query(InstructorInject).filter_by(net_id=net_id).delete()
        db.query(LogEntry).filter_by(net_id=net_id).delete()
        db.query(Transmission).filter_by(net_id=net_id).delete()
        db.query(Station).filter_by(net_id=net_id).delete()
        db.delete(session)
        db.commit()

    return {"success": True}
