"""Service module for managing voice PTT transmissions and audio routing."""
import time
from datetime import datetime
import eventlet
from app import socketio
from app.database import get_db
from app.models import Transmission, Station

MAX_TRANSMISSION_SECONDS = 20

# Fast-path in-memory mapping of transmitting SIDs to net_id (Zero-DB audio streaming)
transmitting_sids = {}
grace_sids = {}  # {sid: (net_id, expiry_timestamp)}
active_tx_receipts = {}
# {tx_id: {"net_id": net_id, "sender_callsign": cs, "status": "TRANSMITTING"}}


def format_transmission_dtg(dt: datetime) -> str:
    """Format datetime into military DTG string: DDHHMMZ MON YY."""
    if not dt:
        dt = datetime.utcnow()
    months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    return f"{dt.strftime('%d%H%M')}Z {months[dt.month - 1]} {dt.strftime('%y')}"


def get_rx_summary_string(tx_id: str) -> str:
    """Returns formatted receipt summary: 'ALL CALLSIGNS R/X' or 'NOT R/X: R12, R15'."""
    receipt_data = active_tx_receipts.get(tx_id)
    if not receipt_data:
        return "ALL CALLSIGNS R/X"
    expected = receipt_data.get("expected_callsigns", set())
    received = receipt_data.get("received_callsigns", set())
    if not expected:
        return "ALL CALLSIGNS R/X"
    missing = expected - received
    if not missing:
        return "ALL CALLSIGNS R/X"
    return f"NOT R/X: {', '.join(sorted(list(missing)))}"


def get_tx_status_string(tx_id: str, tx: Transmission = None) -> str:
    """Returns transmission status string ('TRANSMITTING', 'PTT RELEASED', 'COMPLETED', etc.)."""
    receipt_data = active_tx_receipts.get(tx_id)
    if receipt_data and receipt_data.get("status"):
        return receipt_data["status"]
    if tx:
        if tx.termination_reason:
            if tx.termination_reason == "PTT_RELEASED":
                return "PTT RELEASED"
            return tx.termination_reason
        return "PTT RELEASED" if tx.end_time else "TRANSMITTING"
    return "PTT RELEASED"


def clear_session_transmissions(db, net_id: str):
    """Delete all completed/active transmission records for a session and broadcast log cleared event."""
    db.query(Transmission).filter_by(net_id=net_id).delete()
    db.commit()

    tx_ids_to_remove = [tx_id for tx_id, r in active_tx_receipts.items() if r.get("net_id") == net_id]
    for tx_id in tx_ids_to_remove:
        active_tx_receipts.pop(tx_id, None)

    socketio.emit('sunray_tx_log_cleared', {}, room=net_id)


def record_audio_rx_playback_complete(db, tx_id: str, callsign: str, net_id: str = None):
    """Record station audio playback receipt for tx_id and broadcast updated summary to SUNRAY."""
    if not callsign:
        return

    clean_callsign = callsign.strip().upper()

    target_tx_id = tx_id
    if not target_tx_id or target_tx_id not in active_tx_receipts:
        target_net_id = net_id
        if not target_net_id and db:
            station = db.query(Station).filter(
                Station.call_sign == clean_callsign,
                ~Station.status.in_(["LEFT", "DISCONNECTED"])
            ).order_by(Station.connected_at.desc()).first()
            target_net_id = station.net_id if station else None

        for active_id, receipt in reversed(list(active_tx_receipts.items())):
            if target_net_id and receipt.get("net_id") == target_net_id:
                target_tx_id = active_id
                break
            is_expected = clean_callsign in receipt.get("expected_callsigns", set())
            is_rx_station = clean_callsign != receipt.get("sender_callsign")
            if not target_net_id and (is_expected or is_rx_station):
                target_tx_id = active_id
                break

    receipt_data = active_tx_receipts.get(target_tx_id)
    if not receipt_data:
        return
    receipt_data["received_callsigns"].add(clean_callsign)
    net_id = receipt_data["net_id"]
    tx = db.query(Transmission).filter_by(id=target_tx_id).first()
    if tx:
        notify_sunray_transmission_log(db, net_id, tx)


def notify_sunray_transmission_log(db, net_id: str, tx: Transmission, station_registry=None):
    """Emits completed/live transmission log event to all SUNRAY/INSTRUCTOR stations in the net room."""
    if not tx or not tx.start_time:
        return

    end = tx.end_time or datetime.utcnow()
    duration_sec = round((end - tx.start_time).total_seconds(), 1)
    dtg_str = format_transmission_dtg(tx.start_time)

    status_str = get_tx_status_string(tx.id, tx)
    rx_summary = get_rx_summary_string(tx.id)

    log_data = {
        "transmissionId": tx.id,
        "callSign": tx.sender_call_sign,
        "dtg": dtg_str,
        "duration": f"{duration_sec}s",
        "reason": tx.termination_reason or status_str,
        "status": status_str,
        "rxSummary": rx_summary
    }

    if station_registry:
        sunray_stations = db.query(Station).filter(
            Station.net_id == net_id,
            Station.role.in_(["SUNRAY", "CONTROL", "INSTRUCTOR"]),
            Station.status != "DISCONNECTED"
        ).all()
        for s in sunray_stations:
            sid = station_registry.get_sid(s.id)
            if sid:
                socketio.emit('sunray_tx_log', log_data, to=sid)
                socketio.emit('sunray_tx_log_update', log_data, to=sid)
    else:
        socketio.emit('sunray_tx_log', log_data, room=net_id)
        socketio.emit('sunray_tx_log_update', log_data, room=net_id)


def unregister_transmitting_sid(sid: str):
    """Remove SID from transmitting fast-path mapping and enter 500ms grace window for trailing chunks."""
    net_id = transmitting_sids.pop(sid, None)
    if net_id:
        grace_sids[sid] = (net_id, time.time() + 0.5)


def register_transmitting_sid(sid: str, net_id: str):
    """Register SID in transmitting fast-path mapping."""
    grace_sids.pop(sid, None)
    transmitting_sids[sid] = net_id


def get_audio_net_id(sid: str, station_registry=None):
    """Get net ID for audio streaming using fast path O(1) lookup or 500ms grace window."""
    # pylint: disable=unused-argument
    if sid in transmitting_sids:
        return transmitting_sids[sid]

    if sid in grace_sids:
        net_id, expiry = grace_sids[sid]
        if time.time() < expiry:
            return net_id
        grace_sids.pop(sid, None)

    return None


def transmission_timeout_timer(tx_id: str, net_id: str, sid: str, broadcast_roster):
    """Wait 20s; if transmission is still active, terminate and trigger Enemy Direction Finding Alert."""
    eventlet.sleep(MAX_TRANSMISSION_SECONDS)
    db = get_db()
    try:
        tx = db.query(Transmission).filter_by(id=tx_id, end_time=None).first()
        if tx:
            tx.end_time = datetime.utcnow()
            tx.termination_reason = "MAX_DURATION_EXCEEDED"
            if tx_id in active_tx_receipts:
                active_tx_receipts[tx_id]["status"] = "MAX_DURATION_EXCEEDED"
            sender = db.query(Station).filter_by(net_id=net_id, call_sign=tx.sender_call_sign).first()
            if sender:
                sender.transmission_status = "IDLE"
            db.commit()
            notify_sunray_transmission_log(db, net_id, tx)

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

    connected_stations = db.query(Station).filter(
        Station.net_id == net_id,
        Station.status == "CONNECTED",
        ~Station.role.in_(["SUNRAY", "CONTROL", "INSTRUCTOR"]),
        Station.call_sign.isnot(None),
        Station.id != station.id
    ).all()

    sender_cs = station.call_sign.strip().upper() if station.call_sign else ""
    expected_cs = set(
        s.call_sign.strip().upper() for s in connected_stations
        if s.call_sign and s.call_sign.strip().upper() != sender_cs
    )

    active_tx_receipts[tx.id] = {
        "net_id": net_id,
        "sender_callsign": sender_cs,
        "start_time": tx.start_time,
        "end_time": None,
        "expected_callsigns": expected_cs,
        "received_callsigns": set(),
        "status": "TRANSMITTING"
    }

    register_transmitting_sid(sid, net_id)
    socketio.emit('transmission_started', {
        'transmissionId': tx.id,
        'senderCallSign': station.call_sign
    }, room=net_id)
    broadcast_roster(db, net_id)
    notify_sunray_transmission_log(db, net_id, tx)

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
        if active_tx.id in active_tx_receipts:
            active_tx_receipts[active_tx.id]["status"] = "OVERRIDDEN"
        db.commit()
        notify_sunray_transmission_log(db, net_id, active_tx, station_registry)

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
    station.transmission_status = "IDLE"

    tx = None
    if tx_id:
        tx = db.query(Transmission).filter_by(id=tx_id, end_time=None).first()
    if not tx and station and station.call_sign:
        tx = db.query(Transmission).filter_by(
            sender_call_sign=station.call_sign,
            net_id=net_id,
            end_time=None
        ).order_by(Transmission.start_time.desc()).first()

    if tx:
        tx.end_time = datetime.utcnow()
        tx.termination_reason = "PTT_RELEASED"
        if tx.id in active_tx_receipts:
            active_tx_receipts[tx.id]["status"] = "PTT RELEASED"
            active_tx_receipts[tx.id]["end_time"] = tx.end_time

    db.commit()

    if tx:
        notify_sunray_transmission_log(db, net_id, tx)

    broadcast_roster(db, net_id)
