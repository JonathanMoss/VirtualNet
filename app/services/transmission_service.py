"""Service module for managing voice PTT transmissions and audio routing."""
from datetime import datetime
import eventlet
from app import socketio
from app.database import get_db
from app.models import Transmission, Station

MAX_TRANSMISSION_SECONDS = 20

# Fast-path in-memory mapping of transmitting SIDs to net_id (Zero-DB audio streaming)
transmitting_sids = {}


def unregister_transmitting_sid(sid: str):
    """Remove SID from transmitting fast-path mapping."""
    transmitting_sids.pop(sid, None)


def register_transmitting_sid(sid: str, net_id: str):
    """Register SID in transmitting fast-path mapping."""
    transmitting_sids[sid] = net_id


def get_audio_net_id(sid: str, station_registry):
    """Get net ID for audio streaming using fast path O(1) lookup or registry fallback."""
    return transmitting_sids.get(sid) or station_registry.get_net_id(sid)


def transmission_timeout_timer(tx_id: str, net_id: str, sid: str, broadcast_roster):
    """Wait 20s; if transmission is still active, terminate and trigger Enemy Direction Finding Alert."""
    eventlet.sleep(MAX_TRANSMISSION_SECONDS)
    db = get_db()
    try:
        tx = db.query(Transmission).filter_by(id=tx_id, end_time=None).first()
        if tx:
            tx.end_time = datetime.utcnow()
            tx.termination_reason = "MAX_DURATION_EXCEEDED"
            sender = db.query(Station).filter_by(net_id=net_id, call_sign=tx.sender_call_sign).first()
            if sender:
                sender.transmission_status = "IDLE"
            db.commit()

            unregister_transmitting_sid(sid)
            socketio.emit('ptt_timeout', {
                "reason": "Enemy Direction Finding Alert!",
                "transmissionId": tx_id
            }, to=sid)
            broadcast_roster(db, net_id)
    # pylint: disable=broad-exception-caught
    except Exception:
        db.rollback()


def grant_ptt_lock(db, station: Station, sid: str, net_id: str, broadcast_roster):
    """Grant PTT lock to station and spawn 20-second timeout timer."""
    station.transmission_status = "TRANSMITTING"
    tx = Transmission(
        net_id=net_id,
        sender_call_sign=station.call_sign,
        start_time=datetime.utcnow()
    )
    db.add(tx)
    db.commit()

    register_transmitting_sid(sid, net_id)
    broadcast_roster(db, net_id)
    eventlet.spawn(transmission_timeout_timer, tx.id, net_id, sid, broadcast_roster)
    return {"allowed": True, "transmissionId": tx.id}


def handle_ptt_request(db, station: Station, sid: str, station_registry, broadcast_roster):
    """Process PTT request from a station, enforcing lock availability and SUNRAY override."""
    if not station or station.status == "AWAITING_ASSIGNMENT":
        return {"allowed": False, "reason": "Not connected or callsign not assigned."}

    if station.status == "MUTED":
        return {"allowed": False, "reason": "You are muted by the instructor."}

    net_id = station.net_id
    session = station.net_session
    if session and session.status == "SUSPENDED":
        return {"allowed": False, "reason": "Net is currently suspended."}

    active_tx = db.query(Transmission).filter_by(net_id=net_id, end_time=None).first()

    if not active_tx:
        return grant_ptt_lock(db, station, sid, net_id, broadcast_roster)

    # Channel busy - check if requesting station is SUNRAY (NCS Break-In Override)
    if station.role in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        cur_sender = db.query(Station).filter_by(net_id=net_id, call_sign=active_tx.sender_call_sign).first()
        if cur_sender:
            cur_sender.transmission_status = "IDLE"
            cur_sid = station_registry.get_sid(cur_sender.id)
            if cur_sid:
                unregister_transmitting_sid(cur_sid)
                socketio.emit('ptt_override', {"reason": "NCS_BREAK_IN"}, to=cur_sid)

        active_tx.end_time = datetime.utcnow()
        active_tx.termination_reason = "OVERRIDDEN"
        db.commit()

        return grant_ptt_lock(db, station, sid, net_id, broadcast_roster)

    return {
        "allowed": False,
        "reason": f"Channel Busy - {active_tx.sender_call_sign} is currently transmitting."
    }


def handle_ptt_release(db, station: Station, tx_id: str, sid: str, broadcast_roster):
    """Process PTT key release from a transmitting station."""
    unregister_transmitting_sid(sid)
    if not station:
        return

    net_id = station.net_id
    tx = db.query(Transmission).filter_by(id=tx_id, end_time=None).first()
    if tx and tx.sender_call_sign == station.call_sign:
        tx.end_time = datetime.utcnow()
        tx.termination_reason = "PTT_RELEASED"
        station.transmission_status = "IDLE"
        db.commit()
        broadcast_roster(db, net_id)
