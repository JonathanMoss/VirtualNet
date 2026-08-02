"""WebSocket event handlers and radio net session management for VirtualNet."""
from flask import request
from flask_socketio import emit, join_room
from app import socketio
from app.database import get_db
from app.models import Station
from app.services import (
    pin_service,
    station_service,
    transmission_service,
    log_service,
    session_service,
    instructor_service,
)

# Re-export dictionary mappings and functions for backward compatibility with existing tests
registry = station_service.registry
sid_to_station_id = registry.sid_to_station_id
station_id_to_sid = registry.station_id_to_sid
sid_to_net_id = registry.sid_to_net_id
transmitting_sids = transmission_service.transmitting_sids

get_station_from_sid = station_service.get_station_from_sid
broadcast_roster = station_service.broadcast_roster
verify_instructor_pin = pin_service.verify_instructor_pin


@socketio.on('connect')
def handle_connect():
    """Client connected socket event."""


@socketio.on('disconnect')
def handle_disconnect():
    """Client disconnected socket event. Sets status to UNWORKABLE during 30s grace period."""
    db = get_db()
    station_service.process_station_disconnect(db, request.sid, transmission_service)


@socketio.on('leave_net')
def handle_leave_net(data):
    """Station explicitly leaves the net session. If SUNRAY leaves, terminate net session."""
    # pylint: disable=unused-argument
    db = get_db()
    station_service.process_station_leave(db, request.sid, transmission_service, session_service)


@socketio.on('create_net')
def handle_create_net(data):
    """SUNRAY hosts a new net session."""
    db = get_db()
    client_info = {"remote_addr": request.remote_addr, "sid": request.sid}
    res = session_service.create_net_session(
        db,
        data,
        client_info,
        registry,
        broadcast_roster
    )
    emit('create_response', res)


@socketio.on('join_net')
def handle_join_net(data):
    """Station (student or SUNRAY) joins a net session."""
    db = get_db()
    pin = data.get('pin', '').upper()
    nickname = data.get('nickname', '')
    role = data.get('role', 'SUB_STATION')

    if nickname.upper() in ["INSTRUCTOR", "CONTROL", "SUNRAY"]:
        role = "SUNRAY"

    session = db.query(session_service.NetSession).filter_by(pin=pin).first()
    if not session:
        emit('join_response', {"success": False, "reason": f"Invalid Net PIN '{pin}'."})
        return

    if session.status == "CLOSED":
        emit('join_response', {"success": False, "reason": "This net session has been closed."})
        return

    provided_station_id = data.get('stationId')
    station = station_service.find_existing_station(db, session.id, nickname, role, provided_station_id)

    if station_service.check_duplicate_active_station(station, request.sid, provided_station_id):
        emit('join_response', {"success": False, "reason": f"NICK '{nickname}' is already in use."})
        return

    station_info = {"nickname": nickname, "role": role, "remote_addr": request.remote_addr}
    station = station_service.bind_or_create_station(db, session.id, station_info, station)

    registry.register(request.sid, station.id, session.id)
    join_room(session.id)

    emit('join_response', {
        "success": True,
        "stationId": station.id,
        "status": station.status,
        "callSign": station.call_sign,
        "role": station.role,
        "netId": session.id,
        "netName": session.name,
        "netState": session.net_state,
        "callsignIndicator": session.callsign_indicator,
        "pin": session.pin
    })

    broadcast_roster(db, session.id)


@socketio.on('assign_callsign')
def handle_assign_callsign(data):
    """SUNRAY binds a tactical call sign to a NICK and unlocks their student dashboard."""
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        emit('error', {"reason": "Unauthorized action."})
        return

    station_id = data.get('stationId')
    raw_callsign = data.get('callSign', '').upper()
    role = data.get('role', 'SUB_STATION')

    station = db.query(Station).filter_by(id=station_id).first()
    if not station:
        emit('error', {"reason": "Station not found."})
        return

    session = station.net_session
    cleaned_callsign = raw_callsign.strip()
    if cleaned_callsign.isdigit():
        cleaned_callsign = f"{session.callsign_indicator}{cleaned_callsign}"

    duplicate = db.query(Station).filter(
        Station.net_id == session.id,
        Station.call_sign == cleaned_callsign,
        Station.id != station_id,
        Station.status != "DISCONNECTED"
    ).first()
    if duplicate:
        emit('error', {"reason": f"Callsign '{cleaned_callsign}' is already assigned."})
        return

    station.call_sign = cleaned_callsign
    station.status = "CONNECTED"
    station.role = role
    db.commit()

    student_sid = registry.get_sid(station.id)
    if student_sid:
        socketio.emit('callsign_assigned', {
            "success": True,
            "assignedCallSign": station.call_sign,
            "role": station.role,
            "netSession": {
                "netId": session.id,
                "netName": session.name,
                "netState": session.net_state
            }
        }, to=student_sid)

    broadcast_roster(db, session.id)


@socketio.on('kick_station')
def handle_kick_station(data):
    """SUNRAY forcibly kicks a student station from the net session."""
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        emit('error', {"reason": "Unauthorized action."})
        return

    station_id = data.get('stationId')
    station = db.query(Station).filter_by(id=station_id).first()
    if not station:
        emit('error', {"reason": "Station not found."})
        return

    target_sid = registry.get_sid(station.id)
    net_id = station.net_id
    station_service.detach_station(db, station, "DISCONNECTED")
    if target_sid:
        registry.unregister_sid(target_sid)
        socketio.emit('kicked', {"reason": "You have been kicked from the net session by SUNRAY."}, to=target_sid)

    broadcast_roster(db, net_id)


@socketio.on('ptt_request')
def handle_ptt_request(data):
    """Station requests frequency access to transmit voice."""
    # pylint: disable=unused-argument
    db = get_db()
    station = get_station_from_sid(db, request.sid)
    res = transmission_service.handle_ptt_request(db, station, request.sid, registry, broadcast_roster)
    emit('ptt_response', res)


@socketio.on('ptt_release')
def handle_ptt_release(data):
    """Station releases PTT key, freeing the channel."""
    db = get_db()
    station = get_station_from_sid(db, request.sid)
    tx_id = data.get('transmissionId') if data else None
    transmission_service.handle_ptt_release(db, station, tx_id, request.sid, broadcast_roster)


@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    """Broadcasts a binary audio chunk from speaker to all other stations."""
    if not isinstance(data, (bytes, bytearray)) or len(data) < 4:
        return

    net_id = transmission_service.get_audio_net_id(request.sid, registry)
    if not net_id:
        return

    emit('audio_chunk', data, room=net_id, include_self=False, binary=True)


@socketio.on('sync_log_entry')
def handle_sync_log_entry(data):
    """Saves or updates a log entry row, enforcing finality/immutability constraints."""
    db = get_db()
    station = get_station_from_sid(db, request.sid)
    net_id = data.get('netId')
    entry_payload = data.get('entry', {})
    entry_id = entry_payload.get('entryId')

    res = log_service.sync_log_entry(db, station, net_id, entry_id, entry_payload)
    emit('sync_response', res)


@socketio.on('create_inject')
def handle_create_inject(data):
    """SUNRAY creates a training scenario inject."""
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        emit('create_inject_response', {"success": False, "reason": "Unauthorized action."})
        return

    res = instructor_service.create_inject(db, instructor.net_id, data or {})
    emit('create_inject_response', res)
    if res.get("success"):
        # Broadcast updated telemetry to instructor
        session = db.query(session_service.NetSession).filter_by(id=instructor.net_id).first()
        if session:
            telemetry = instructor_service.get_net_telemetry(db, session.pin)
            emit('telemetry_update', telemetry, room=instructor.net_id)


@socketio.on('dispatch_inject')
def handle_dispatch_inject(data):
    """SUNRAY dispatches a training scenario inject to the net."""
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        emit('dispatch_inject_response', {"success": False, "reason": "Unauthorized action."})
        return

    inject_id = data.get('injectId') if data else None
    res = instructor_service.dispatch_inject(db, inject_id)
    emit('dispatch_inject_response', res)

    if res.get("success"):
        # Broadcast inject alert to all stations in the net session
        emit('inject_dispatched', res.get("inject"), room=instructor.net_id)


@socketio.on('delete_inject')
def handle_delete_inject(data):
    """SUNRAY deletes an un-dispatched scenario inject."""
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        emit('delete_inject_response', {"success": False, "reason": "Unauthorized action."})
        return

    inject_id = data.get('injectId') if data else None
    res = instructor_service.delete_inject(db, inject_id)
    emit('delete_inject_response', res)


@socketio.on('set_net_state')
def handle_set_net_state(data):
    """SUNRAY toggles net operational mode (FREE vs DIRECTED)."""
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        emit('set_net_state_response', {"success": False, "reason": "Unauthorized action."})
        return

    new_state = data.get('netState', 'DIRECTED') if data else 'DIRECTED'
    res = instructor_service.set_net_state(db, instructor.net_id, new_state)
    emit('set_net_state_response', res)

    if res.get("success"):
        socketio.emit('net_state_changed', {"netState": res.get("netState")}, room=instructor.net_id)


@socketio.on('request_telemetry')
def handle_request_telemetry(data):
    """SUNRAY requests real-time net telemetry update."""
    # pylint: disable=unused-argument
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        emit('telemetry_update', {"success": False, "reason": "Unauthorized action."})
        return

    session = db.query(session_service.NetSession).filter_by(id=instructor.net_id).first()
    if session:
        telemetry = instructor_service.get_net_telemetry(db, session.pin)
        emit('telemetry_update', telemetry)


@socketio.on('end_session')
def handle_end_session(data):
    """SUNRAY ends and terminates the net session. Purges ephemeral data."""
    # pylint: disable=unused-argument
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    res = session_service.end_net_session(db, instructor, registry, transmission_service)
    if not res.get("success"):
        emit('error', {"reason": res.get("reason", "Unauthorized action.")})
