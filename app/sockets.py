"""WebSocket event handlers and radio net session management for VirtualNet."""
from datetime import datetime
import random
import string

import eventlet
from flask import request
from flask_socketio import emit, join_room, leave_room
from pydantic import ValidationError

from app import socketio
from app.database import get_db
from app.models import NetSession, Station, Transmission, LogEntry, InstructorInject
from app.schemas import NetSessionCreate, LogEntryCreate

# Thread-safe in-memory mapping of socket session ID (sid) to station ID
sid_to_station_id = {}
station_id_to_sid = {}

# Fast-path in-memory mapping of transmitting SIDs to net_id (Zero-DB audio streaming)
transmitting_sids = {}

# Active radio checks state by net_id
# Format: { net_id: { "in_progress": bool, "sequence": [callsigns], "active_index": int,
#                     "defaulted": [callsigns], "completed": [callsigns], "timer_greenlet": greenlet } }
active_radio_checks = {}


def get_station_from_sid(db, sid):
    """Utility to look up the Station model from the active socket ID."""
    station_id = sid_to_station_id.get(sid)
    if not station_id:
        return None
    return db.query(Station).filter_by(id=station_id).first()


def broadcast_roster(db, net_id):
    """Utility to broadcast the updated roster to all active clients in the session room."""
    stations = db.query(Station).filter(
        Station.net_id == net_id,
        Station.status != "DISCONNECTED"
    ).all()

    roster = []
    for s in stations:
        roster.append({
            "stationId": s.id,
            "callSign": s.call_sign if s.call_sign else "",
            "nickname": s.nickname,
            "role": s.role,
            "status": s.status,
            "transmissionStatus": s.transmission_status,
            "signalQuality": s.signal_quality
        })

    # Broadcast to all clients in the net session room
    socketio.emit('roster_update', {"stations": roster}, room=net_id)


def start_radio_check_timer(net_id, active_callsign):
    """Starts a 5-second background timer for the active station's radio check response."""
    eventlet.sleep(5)

    # Check if this timer is still relevant (net session active and active station hasn't changed)
    check_state = active_radio_checks.get(net_id)
    if not check_state or not check_state["in_progress"]:
        return

    seq = check_state["sequence"]
    idx = check_state["active_index"]

    if idx < len(seq) and seq[idx] == active_callsign:
        # Station timed out / defaulted!
        db = get_db()
        try:
            # Mark station as defaulted
            check_state["defaulted"].append(active_callsign)

            # Advance index
            check_state["active_index"] += 1
            advance_radio_check(db, net_id)
            db.commit()
        # pylint: disable=broad-exception-caught
        except Exception:
            db.rollback()


def advance_radio_check(db, net_id):
    # pylint: disable=unused-argument
    """Advances the radio check to the next station in sequence or concludes it."""
    check_state = active_radio_checks.get(net_id)
    if not check_state or not check_state["in_progress"]:
        return

    seq = check_state["sequence"]
    idx = check_state["active_index"]

    # Cancel any running timer (only if it is not the current greenlet calling this)
    current_greenlet = eventlet.getcurrent()
    if check_state.get("timer_greenlet") and check_state["timer_greenlet"] != current_greenlet:
        check_state["timer_greenlet"].kill()
        check_state["timer_greenlet"] = None
    elif check_state.get("timer_greenlet") == current_greenlet:
        check_state["timer_greenlet"] = None

    if idx >= len(seq):
        # All stations have answered or defaulted! Conclude check.
        check_state["in_progress"] = False
        socketio.emit('radio_check_status', {
            "inProgress": False,
            "sequence": seq,
            "activeIndex": idx,
            "activeCallSign": None,
            "defaultedCallSigns": check_state["defaulted"],
            "completedCallSigns": check_state["completed"]
        }, room=net_id)

        # Clean up
        active_radio_checks.pop(net_id, None)
        return

    next_callsign = seq[idx]

    # Broadcast current status to all stations
    socketio.emit('radio_check_status', {
        "inProgress": True,
        "sequence": seq,
        "activeIndex": idx,
        "activeCallSign": next_callsign,
        "defaultedCallSigns": check_state["defaulted"],
        "completedCallSigns": check_state["completed"],
        "timerRemainingSeconds": 5
    }, room=net_id)

    # Spawn 5-second timeout timer in a background greenlet
    check_state["timer_greenlet"] = eventlet.spawn(start_radio_check_timer, net_id, next_callsign)


@socketio.on('connect')
def handle_connect():
    """Client connected socket event."""


@socketio.on('disconnect')
def handle_disconnect():
    """Client disconnected socket event. Cleans up session records."""
    transmitting_sids.pop(request.sid, None)
    db = get_db()
    station = get_station_from_sid(db, request.sid)
    if station:
        net_id = station.net_id
        station.status = "DISCONNECTED"
        station.transmission_status = "IDLE"

        # Clean up global PTT lock if this station was speaking
        transmission = db.query(Transmission).filter_by(
            net_id=net_id,
            sender_call_sign=station.call_sign,
            end_time=None
        ).first()
        if transmission:
            transmission.end_time = datetime.utcnow()
            transmission.termination_reason = "DISCONNECTED"

        db.commit()

        # Clean up memory mapping
        station_id = station.id
        sid_to_station_id.pop(request.sid, None)
        station_id_to_sid.pop(station_id, None)

        # Broadcast roster update
        broadcast_roster(db, net_id)


@socketio.on('create_net')
def handle_create_net(data):
    """Instructor hosts a new net session."""
    db = get_db()
    try:
        validated = NetSessionCreate(**data)
    except ValidationError as e:
        emit('create_response', {"success": False, "reason": str(e)})
        return

    # Generate a unique 4-character alphanumeric PIN
    while True:
        pin = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
        existing = db.query(NetSession).filter_by(pin=pin).first()
        if not existing:
            break

    session = NetSession(
        name=validated.name,
        pin=pin,
        callsign_indicator=validated.callsign_indicator
    )
    db.add(session)
    db.commit()

    emit('create_response', {
        "success": True,
        "pin": pin,
        "netId": session.id,
        "netName": session.name
    })




@socketio.on('join_net')
def handle_join_net(data):
    """Station (student or instructor) joins a net session."""
    # pylint: disable=too-many-statements
    db = get_db()
    pin = data.get('pin', '').upper()
    nickname = data.get('nickname', '')
    role = data.get('role', 'SUB_STATION')  # CONTROL/INSTRUCTOR or SUB_STATION

    if nickname.upper() in ["INSTRUCTOR", "CONTROL"]:
        role = "CONTROL"

    session = db.query(NetSession).filter_by(pin=pin).first()
    if not session:
        emit('join_response', {"success": False, "reason": f"Invalid Net PIN '{pin}'."})
        return

    if session.status == "CLOSED":
        emit('join_response', {"success": False, "reason": "This net session has been closed."})
        return

    # Check if nickname is taken by an active connection
    active_station = db.query(Station).filter(
        Station.net_id == session.id,
        Station.nickname == nickname,
        Station.status != "DISCONNECTED"
    ).first()

    if active_station:
        emit('join_response', {"success": False, "reason": f"Nickname '{nickname}' is already in use."})
        return

    # Reconnect or create new station record
    station = db.query(Station).filter_by(net_id=session.id, nickname=nickname).first()
    if not station:
        station = Station(
            net_id=session.id,
            nickname=nickname,
            role=role,
            status="AWAITING_ASSIGNMENT"
        )
        db.add(station)
        db.flush()

    # If joining as instructor/control, bypass assignment queue
    if role in ["CONTROL", "INSTRUCTOR"]:
        station.status = "CONNECTED"
        station.call_sign = "CONTROL" if role == "CONTROL" else "INSTRUCTOR"
        station.role = role

    station.ip_address = request.remote_addr
    if station.status == "DISCONNECTED":
        station.status = "CONNECTED" if station.call_sign else "AWAITING_ASSIGNMENT"

    db.commit()

    # Link socket mapping
    sid_to_station_id[request.sid] = station.id
    station_id_to_sid[station.id] = request.sid

    # Join the SocketIO room for this session
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

    # Broadcast roster update (only active/assigned stations will be visible to students)
    broadcast_roster(db, session.id)


@socketio.on('assign_callsign')
def handle_assign_callsign(data):
    """Instructor binds a tactical call sign to a nickname and unlocks their student dashboard."""
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["CONTROL", "INSTRUCTOR"]:
        emit('error', {"reason": "Unauthorized action."})
        return

    station_id = data.get('stationId')
    raw_callsign = data.get('callSign', '').upper()
    role = data.get('role', 'SUB_STATION')

    station = db.query(Station).filter_by(id=station_id).first()
    if not station:
        emit('error', {"reason": "Station not found."})
        return

    session = db.query(NetSession).filter_by(id=station.net_id).first()

    # Clean up and prepend Callsign Indicator prefix if callsign is purely numerical
    cleaned_callsign = raw_callsign.strip()
    if cleaned_callsign.isdigit():
        cleaned_callsign = f"{session.callsign_indicator}{cleaned_callsign}"

    # Verify uniqueness of callsign in this net session
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

    # Notify student client that they have been assigned and unlocked
    student_sid = station_id_to_sid.get(station.id)
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

    # Broadcast updated roster to the whole room
    broadcast_roster(db, session.id)


@socketio.on('ptt_request')
def handle_ptt_request(data):
    """Station requests frequency access to transmit voice."""
    # pylint: disable=too-many-statements,too-many-branches,unused-argument
    db = get_db()
    station = get_station_from_sid(db, request.sid)
    if not station or station.status == "AWAITING_ASSIGNMENT":
        emit('ptt_response', {"allowed": False, "reason": "Not connected or callsign not assigned."})
        return

    if station.status == "MUTED":
        emit('ptt_response', {"allowed": False, "reason": "You are muted by the instructor."})
        return

    net_id = station.net_id
    session = db.query(NetSession).filter_by(id=net_id).first()
    if session.status == "SUSPENDED":
        emit('ptt_response', {"allowed": False, "reason": "Net is currently suspended."})
        return

    # Check if there is an active speaker
    active_tx = db.query(Transmission).filter_by(net_id=net_id, end_time=None).first()

    if not active_tx:
        # Channel free, grant lock
        station.transmission_status = "TRANSMITTING"
        tx = Transmission(
            net_id=net_id,
            sender_call_sign=station.call_sign,
            start_time=datetime.utcnow()
        )
        db.add(tx)
        db.commit()

        # Register SID in zero-DB fast-path transmitting map
        transmitting_sids[request.sid] = net_id

        # Cancel radio check timer if the speaker is the active turn
        check_state = active_radio_checks.get(net_id)
        if check_state and check_state["in_progress"]:
            seq = check_state["sequence"]
            idx = check_state["active_index"]
            if idx < len(seq) and seq[idx] == station.call_sign:
                if check_state.get("timer_greenlet"):
                    check_state["timer_greenlet"].kill()
                    check_state["timer_greenlet"] = None

        emit('ptt_response', {"allowed": True, "transmissionId": tx.id})
        broadcast_roster(db, net_id)

    else:
        # Channel is busy. Check if requesting station is CONTROL (NCS Override / Break-In)
        if station.role == "CONTROL":
            # Cut off the current sender
            cur_sender = db.query(Station).filter_by(net_id=net_id, call_sign=active_tx.sender_call_sign).first()
            if cur_sender:
                cur_sender.transmission_status = "IDLE"

                # Emit override event to cut-off socket
                cur_sid = station_id_to_sid.get(cur_sender.id)
                if cur_sid:
                    transmitting_sids.pop(cur_sid, None)
                    socketio.emit('ptt_override', {"reason": "NCS_BREAK_IN"}, to=cur_sid)

            active_tx.end_time = datetime.utcnow()
            active_tx.termination_reason = "OVERRIDDEN"

            # Grant lock to CONTROL
            station.transmission_status = "TRANSMITTING"
            new_tx = Transmission(
                net_id=net_id,
                sender_call_sign=station.call_sign,
                start_time=datetime.utcnow()
            )
            db.add(new_tx)
            db.commit()

            # Register CONTROL SID in zero-DB fast-path transmitting map
            transmitting_sids[request.sid] = net_id

            emit('ptt_response', {"allowed": True, "transmissionId": new_tx.id})
            broadcast_roster(db, net_id)
        else:
            # Deny permission
            emit('ptt_response', {
                "allowed": False,
                "reason": f"Channel Busy - {active_tx.sender_call_sign} is currently transmitting."
            })


@socketio.on('ptt_release')
def handle_ptt_release(data):
    """Station releases PTT key, freeing the channel."""
    transmitting_sids.pop(request.sid, None)
    db = get_db()
    station = get_station_from_sid(db, request.sid)
    if not station:
        return

    net_id = station.net_id
    tx_id = data.get('transmissionId')

    tx = db.query(Transmission).filter_by(id=tx_id, end_time=None).first()
    if tx and tx.sender_call_sign == station.call_sign:
        tx.end_time = datetime.utcnow()
        tx.termination_reason = "PTT_RELEASED"
        station.transmission_status = "IDLE"
        db.commit()

        broadcast_roster(db, net_id)

        # Advance collective check if this station was the active responder
        check_state = active_radio_checks.get(net_id)
        if check_state and check_state["in_progress"]:
            seq = check_state["sequence"]
            idx = check_state["active_index"]
            if idx < len(seq) and seq[idx] == station.call_sign:
                check_state["completed"].append(station.call_sign)
                check_state["active_index"] += 1
                advance_radio_check(db, net_id)
                db.commit()


@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    """Broadcasts a binary audio chunk from speaker to all other stations."""
    # Data is binary: [4 bytes: Transmission ID] + [Remaining: audio frame]
    if not isinstance(data, (bytes, bytearray)) or len(data) < 4:
        return

    # Fast-path O(1) memory lookup - ZERO database queries per frame
    net_id = transmitting_sids.get(request.sid)
    if not net_id:
        return

    # Broadcast binary chunk to the room, excluding the sender
    emit('audio_chunk', data, room=net_id, include_self=False, binary=True)


@socketio.on('sync_log_entry')
def handle_sync_log_entry(data):
    """Saves or updates a log entry row, enforcing finality/immutability constraints."""
    db = get_db()
    station = get_station_from_sid(db, request.sid)
    if not station or station.status == "AWAITING_ASSIGNMENT":
        emit('sync_response', {"success": False, "reason": "Unauthorized log sync"})
        return

    try:
        validated = LogEntryCreate(**data.get('entry', {}))
    except ValidationError as e:
        emit('sync_response', {"success": False, "reason": str(e)})
        return

    net_id = data.get('netId')
    entry_id = data.get('entry', {}).get('entryId')

    # Look up existing entry in database
    existing = db.query(LogEntry).filter_by(id=entry_id).first()

    if existing:
        # Check if the existing entry is finalized (contains initials and complete details)
        # Finalized entries are immutable.
        if existing.operator_initials and len(existing.operator_initials) >= 2:
            emit('sync_response', {
                "success": False,
                "reason": "Log sheet entry is locked/finalized and cannot be modified."
            })
            return

        # Update draft
        existing.dtg = validated.dtg
        existing.from_call_sign = validated.from_call_sign
        existing.to_call_sign = validated.to_call_sign
        existing.precedence = validated.precedence
        existing.event_text = validated.event_text
        existing.operator_initials = validated.operator_initials
    else:
        # Create new log entry
        new_entry = LogEntry(
            id=entry_id,
            net_id=net_id,
            owner_station_id=station.id,
            dtg=validated.dtg,
            from_call_sign=validated.from_call_sign,
            to_call_sign=validated.to_call_sign,
            precedence=validated.precedence,
            event_text=validated.event_text,
            operator_initials=validated.operator_initials
        )
        db.add(new_entry)

    db.commit()
    emit('sync_response', {"success": True, "entryId": entry_id})


@socketio.on('start_radio_check')
def handle_start_radio_check(data):
    """CONTROL initiates a collective Radio Check."""
    # pylint: disable=unused-argument
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["CONTROL", "INSTRUCTOR"]:
        emit('error', {"reason": "Unauthorized action."})
        return

    net_id = instructor.net_id

    # Gather all active sub-stations (excluding instructor/control roles)
    active_stations = db.query(Station).filter(
        Station.net_id == net_id,
        Station.status == "CONNECTED",
        Station.role == "SUB_STATION"
    ).all()

    if not active_stations:
        emit('error', {"reason": "No active sub-stations on the net to check."})
        return

    # Sort stations alphabetically/alphanumerically by call sign
    stations_sorted = sorted(active_stations, key=lambda s: s.call_sign if s.call_sign else "")
    callsign_sequence = [s.call_sign for s in stations_sorted]

    # Clean up previous check if any
    prev_check = active_radio_checks.get(net_id)
    if prev_check and prev_check.get("timer_greenlet"):
        prev_check["timer_greenlet"].kill()

    # Set up active check state
    active_radio_checks[net_id] = {
        "in_progress": True,
        "sequence": callsign_sequence,
        "active_index": 0,
        "defaulted": [],
        "completed": [],
        "timer_greenlet": None
    }

    # Start turn sequence
    advance_radio_check(db, net_id)
    db.commit()


@socketio.on('set_signal_quality')
def handle_set_signal_quality(data):
    """Instructor alters signal quality for a student station."""
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["CONTROL", "INSTRUCTOR"]:
        emit('error', {"reason": "Unauthorized action."})
        return

    station_id = data.get('stationId')
    quality = data.get('signalQuality', 'OK')

    station = db.query(Station).filter_by(id=station_id).first()
    if station:
        station.signal_quality = quality
        db.commit()
        broadcast_roster(db, station.net_id)


@socketio.on('end_session')
def handle_end_session(data):
    """Instructor ends and terminates the net session. Purges ephemeral data."""
    # pylint: disable=unused-argument
    transmitting_sids.pop(request.sid, None)
    db = get_db()
    instructor = get_station_from_sid(db, request.sid)
    if not instructor or instructor.role not in ["CONTROL", "INSTRUCTOR"]:
        emit('error', {"reason": "Unauthorized action."})
        return

    net_id = instructor.net_id
    session = db.query(NetSession).filter_by(id=net_id).first()
    if session:
        session.status = "CLOSED"

        # Broadcast termination message
        socketio.emit('session_ended', {"reason": "SESSION_CLOSED_BY_INSTRUCTOR"}, room=net_id)

        # Clean up radio check timers
        check_state = active_radio_checks.get(net_id)
        if check_state and check_state.get("timer_greenlet"):
            check_state["timer_greenlet"].kill()
            active_radio_checks.pop(net_id, None)

        # Force disconnect sockets mapping
        stations = db.query(Station).filter_by(net_id=net_id).all()
        for s in stations:
            sid = station_id_to_sid.get(s.id)
            if sid:
                leave_room(net_id, sid=sid)
                sid_to_station_id.pop(sid, None)
                station_id_to_sid.pop(s.id, None)
                transmitting_sids.pop(sid, None)

        # Ephemeral Purge
        db.query(InstructorInject).filter_by(net_id=net_id).delete()
        db.query(LogEntry).filter_by(net_id=net_id).delete()
        db.query(Transmission).filter_by(net_id=net_id).delete()
        db.query(Station).filter_by(net_id=net_id).delete()
        db.delete(session)

        db.commit()
