"""Unit tests for models, validation schemas, database access, and HTTP routes."""
import eventlet
from pydantic import ValidationError
import pytest

from app import create_app, socketio, database
from app.database import Base, engine, db_session, init_db
from app.models import NetSession, Station, LogEntry
from app.schemas import NetSessionCreate, StationCreate, LogEntryCreate


@pytest.fixture(scope="module")
def app():
    """Module-level Flask app test fixture."""
    app_instance = create_app()
    app_instance.config['TESTING'] = True

    # Initialize database
    init_db()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    yield app_instance

    # Cleanup
    Base.metadata.drop_all(bind=engine)
    db_session.remove()





def test_net_session_create_validation():
    """Test NetSessionCreate schema validation rules."""
    # Valid parameters
    payload = {"name": "Exercise Drill One", "callsign_indicator": "R"}
    model = NetSessionCreate(**payload)
    assert model.name == "Exercise Drill One"
    assert model.callsign_indicator == "R"

    # Invalid names
    with pytest.raises(ValidationError):
        NetSessionCreate(name="!!! Invalid Net !!!", callsign_indicator="R")

    # Invalid callsign indicator (Z is reserved, length must be 1)
    with pytest.raises(ValidationError):
        NetSessionCreate(name="Valid Net", callsign_indicator="Z")
    with pytest.raises(ValidationError):
        NetSessionCreate(name="Valid Net", callsign_indicator="RR")
    with pytest.raises(ValidationError):
        NetSessionCreate(name="Valid Net", callsign_indicator="2")


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
        StationCreate(nickname="Op*", pin="A3F9")


def test_log_entry_validation():
    """Test LogEntryCreate schema validation rules."""
    # Valid DTG formats and parameters
    payload = {
        "dtg": "281015Z JUL 26",
        "from_call_sign": "R11",
        "to_call_sign": "CONTROL",
        "precedence": "ROUTINE",
        "event_text": "SITREP DE R11 INSTRUCTED TO STANDBY",
        "operator_initials": "JD"
    }
    model = LogEntryCreate(**payload)
    assert model.dtg == "281015Z JUL 26"

    # Invalid DTG (wrong month spelling, wrong day number, etc.)
    with pytest.raises(ValidationError):
        LogEntryCreate(**{**payload, "dtg": "321015Z JUL 26"})  # Day 32
    with pytest.raises(ValidationError):
        LogEntryCreate(**{**payload, "dtg": "282515Z JUL 26"})  # Hour 25
    with pytest.raises(ValidationError):
        LogEntryCreate(**{**payload, "dtg": "281015Z JUX 26"})  # Bad month
    with pytest.raises(ValidationError):
        LogEntryCreate(**{**payload, "dtg": "281015Z JUL 266"})  # 3 digit year

    # Invalid precedence
    with pytest.raises(ValidationError):
        LogEntryCreate(**{**payload, "precedence": "URGENT"})

    # Invalid callsigns
    with pytest.raises(ValidationError):
        LogEntryCreate(**{**payload, "from_call_sign": "R*11"})

    # Invalid initials (must be 2-3 alphabetic characters)
    with pytest.raises(ValidationError):
        LogEntryCreate(**{**payload, "operator_initials": "J"})
    with pytest.raises(ValidationError):
        LogEntryCreate(**{**payload, "operator_initials": "JD4"})


def test_database_persistence(db):
    # pylint: disable=redefined-outer-name
    """Test saving and querying models in database."""
    # Insert Net Session
    session = NetSession(name="Test Session", pin="B2Y8", callsign_indicator="H")
    db.add(session)
    db.commit()

    saved_session = db.query(NetSession).filter_by(pin="B2Y8").first()
    assert saved_session is not None
    assert saved_session.name == "Test Session"
    assert saved_session.callsign_indicator == "H"

    # Insert Station
    station = Station(
        net_id=saved_session.id,
        nickname="Operator Bill",
        call_sign="H10",
        role="SUB_STATION",
        status="CONNECTED"
    )
    db.add(station)
    db.commit()

    saved_station = db.query(Station).filter_by(nickname="Operator Bill").first()
    assert saved_station is not None
    assert saved_station.call_sign == "H10"

    # Insert Log Entry
    log = LogEntry(
        net_id=saved_session.id,
        owner_station_id=saved_station.id,
        dtg="281030Z JUL 26",
        from_call_sign="H10",
        to_call_sign="CONTROL",
        precedence="ROUTINE",
        event_text="CHECK RECEIVED OK",
        operator_initials="OB"
    )
    db.add(log)
    db.commit()

    saved_log = db.query(LogEntry).filter_by(operator_initials="OB").first()
    assert saved_log is not None
    assert saved_log.event_text == "CHECK RECEIVED OK"


def test_routing_endpoints(app, db):
    # pylint: disable=redefined-outer-name
    """Test HTTP API endpoints for roster and logs."""
    # Setup session, station, log in db
    session = NetSession(name="Routing Net", pin="R9Y2", callsign_indicator="T")
    db.add(session)
    db.commit()

    station = Station(
        net_id=session.id,
        nickname="Operator Sarah",
        call_sign="T10",
        role="SUB_STATION",
        status="CONNECTED"
    )
    db.add(station)
    db.commit()

    log = LogEntry(
        net_id=session.id,
        owner_station_id=station.id,
        dtg="281030Z JUL 26",
        from_call_sign="T10",
        to_call_sign="CONTROL",
        precedence="ROUTINE",
        event_text="CHECK RECEIVED OK",
        operator_initials="OS"
    )
    db.add(log)
    db.commit()

    # Test with Flask test client
    client = app.test_client()

    # Index page
    resp = client.get('/')
    assert resp.status_code == 200

    # Roster endpoint
    resp = client.get('/api/session/R9Y2/roster')
    assert resp.status_code == 200
    data = resp.json
    assert data['pin'] == 'R9Y2'
    assert len(data['roster']) == 1
    assert data['roster'][0]['nickname'] == 'Operator Sarah'

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
    # Test client using Flask-SocketIO's test_client
    client = socketio.test_client(app)
    assert client.is_connected()

    # Emit create_net event
    client.emit('create_net', {"name": "Socket Net", "callsign_indicator": "H"})

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
    instructor = socketio.test_client(app)
    instructor.emit('join_net', {"pin": "K9F2", "nickname": "Instructor Bill", "role": "CONTROL"})
    received_inst = instructor.get_received()
    resp_inst = next(m for m in received_inst if m['name'] == 'join_response')['args'][0]
    assert resp_inst['success'] is True
    assert resp_inst['role'] == 'CONTROL'

    # Connect client 2 (student operator)
    student = socketio.test_client(app)
    student.emit('join_net', {"pin": "K9F2", "nickname": "Sarah"})
    received_stud = student.get_received()
    resp_stud = next(m for m in received_stud if m['name'] == 'join_response')['args'][0]
    assert resp_stud['success'] is True
    assert resp_stud['status'] == 'AWAITING_ASSIGNMENT'
    student_id = resp_stud['stationId']

    # Instructor assigns callsign '10' (which should prepend 'T' prefix to make 'T10')
    instructor.emit('assign_callsign', {"stationId": student_id, "callSign": "10", "role": "SUB_STATION"})

    # Check student client receives callsign_assigned event
    received_stud_after = student.get_received()
    callsign_event = next(m for m in received_stud_after if m['name'] == 'callsign_assigned')['args'][0]
    assert callsign_event['success'] is True
    assert callsign_event['assignedCallSign'] == 'T10'

    instructor.disconnect()
    student.disconnect()


def test_radio_check_timer_and_defaulting(app, db):
    # pylint: disable=redefined-outer-name
    """Test collective radio check turn sequencing and timeout defaulting."""
    # Create session
    session = NetSession(name="Check Session", pin="W7Y8", callsign_indicator="R")
    db.add(session)
    db.commit()

    # Instructor (CONTROL)
    instructor = socketio.test_client(app)
    instructor.emit('join_net', {"pin": "W7Y8", "nickname": "Instructor", "role": "CONTROL"})
    instructor.get_received()

    # Student 1 (Sarah)
    student1 = socketio.test_client(app)
    student1.emit('join_net', {"pin": "W7Y8", "nickname": "Sarah"})
    s1_id = next(m for m in student1.get_received() if m['name'] == 'join_response')['args'][0]['stationId']

    # Student 2 (Mike)
    student2 = socketio.test_client(app)
    student2.emit('join_net', {"pin": "W7Y8", "nickname": "Mike"})
    s2_id = next(m for m in student2.get_received() if m['name'] == 'join_response')['args'][0]['stationId']

    # Assign callsigns
    instructor.emit('assign_callsign', {"stationId": s1_id, "callSign": "10", "role": "SUB_STATION"})
    instructor.emit('assign_callsign', {"stationId": s2_id, "callSign": "12", "role": "SUB_STATION"})
    instructor.get_received()
    student1.get_received()
    student2.get_received()

    # Start check
    instructor.emit('start_radio_check', {})

    # H10 should be the first turn
    events = student1.get_received()
    status_events = [m for m in events if m['name'] == 'radio_check_status']
    assert len(status_events) > 0
    assert status_events[-1]['args'][0]['activeCallSign'] == 'R10'

    # Wait for timeout (we sleep 5.5s to let eventlet schedule greenlets)
    eventlet.sleep(5.5)

    # Now verify Mike got the status update
    events2 = student2.get_received()
    status_events2 = [m for m in events2 if m['name'] == 'radio_check_status']
    assert len(status_events2) > 0
    assert status_events2[-1]['args'][0]['activeCallSign'] == 'R12'
    assert 'R10' in status_events2[-1]['args'][0]['defaultedCallSigns']

    instructor.disconnect()
    student1.disconnect()
    student2.disconnect()


def test_get_db_exception_rollback(monkeypatch):
    """Test get_db rollback on session error."""
    def mock_db_session():
        raise RuntimeError("Database connection failure")

    monkeypatch.setattr(database, 'db_session', mock_db_session)
    with pytest.raises(RuntimeError):
        database.get_db()


def test_init_db_creates_directory(tmp_path, monkeypatch):
    """Test database directory creation during init_db."""
    target_dir = tmp_path / "subdir"
    db_file = target_dir / "test.db"
    fake_url = f"sqlite:///{db_file}"

    monkeypatch.setattr(database, 'DATABASE_URL', fake_url)
    database.init_db()
    assert target_dir.exists()
