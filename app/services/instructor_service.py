"""Service module for instructor dashboard telemetry, scenario inject management, and net state controls."""
# pylint: disable=duplicate-code
from pydantic import ValidationError
from app.models import NetSession, Station, InstructorInject, Transmission, LogEntry
from app.schemas import InstructorInjectCreate, NetStateUpdate


def get_net_telemetry(db, pin: str):
    """Retrieve comprehensive real-time telemetry for an active net session."""
    session = db.query(NetSession).filter_by(pin=pin.upper()).first()
    if not session:
        return {"success": False, "reason": f"Session not found for PIN '{pin}'."}

    stations = db.query(Station).filter_by(net_id=session.id).all()
    transmissions = db.query(Transmission).filter_by(
        net_id=session.id
    ).order_by(Transmission.start_time.desc()).all()
    injects = db.query(InstructorInject).filter_by(
        net_id=session.id
    ).order_by(InstructorInject.time_offset_seconds.asc()).all()
    logs = db.query(LogEntry).filter_by(net_id=session.id).order_by(LogEntry.created_at.asc()).all()

    active_transmitting = [s.call_sign or s.nickname for s in stations if s.transmission_status == "TRANSMITTING"]

    telemetry = {
        "success": True,
        "netId": session.id,
        "pin": session.pin,
        "netName": session.name,
        "netState": session.net_state,
        "callsignIndicator": session.callsign_indicator,
        "status": session.status,
        "startTime": session.start_time.isoformat() if session.start_time else None,
        "stationCount": len(stations),
        "activeSpeakers": active_transmitting,
        "stations": [{
            "id": s.id,
            "nickname": s.nickname,
            "callSign": s.call_sign,
            "role": s.role,
            "status": s.status,
            "transmissionStatus": s.transmission_status,
            "ipAddress": s.ip_address,
            "connectedAt": s.connected_at.isoformat() if s.connected_at else None,
            "lastSeen": s.last_seen.isoformat() if s.last_seen else None
        } for s in stations],
        "injects": [{
            "id": inj.id,
            "title": inj.title,
            "description": inj.description,
            "targetCallSign": inj.target_call_sign,
            "timeOffsetSeconds": inj.time_offset_seconds,
            "status": inj.status
        } for inj in injects],
        "recentTransmissions": [{
            "id": t.id,
            "senderCallSign": t.sender_call_sign,
            "startTime": t.start_time.isoformat() if t.start_time else None,
            "endTime": t.end_time.isoformat() if t.end_time else None,
            "terminationReason": t.termination_reason
        } for t in transmissions[:10]],
        "logCount": len(logs)
    }

    return telemetry


def create_inject(db, net_id: str, inject_payload: dict):
    """Create a new training scenario inject for a net session."""
    try:
        validated = InstructorInjectCreate(**inject_payload)
    except ValidationError as e:
        return {"success": False, "reason": str(e)}

    session = db.query(NetSession).filter_by(id=net_id).first()
    if not session:
        return {"success": False, "reason": "Net session not found."}

    target_cs = str(validated.target_call_sign).upper() if validated.target_call_sign else None

    inject = InstructorInject(
        net_id=net_id,
        title=validated.title,
        description=validated.description,
        target_call_sign=target_cs,
        time_offset_seconds=validated.time_offset_seconds,
        status="PENDING"
    )
    db.add(inject)
    db.commit()

    return {
        "success": True,
        "inject": {
            "id": inject.id,
            "netId": inject.net_id,
            "title": inject.title,
            "description": inject.description,
            "targetCallSign": inject.target_call_sign,
            "timeOffsetSeconds": inject.time_offset_seconds,
            "status": inject.status
        }
    }


def get_injects(db, net_id: str):
    """Retrieve all injects for a net session."""
    injects = db.query(InstructorInject).filter_by(
        net_id=net_id
    ).order_by(InstructorInject.time_offset_seconds.asc()).all()
    return [{
        "id": inj.id,
        "netId": inj.net_id,
        "title": inj.title,
        "description": inj.description,
        "targetCallSign": inj.target_call_sign,
        "timeOffsetSeconds": inj.time_offset_seconds,
        "status": inj.status
    } for inj in injects]


def dispatch_inject(db, inject_id: str):
    """Mark an inject as DISPATCHED and return details for broadcasting."""
    inject = db.query(InstructorInject).filter_by(id=inject_id).first()
    if not inject:
        return {"success": False, "reason": f"Inject '{inject_id}' not found."}

    inject.status = "DISPATCHED"
    db.commit()

    return {
        "success": True,
        "inject": {
            "id": inject.id,
            "netId": inject.net_id,
            "title": inject.title,
            "description": inject.description,
            "targetCallSign": inject.target_call_sign,
            "timeOffsetSeconds": inject.time_offset_seconds,
            "status": inject.status
        }
    }


def delete_inject(db, inject_id: str):
    """Delete an inject from a net session."""
    inject = db.query(InstructorInject).filter_by(id=inject_id).first()
    if not inject:
        return {"success": False, "reason": f"Inject '{inject_id}' not found."}

    db.delete(inject)
    db.commit()
    return {"success": True, "injectId": inject_id}


def set_net_state(db, net_id: str, new_state: str):
    """Update the net operational state (FREE vs DIRECTED)."""
    try:
        validated = NetStateUpdate(net_state=new_state)
    except ValidationError as e:
        return {"success": False, "reason": str(e)}

    session = db.query(NetSession).filter_by(id=net_id).first()
    if not session:
        return {"success": False, "reason": "Net session not found."}

    session.net_state = validated.net_state
    db.commit()

    return {"success": True, "netState": session.net_state}
