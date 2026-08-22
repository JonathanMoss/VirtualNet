# pylint: disable=duplicate-code
"""Service module for managing net sessions creation, management, and termination."""
import random
import string
from datetime import datetime
from flask_socketio import join_room, leave_room
from pydantic import ValidationError
from app import socketio
from app.models import NetSession, Station, InstructorInject, Transmission
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


def restore_or_recreate_sunray_session(db, pin: str, instructor_pin: str, nickname: str,
                                       client_info: dict, station_registry, broadcast_roster):
    # pylint: disable=too-many-arguments,too-many-positional-arguments
    """Restore an existing or recreate an ended SUNRAY net session if today's 6-digit PIN is valid."""
    if not verify_instructor_pin(instructor_pin):
        return {"success": False, "reason": "Invalid or expired 6-digit Instructor PIN for today."}

    remote_addr = client_info.get('remote_addr')
    sid = client_info.get('sid')

    # Look for existing NetSession by PIN
    session = db.query(NetSession).filter_by(pin=pin.upper()).first()
    if not session:
        session = NetSession(
            name=f"Net Session {pin.upper()}",
            pin=pin.upper(),
            callsign_indicator="R"
        )
        db.add(session)
        db.flush()
    else:
        session.status = "OPEN"

    sunray_callsign = f"{session.callsign_indicator}0" if session.callsign_indicator else "0"

    station = db.query(Station).filter(
        Station.net_id == session.id,
        Station.role.in_(["SUNRAY", "CONTROL", "INSTRUCTOR"])
    ).first()

    if not station:
        station = Station(
            net_id=session.id,
            nickname=nickname or "SUNRAY",
            role="SUNRAY",
            call_sign=sunray_callsign,
            status="CONNECTED",
            ip_address=remote_addr
        )
        db.add(station)
    else:
        station.status = "CONNECTED"
        station.ip_address = remote_addr
        station.last_seen = datetime.utcnow()

    db.commit()

    if sid:
        station_registry.register(sid, station.id, session.id)
        try:
            join_room(session.id)
        except (RuntimeError, KeyError, AttributeError):
            pass

    broadcast_roster(db, session.id)

    return {
        "success": True,
        "stationId": station.id,
        "status": "CONNECTED",
        "callSign": station.call_sign,
        "role": "SUNRAY",
        "netId": session.id,
        "netName": session.name,
        "netState": session.net_state,
        "callsignIndicator": session.callsign_indicator,
        "pin": session.pin
    }


def end_net_session_by_id(db, net_id: str, station_registry, transmission_service,
                         reason: str = "SESSION_CLOSED_BY_SUNRAY"):
    """End a net session by ID and purge all ephemeral data."""
    session = db.query(NetSession).filter_by(id=net_id).first()
    if session:
        session.status = "CLOSED"
        stations = db.query(Station).filter_by(net_id=net_id).all()
        for s in stations:
            sid = station_registry.get_sid(s.id)
            if sid:
                socketio.emit('session_ended', {"reason": reason}, to=sid)
                leave_room(net_id, sid=sid)
                transmission_service.unregister_transmitting_sid(sid)
                station_registry.unregister_sid(sid)

        # Ephemeral Purge
        db.query(InstructorInject).filter_by(net_id=net_id).delete()
        db.query(Transmission).filter_by(net_id=net_id).delete()
        db.query(Station).filter_by(net_id=net_id).delete()
        db.delete(session)
        db.commit()
    return {"success": True}


def end_net_session(db, instructor_station: Station, station_registry, transmission_service):
    """End a net session and purge all ephemeral data."""
    if not instructor_station or instructor_station.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        return {"success": False, "reason": "Unauthorized action."}

    return end_net_session_by_id(db, instructor_station.net_id, station_registry, transmission_service)


def check_and_purge_expired_sessions(db, station_registry, transmission_service):
    """Check active net sessions; if SUNRAY has been offline/inactive for > 60 mins (3600s), close and purge session."""
    now = datetime.utcnow()
    sessions = db.query(NetSession).filter(NetSession.status != "CLOSED").all()
    for s in sessions:
        sunray = db.query(Station).filter(
            Station.net_id == s.id,
            Station.role.in_(["SUNRAY", "CONTROL", "INSTRUCTOR"])
        ).first()
        if sunray:
            sunray_last_seen = sunray.last_seen or sunray.connected_at
            inactive_seconds = (now - sunray_last_seen).total_seconds()
            sunray_sid = station_registry.get_sid(sunray.id)
            # If SUNRAY has no active socket connection and last_seen > 60 minutes ago
            if not sunray_sid and inactive_seconds > 3600:
                end_net_session_by_id(
                    db,
                    s.id,
                    station_registry,
                    transmission_service,
                    reason="SESSION_EXPIRED_INACTIVITY"
                )
