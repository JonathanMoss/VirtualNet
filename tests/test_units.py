"""Unit tests for models, validation schemas, database access, and HTTP routes."""
from datetime import datetime, timedelta
from pydantic import ValidationError
import pytest
from conftest import get_today_instructor_pin

from app import socketio
from app.database import db_session
from app.models import NetSession, Station, LogEntry, Transmission
from app.schemas import NetSessionCreate, StationCreate, LogEntryCreate







def test_net_session_create_validation():
    """Test NetSessionCreate schema validation rules."""
    valid_pin = get_today_instructor_pin()
    # Valid parameters
    payload = {"name": "Exercise Drill One", "callsign_indicator": "R", "instructor_pin": valid_pin}
    model = NetSessionCreate(**payload)
    assert model.name == "Exercise Drill One"
    assert model.callsign_indicator == "R"
    assert model.instructor_pin == valid_pin

    # Invalid names
    with pytest.raises(ValidationError):
        NetSessionCreate(name="!!! Invalid Net !!!", callsign_indicator="R", instructor_pin=valid_pin)

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


def test_log_entry_validation():
    """Test LogEntryCreate schema validation rules."""
    # Valid GMT entry (Z)
    payload_z = {
        "dtg": "281015Z JUL 26",
        "from_call_sign": "R11",
        "to_call_sign": "CONTROL",
        "precedence": "ROUTINE",
        "event_text": "REPORT RECEIVED OVER",
        "operator_initials": "JM"
    }
    model_z = LogEntryCreate(**payload_z)
    assert model_z.dtg == "281015Z JUL 26"

    # Valid BST entry (A)
    payload_a = {
        "dtg": "302120A JUL 26",
        "from_call_sign": "R11",
        "to_call_sign": "CONTROL",
        "precedence": "ROUTINE",
        "event_text": "REPORT RECEIVED OVER",
        "operator_initials": "JM"
    }
    model_a = LogEntryCreate(**payload_a)
    assert model_a.dtg == "302120A JUL 26"

    # Invalid DTG
    bad_payload = {**payload_z, "dtg": "281015 JUL 26"}
    with pytest.raises(ValidationError):
        LogEntryCreate(**bad_payload)

    # Invalid precedence
    bad_precedence = {**payload_z, "precedence": "URGENT"}
    with pytest.raises(ValidationError):
        LogEntryCreate(**bad_precedence)


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

    # Create LogEntry
    log = LogEntry(
        net_id=retrieved_net.id,
        owner_station_id=st1.id,
        dtg="281015Z JUL 26",
        from_call_sign="CONTROL",
        to_call_sign="A10",
        precedence="ROUTINE",
        event_text="TEST TRANSMISSION",
        operator_initials="JM"
    )
    session.add(log)
    session.commit()

    retrieved_log = session.query(LogEntry).filter_by(net_id=retrieved_net.id).first()
    assert retrieved_log is not None
    assert retrieved_log.event_text == "TEST TRANSMISSION"


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

    log = LogEntry(
        net_id=session_obj.id,
        owner_station_id=st.id,
        dtg="281015Z JUL 26",
        from_call_sign="R11",
        to_call_sign="CONTROL",
        precedence="ROUTINE",
        event_text="CHECK RECEIVED OK",
        operator_initials="JM"
    )
    db.add(log)
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


    # Logs endpoint
    resp = client.get('/api/session/R9Y2/logs')
    assert resp.status_code == 200
    data = resp.json
    assert data['pin'] == 'R9Y2'
    assert len(data['logs']) == 1
    assert data['logs'][0]['eventText'] == 'CHECK RECEIVED OK'

    # Non-existent session logs
    resp = client.get('/api/session/ZZZZ/logs')
    assert resp.status_code == 404

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
    # pylint: disable=import-outside-toplevel
    """Test handle_ptt_release when tx_id is None query falls back to sender_call_sign."""
    from app.services import transmission_service

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
