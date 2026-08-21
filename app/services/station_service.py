"""Service module for managing connected stations and socket mappings."""
from datetime import datetime
import eventlet
from app import socketio
from app.database import get_db
from app.models import Station, Transmission


class StationSocketRegistry:
    """Encapsulates in-memory mappings between Socket SIDs and Station IDs/Net IDs."""

    def __init__(self):
        self.sid_to_station_id = {}
        self.station_id_to_sid = {}
        self.sid_to_net_id = {}

    def register(self, sid: str, station_id: str, net_id: str):
        """Register active socket mapping."""
        self.sid_to_station_id[sid] = station_id
        self.station_id_to_sid[station_id] = sid
        self.sid_to_net_id[sid] = net_id

    def unregister_sid(self, sid: str):
        """Remove socket mapping for a given SID."""
        station_id = self.sid_to_station_id.pop(sid, None)
        if station_id and self.station_id_to_sid.get(station_id) == sid:
            self.station_id_to_sid.pop(station_id, None)
        self.sid_to_net_id.pop(sid, None)

    def get_station_id(self, sid: str):
        """Get station ID from SID."""
        return self.sid_to_station_id.get(sid)

    def get_sid(self, station_id: str):
        """Get SID from station ID."""
        return self.station_id_to_sid.get(station_id)

    def get_net_id(self, sid: str):
        """Get net ID from SID."""
        return self.sid_to_net_id.get(sid)


# Module-level registry instance
registry = StationSocketRegistry()


def get_station_from_sid(db, sid: str):
    """Utility to look up the Station model from the active socket ID."""
    try:
        db.expire_all()
    except (AttributeError, RuntimeError):
        pass
    station_id = registry.get_station_id(sid)
    if not station_id:
        return None
    return db.query(Station).filter_by(id=station_id).first()


def broadcast_roster(db, net_id: str):
    """Utility to broadcast the updated roster to all active clients in the session room."""
    stations = db.query(Station).filter(
        Station.net_id == net_id,
        ~Station.status.in_(["LEFT", "DISCONNECTED"])
    ).all()

    now = datetime.utcnow()
    roster = []
    for s in stations:
        seconds_ago = int((now - (s.last_seen or s.connected_at)).total_seconds())
        last_active_str = "Active now" if seconds_ago < 5 else f"{seconds_ago}s ago"

        roster.append({
            "id": s.id,
            "stationId": s.id,
            "callSign": s.call_sign if s.call_sign else "",
            "nickname": s.nickname,
            "role": s.role,
            "status": s.status,
            "transmissionStatus": s.transmission_status,
            "lastActiveAgo": last_active_str
        })

    socketio.emit('roster_update', {"stations": roster}, room=net_id)


def grace_period_disconnect_timer(station_id: str, net_id: str):
    """Wait 60 seconds after socket disconnect; if station hasn't reconnected, mark LEFT."""
    eventlet.sleep(60)
    db = get_db()
    try:
        station = db.query(Station).filter_by(id=station_id).first()
        if station and station.status in ["OFFLINE", "UNWORKABLE"]:
            station.status = "LEFT"
            station.transmission_status = "IDLE"
            db.commit()
            broadcast_roster(db, net_id)
    # pylint: disable=broad-exception-caught
    except Exception:
        db.rollback()


def detach_station(db, station: Station, reason_status: str):
    """Detach station, update transmission lock, clean up registry, and update roster."""
    net_id = station.net_id
    station.status = reason_status
    station.transmission_status = "IDLE"
    station.last_seen = datetime.utcnow()
    if reason_status == "LEFT":
        station.call_sign = None

    # Clean up global PTT lock if this station was speaking
    transmission = db.query(Transmission).filter_by(
        net_id=net_id,
        sender_call_sign=station.call_sign,
        end_time=None
    ).first()
    if transmission:
        transmission.end_time = datetime.utcnow()
        transmission.termination_reason = reason_status

    db.commit()

    station_id = station.id
    return station_id, net_id


def process_station_disconnect(db, sid: str, transmission_service):
    """Handle client disconnect event."""
    transmission_service.unregister_transmitting_sid(sid)
    station = get_station_from_sid(db, sid)
    if station:
        station_id, net_id = detach_station(db, station, "OFFLINE")
        registry.unregister_sid(sid)
        broadcast_roster(db, net_id)
        eventlet.spawn(grace_period_disconnect_timer, station_id, net_id)


def process_station_leave(db, sid: str, transmission_service, session_service=None):
    """Handle explicit leave net event. If SUNRAY leaves, terminate the session."""
    transmission_service.unregister_transmitting_sid(sid)
    station = get_station_from_sid(db, sid)
    if station:
        if station.role in ["SUNRAY", "CONTROL", "INSTRUCTOR"] and session_service:
            session_service.end_net_session(db, station, registry, transmission_service)
        else:
            _, net_id = detach_station(db, station, "LEFT")
            registry.unregister_sid(sid)
            broadcast_roster(db, net_id)


def find_existing_station(db, session_id: str, nickname: str, role: str, provided_station_id: str = None):
    """Look up an existing station by ID, control role, or nickname."""
    station = None
    if provided_station_id:
        station = db.query(Station).filter_by(id=provided_station_id, net_id=session_id).first()

    if not station and role in ["SUNRAY", "CONTROL", "INSTRUCTOR"]:
        station = db.query(Station).filter(
            Station.net_id == session_id,
            Station.role.in_(["SUNRAY", "CONTROL", "INSTRUCTOR"])
        ).first()

    if not station:
        station = db.query(Station).filter(
            Station.net_id == session_id,
            Station.nickname == nickname
        ).first()

    return station


def check_duplicate_active_station(station: Station, sid: str, provided_station_id: str):
    """Check if station is already actively connected under another socket ID."""
    if station and station.status not in ["LEFT", "DISCONNECTED"]:
        existing_sid = registry.get_sid(station.id)
        if existing_sid and existing_sid != sid and provided_station_id != station.id:
            return True
    return False


def bind_or_create_station(db, session_id: str, station_info: dict, station: Station):
    """Update existing station or create a new station record."""
    nickname = station_info.get("nickname")
    role = station_info.get("role")
    remote_addr = station_info.get("remote_addr")

    is_control = role in ["SUNRAY", "CONTROL", "INSTRUCTOR"]
    actual_role = "SUNRAY" if is_control else role

    if station:
        if is_control:
            station.nickname = nickname
            station.role = actual_role
            if not station.call_sign:
                station.call_sign = "0"
            station.status = "CONNECTED"
        else:
            station.status = "CONNECTED" if station.call_sign else "AWAITING_ASSIGNMENT"
    else:
        station = Station(
            net_id=session_id,
            nickname=nickname,
            role=actual_role,
            call_sign="0" if is_control else None,
            status="CONNECTED" if is_control else "AWAITING_ASSIGNMENT"
        )
        db.add(station)
        db.flush()

    station.ip_address = remote_addr
    station.last_seen = datetime.utcnow()
    db.commit()
    return station
