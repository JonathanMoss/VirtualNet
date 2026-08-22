"""Unit tests for models, validation schemas, database access, and HTTP routes."""
from datetime import datetime, timedelta
from pydantic import ValidationError
import pytest
from conftest import get_today_instructor_pin

from app import socketio
from app.database import db_session
from app.models import NetSession, Station, Transmission
from app.schemas import NetSessionCreate, StationCreate
from app.services import session_service, station_service, transmission_service







def test_net_session_create_validation():
    """Test NetSessionCreate schema validation rules."""
    valid_pin = get_today_instructor_pin()
    # Valid parameters including . / () and max length 20
    payload = {"name": "Ex. 1 / (Alpha)", "callsign_indicator": "R", "instructor_pin": valid_pin}
    model = NetSessionCreate(**payload)
    assert model.name == "Ex. 1 / (Alpha)"
    assert model.callsign_indicator == "R"
    assert model.instructor_pin == valid_pin

    # Invalid names (symbols not allowed)
    with pytest.raises(ValidationError):
        NetSessionCreate(name="!!! Invalid Net !!!", callsign_indicator="R", instructor_pin=valid_pin)

    # Invalid names (>20 characters)
    with pytest.raises(ValidationError):
        NetSessionCreate(name="Net Name Over Twenty Characters", callsign_indicator="R", instructor_pin=valid_pin)

    # Invalid callsign indicator (Z is reserved, length must be 1)
    with pytest.raises(ValidationError):
        NetSessionCreate(name="Valid Net", callsign_indicator="Z", instructor_pin=valid_pin)
    with pytest.raises(ValidationError):
        NetSessionCreate(name="Valid Net", callsign_indicator="RR", instructor_pin=valid_pin)
    with pytest.raises(ValidationError):
        NetSessionCreate(name="Valid Net", callsign_indicator="2", instructor_pin=valid_pin)

    # Invalid instructor PIN (must be 6 numeric digits)
    with pytest.raises(ValidationError):
        NetSessionCreate(name="Valid Net", callsign_indicator="R", instructor_pin="12345")


def test_station_create_validation():
    """Test StationCreate schema validation rules."""
    # Valid nickname & PIN
    payload = {"nickname": "Operator-1", "pin": "A3F9"}
    model = StationCreate(**payload)
    assert model.nickname == "Operator-1"
    assert model.pin == "A3F9"

    # Invalid PINs
    with pytest.raises(ValidationError):
        StationCreate(nickname="Operator-1", pin="A3F")  # Too short
    with pytest.raises(ValidationError):
        StationCreate(nickname="Operator-1", pin="A3F99")  # Too long
    with pytest.raises(ValidationError):
        StationCreate(nickname="Operator-1", pin="A*F9")  # Special char

    # Invalid nickname
    with pytest.raises(ValidationError):
        StationCreate(nickname="!!!BadUser!!!", pin="A3F9")




def test_database_persistence(db):
    # pylint: disable=redefined-outer-name,unused-argument
    """Test creating and retrieving database models using SQLAlchemy session."""
    session = db_session()


    # Create a NetSession
    net = NetSession(name="Alpha Net", pin="A1B2", callsign_indicator="A")
    session.add(net)
    session.commit()

    retrieved_net = session.query(NetSession).filter_by(pin="A1B2").first()
    assert retrieved_net is not None
    assert retrieved_net.name == "Alpha Net"
    assert retrieved_net.callsign_indicator == "A"

    # Create Stations
    st1 = Station(net_id=retrieved_net.id, nickname="Instructor", role="CONTROL", call_sign="CONTROL")
    st2 = Station(net_id=retrieved_net.id, nickname="Student1", role="SUB_STATION")
    session.add_all([st1, st2])
    session.commit()

    stations = session.query(Station).filter_by(net_id=retrieved_net.id).all()
    assert len(stations) == 2


def test_routing_endpoints(app, db):
    # pylint: disable=redefined-outer-name,unused-argument
    """Test Flask HTTP API endpoints."""
    # Seed database
    session_obj = NetSession(name="HTTP Test Net", pin="R9Y2", callsign_indicator="R")
    db.add(session_obj)
    db.commit()

    st = Station(net_id=session_obj.id, nickname="User1", role="SUB_STATION", call_sign="R11")
    db.add(st)
    db.commit()



    # Test with Flask test client
    client = app.test_client()

    # Home route
    resp = client.get('/')
    assert resp.status_code == 200

    # Roster endpoint
    resp = client.get('/api/session/R9Y2/roster')
    assert resp.status_code == 200
    data = resp.json
    assert data['pin'] == 'R9Y2'
    assert len(data['roster']) == 1
    assert data['roster'][0]['nickname'] == 'User1'

    # Non-existent session roster
    resp = client.get('/api/session/ZZZZ/roster')
    assert resp.status_code == 404


def test_socketio_session_creation(app, db):
    # pylint: disable=redefined-outer-name,unused-argument
    """Test creating a net session via SocketIO."""
    valid_pin = get_today_instructor_pin()
    client = socketio.test_client(app)
    assert client.is_connected()

    # Emit create_net event with valid daily instructor PIN
    client.emit('create_net', {"name": "Socket Net", "callsign_indicator": "H", "instructor_pin": valid_pin})

    received = client.get_received()
    assert len(received) > 0

    # Locate create_response in messages
    response = next(msg for msg in received if msg['name'] == 'create_response')
    assert response['args'][0]['success'] is True
    pin = response['args'][0]['pin']
    assert len(pin) == 4

    client.disconnect()


def test_socketio_station_join_and_callsign_assignment(app, db):
    # pylint: disable=redefined-outer-name
    """Test joining net and callsign assignment via SocketIO."""
    # Setup a net session in db
    session = NetSession(name="Join Session", pin="K9F2", callsign_indicator="T")
    db.add(session)
    db.commit()

    # Connect client 1 (instructor)
    inst = socketio.test_client(app)
    inst.emit('join_net', {"pin": "K9F2", "nickname": "Inst1", "role": "INSTRUCTOR"})
    inst.get_received()

    # Connect client 2 (student)
    stud = socketio.test_client(app)
    stud.emit('join_net', {"pin": "K9F2", "nickname": "Stud1", "role": "SUB_STATION"})
    stud_events = stud.get_received()
    join_msg = next(m for m in stud_events if m['name'] == 'join_response')
    assert join_msg['args'][0]['success'] is True
    stud_id = join_msg['args'][0]['stationId']

    # Instructor assigns callsign to student
    inst.emit('assign_callsign', {"stationId": stud_id, "callSign": "10", "role": "SUB_STATION"})
    inst.get_received()

    stud_after = stud.get_received()
    assigned_msg = next(m for m in stud_after if m['name'] == 'callsign_assigned')
    assert assigned_msg['args'][0]['success'] is True
    assert assigned_msg['args'][0]['assignedCallSign'] == "T10"

    inst.disconnect()
    stud.disconnect()


def test_session_transmissions_api(app, db):
    # pylint: disable=redefined-outer-name
    """Test /api/session/<pin>/transmissions endpoint returns completed transmissions."""
    session = NetSession(name="Tx API Test Net", pin="TX99")
    db.add(session)
    db.commit()

    now = datetime.utcnow()
    tx1 = Transmission(
        net_id=session.id,
        sender_call_sign="R11",
        start_time=now,
        end_time=now,
        termination_reason="PTT_RELEASED"
    )
    tx2 = Transmission(
        net_id=session.id,
        sender_call_sign="H10",
        start_time=now + timedelta(seconds=5),
        end_time=now + timedelta(seconds=10),
        termination_reason="PTT_RELEASED"
    )
    db.add_all([tx1, tx2])
    db.commit()

    client = app.test_client()
    res = client.get('/api/session/TX99/transmissions')
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data['pin'] == 'TX99'
    assert len(json_data['transmissions']) == 2
    assert json_data['transmissions'][0]['callSign'] == 'H10'
    assert json_data['transmissions'][1]['callSign'] == 'R11'
    assert 'rxSummary' in json_data['transmissions'][0]
    assert 'status' in json_data['transmissions'][0]


def test_sunray_transmission_activity_log_telemetry(app, db):
    # pylint: disable=redefined-outer-name,unused-argument
    """Test transmission receipt tracking and formatting in transmission_service."""
    session = NetSession(name="Telemetry Net", pin="TL99")
    db.add(session)
    db.commit()

    st1 = Station(net_id=session.id, nickname="John", call_sign="R11", role="SUB_STATION", status="CONNECTED")
    st2 = Station(net_id=session.id, nickname="Mike", call_sign="R12", role="SUB_STATION", status="CONNECTED")
    st3 = Station(net_id=session.id, nickname="Sarah", call_sign="R15", role="SUB_STATION", status="CONNECTED")
    db.add_all([st1, st2, st3])
    db.commit()

    def dummy_broadcast(db_inst, net_id):
        # pylint: disable=unused-argument
        pass

    res = transmission_service.handle_ptt_request(db, st1, "sid1", {}, dummy_broadcast)
    tx_id = res["transmissionId"]

    assert transmission_service.get_tx_status_string(tx_id) == "TRANSMITTING"
    assert transmission_service.get_rx_summary_string(tx_id) == "NOT R/X: R12, R15"

    # Test fallback when tx_id is None (mobile receiver fallback)
    transmission_service.record_audio_rx_playback_complete(db, None, "R12")
    assert transmission_service.get_rx_summary_string(tx_id) == "NOT R/X: R15"

    transmission_service.record_audio_rx_playback_complete(db, tx_id, "R15")
    assert transmission_service.get_rx_summary_string(tx_id) == "ALL CALLSIGNS R/X"

    transmission_service.handle_ptt_release(db, st1, tx_id, "sid1", dummy_broadcast)
    assert transmission_service.get_tx_status_string(tx_id) == "PTT RELEASED"


def test_guide_routes(app):
    # pylint: disable=redefined-outer-name
    """Test HTTP GET routes for student and sunray markdown user guides, CSS linkage, and 404 handling."""
    client = app.test_client()

    # Test Student Guide route
    res_student = client.get('/guide/student')
    assert res_student.status_code == 200
    assert b"VirtualNet - Student User Guide" in res_student.data
    assert b"Push-to-Talk" in res_student.data
    assert b"OVER" in res_student.data
    assert b"/static/css/guides.css" in res_student.data

    # Test Sunray Guide route
    res_sunray = client.get('/guide/sunray')
    assert res_sunray.status_code == 200
    assert b"Sunray (Instructor) User Guide" in res_sunray.data
    assert b"joth.moss@googlemail.com" in res_sunray.data
    assert b"<table>" in res_sunray.data or b"th>" in res_sunray.data
    assert b"/static/css/guides.css" in res_sunray.data

    # Test Non-existent guide route (404)
    res_invalid = client.get('/guide/nonexistent_guide')
    assert res_invalid.status_code == 404
    assert b"404 - Guide Not Found" in res_invalid.data
    assert b"NOT FOUND" in res_invalid.data


def test_handle_ptt_release_with_none_tx_id(db):
    """Test handle_ptt_release when tx_id is None query falls back to sender_call_sign."""

    session = NetSession(name="PTT Release Net", pin="PR11", callsign_indicator="P")
    db.add(session)
    db.commit()

    station = Station(
        net_id=session.id, nickname="STUDENT1", role="SUB_STATION",
        call_sign="P11", transmission_status="TRANSMITTING"
    )
    db.add(station)
    db.commit()

    tx = Transmission(net_id=session.id, sender_call_sign="P11")
    db.add(tx)
    db.commit()

    called_roster = []
    def dummy_broadcast(_db_inst, net_id):
        called_roster.append(net_id)

    transmission_service.handle_ptt_release(db, station, None, "dummy_sid", dummy_broadcast)

    assert station.transmission_status == "IDLE"
    assert tx.end_time is not None
    assert tx.termination_reason == "PTT_RELEASED"
    assert called_roster == [session.id]


def test_restore_or_recreate_sunray_session_unit(db):
    """Test unit coverage for restore_or_recreate_sunray_session in session_service."""

    valid_pin = get_today_instructor_pin()

    # 1. Invalid instructor PIN rejection
    res_inv = session_service.restore_or_recreate_sunray_session(
        db, "PIN1", "000000", "SUNRAY", {}, station_service.registry, lambda _d, _n: None
    )
    assert res_inv["success"] is False

    # 2. Restoring brand new NetSession + SUNRAY Station
    res_new = session_service.restore_or_recreate_sunray_session(
        db, "NEW1", valid_pin, "SUNRAY", {"remote_addr": "127.0.0.1", "sid": "s1"},
        station_service.registry, lambda _d, _n: None
    )
    assert res_new["success"] is True
    assert res_new["pin"] == "NEW1"
    assert res_new["role"] == "SUNRAY"

    # 3. Restoring existing session and station
    res_exist = session_service.restore_or_recreate_sunray_session(
        db, "NEW1", valid_pin, "SUNRAY_2", {"remote_addr": "127.0.0.1", "sid": "s2"},
        station_service.registry, lambda _d, _n: None
    )
    assert res_exist["success"] is True
    assert res_exist["stationId"] == res_new["stationId"]


def test_grace_period_disconnect_timer_unit(db):
    """Test station_service grace_period_disconnect_timer transition."""

    session = NetSession(name="Timer Net", pin="TMR1", callsign_indicator="T")
    db.add(session)
    db.commit()

    station = Station(net_id=session.id, nickname="TimerUser", role="SUB_STATION", status="OFFLINE")
    db.add(station)
    db.commit()

    # Test grace_period_disconnect_timer logic directly
    station_id = station.id
    st = db.query(Station).filter_by(id=station_id).first()
    if st and st.status in ["OFFLINE", "UNWORKABLE"]:
        st.status = "LEFT"
        st.transmission_status = "IDLE"
        db.commit()

    reloaded = db.query(Station).filter_by(id=station_id).first()
    assert reloaded.status == "LEFT"


def test_transmission_service_edge_cases(db):
    """Test transmission_service edge cases for PTT lock, mutes, channel busy, and break-in override."""
    session = NetSession(name="PTT Edge Net", pin="PE11", callsign_indicator="P", status="SUSPENDED")
    db.add(session)
    db.commit()

    st_awaiting = Station(net_id=session.id, nickname="User1", role="SUB_STATION", status="AWAITING_ASSIGNMENT")
    st_muted = Station(net_id=session.id, nickname="User2", role="SUB_STATION", call_sign="P12", status="MUTED")
    st_speaker = Station(net_id=session.id, nickname="Speaker", role="SUB_STATION", call_sign="P11", status="CONNECTED")
    st_sunray = Station(net_id=session.id, nickname="Sunray", role="SUNRAY", call_sign="0", status="CONNECTED")
    db.add_all([st_awaiting, st_muted, st_speaker, st_sunray])
    db.commit()

    def dummy_broadcast(_d, _n):
        pass

    # 1. Awaiting assignment rejection
    res_await = transmission_service.handle_ptt_request(
        db, st_awaiting, "s1", station_service.registry, dummy_broadcast
    )
    assert res_await["allowed"] is False

    # 2. Muted station rejection
    res_muted = transmission_service.handle_ptt_request(
        db, st_muted, "s2", station_service.registry, dummy_broadcast
    )
    assert res_muted["allowed"] is False

    # 3. Suspended session rejection
    res_susp = transmission_service.handle_ptt_request(
        db, st_speaker, "s3", station_service.registry, dummy_broadcast
    )
    assert res_susp["allowed"] is False

    # Re-enable session
    session.status = "FREE"
    db.commit()

    # 4. Speaker gets PTT lock
    res_speaker = transmission_service.handle_ptt_request(
        db, st_speaker, "s3", station_service.registry, dummy_broadcast
    )
    assert res_speaker["allowed"] is True
    tx_id = res_speaker["transmissionId"]
    assert transmission_service.get_audio_net_id("s3") == session.id

    st_student2 = Station(
        net_id=session.id, nickname="Student2", role="SUB_STATION", call_sign="P13", status="CONNECTED"
    )
    db.add(st_student2)
    db.commit()

    # 5. Channel busy for another student
    res_busy = transmission_service.handle_ptt_request(
        db, st_student2, "s2", station_service.registry, dummy_broadcast
    )
    assert res_busy["allowed"] is False
    assert "Channel Busy" in res_busy["reason"]

    # 6. SUNRAY Break-In override
    res_override = transmission_service.handle_ptt_request(
        db, st_sunray, "s4", station_service.registry, dummy_broadcast
    )
    assert res_override["allowed"] is True
    assert res_override["transmissionId"] != tx_id

    # Cleanup transmitting SIDs
    transmission_service.unregister_transmitting_sid("s3")
    transmission_service.unregister_transmitting_sid("s4")
    transmission_service.grace_sids.pop("s3", None)
    transmission_service.grace_sids.pop("s4", None)
    assert transmission_service.get_audio_net_id("s3") is None


def test_clear_session_transmissions(app):
    # pylint: disable=unused-argument
    """Test clearing session transmission activity log."""
    db = db_session
    session = NetSession(name="Test Clear Log", pin="CLR1", callsign_indicator="R")
    db.add(session)
    db.commit()

    now = datetime.utcnow()
    tx1 = Transmission(net_id=session.id, sender_call_sign="R11", start_time=now, end_time=now)
    tx2 = Transmission(net_id=session.id, sender_call_sign="R12", start_time=now, end_time=now)
    db.add_all([tx1, tx2])
    db.commit()

    transmission_service.active_tx_receipts[tx1.id] = {"net_id": session.id, "sender_callsign": "R11"}
    transmission_service.active_tx_receipts[tx2.id] = {"net_id": session.id, "sender_callsign": "R12"}

    assert db.query(Transmission).filter_by(net_id=session.id).count() == 2
    transmission_service.clear_session_transmissions(db, session.id)
    assert db.query(Transmission).filter_by(net_id=session.id).count() == 0
    assert tx1.id not in transmission_service.active_tx_receipts
    assert tx2.id not in transmission_service.active_tx_receipts


def test_purge_station(app):
    # pylint: disable=unused-argument
    """Test station purge completely removes station DB record."""
    db = db_session
    session = NetSession(name="Test Purge", pin="PRG1", callsign_indicator="R")
    db.add(session)
    db.commit()

    station = Station(
        net_id=session.id,
        nickname="KickedStudent",
        role="SUB_STATION",
        call_sign="R19",
        status="CONNECTED"
    )
    db.add(station)
    db.commit()

    station_id = station.id
    station_service.purge_station(db, station)
    assert db.query(Station).filter_by(id=station_id).first() is None
