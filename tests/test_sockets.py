import os

import pytest
from app import create_app, socketio
from app.database import Base, db_session, engine, init_db
from app.models import NetSession, Station
from app.sockets import sid_to_station_id, station_id_to_sid


@pytest.fixture(scope="module")
def app():
    """Create the Flask app and initialize the database for socket tests."""
    # Ensure the test database is available for the imported database engine.
    os.environ.setdefault('DATABASE_URL', 'sqlite:///./virtualnet_test.db')
    app = create_app()
    app.config['TESTING'] = True

    init_db()
    yield app

    db_session.remove()
    Base.metadata.drop_all(bind=engine)
    sid_to_station_id.clear()
    station_id_to_sid.clear()


@pytest.fixture
def socket_client(app):
    client = socketio.test_client(app, flask_test_client=app.test_client())
    assert client.is_connected()
    yield client
    client.disconnect()
    sid_to_station_id.clear()
    station_id_to_sid.clear()


def test_join_net_and_assign_callsign(app, socket_client):
    # Instructor creates a net and joins as an instructor.
    socket_client.emit('create_net', {'name': 'Socket LAN Net', 'callsign_indicator': 'R'})
    received = socket_client.get_received()
    create_response = next((item for item in received if item['name'] == 'create_response'), None)
    assert create_response is not None
    assert create_response['args'][0]['success'] is True
    pin = create_response['args'][0]['pin']

    socket_client.emit('join_net', {'pin': pin, 'nickname': 'InstructorOne', 'role': 'INSTRUCTOR'})
    received = socket_client.get_received()
    join_response = next((item for item in received if item['name'] == 'join_response'), None)
    assert join_response is not None
    assert join_response['args'][0]['success'] is True
    assert join_response['args'][0]['role'] == 'INSTRUCTOR'

    instructor_station_id = join_response['args'][0]['stationId']
    session_id = join_response['args'][0]['netId']
    assert pin == join_response['args'][0]['pin']

    # Student joins the created net session.
    student_client = socketio.test_client(app, flask_test_client=app.test_client())
    assert student_client.is_connected()
    student_client.emit('join_net', {'pin': pin, 'nickname': 'StudentA', 'role': 'SUB_STATION'})
    student_events = student_client.get_received()
    student_join = next((item for item in student_events if item['name'] == 'join_response'), None)
    assert student_join is not None
    assert student_join['args'][0]['success'] is True
    assert student_join['args'][0]['status'] == 'AWAITING_ASSIGNMENT'
    student_station_id = student_join['args'][0]['stationId']

    # Instructor assigns a callsign to the student.
    socket_client.emit('assign_callsign', {'stationId': student_station_id, 'callSign': '10', 'role': 'SUB_STATION'})
    assignment_events = socket_client.get_received()
    error_event = next((item for item in assignment_events if item['name'] == 'error'), None)
    assert error_event is None

    student_events = student_client.get_received()
    assignment_event = next((item for item in student_events if item['name'] == 'callsign_assigned'), None)
    assert assignment_event is not None
    assert assignment_event['args'][0]['success'] is True
    assert assignment_event['args'][0]['assignedCallSign'] == 'R10'

    # Ensure the student is now connected and has a callsign.
    student_station = db_session().query(Station).filter_by(id=student_station_id).first()
    assert student_station is not None
    assert student_station.call_sign == 'R10'
    assert student_station.status == 'CONNECTED'

    student_client.disconnect()


def test_audio_chunk_broadcasts_to_other_clients(app, socket_client):
    socket_client.emit('create_net', {'name': 'Audio Net', 'callsign_indicator': 'R'})
    received = socket_client.get_received()
    pin = next(item for item in received if item['name'] == 'create_response')['args'][0]['pin']

    # Instructor joins
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'InstructorA', 'role': 'INSTRUCTOR'})
    instruct_join = next(item for item in socket_client.get_received() if item['name'] == 'join_response')
    assert instruct_join['args'][0]['success'] is True

    # Student joins and receives a callsign
    student_client = socketio.test_client(app, flask_test_client=app.test_client())
    assert student_client.is_connected()
    student_client.emit('join_net', {'pin': pin, 'nickname': 'StudentB', 'role': 'SUB_STATION'})
    student_join = next(item for item in student_client.get_received() if item['name'] == 'join_response')
    student_station_id = student_join['args'][0]['stationId']

    socket_client.emit('assign_callsign', {'stationId': student_station_id, 'callSign': '11', 'role': 'SUB_STATION'})
    student_client.get_received()

    # Student requests PTT and should be granted if the channel is open.
    student_client.emit('ptt_request', {})
    response = next(item for item in student_client.get_received() if item['name'] == 'ptt_response')
    assert response['args'][0]['allowed'] is True

    # Student sends a valid audio chunk while transmitting.
    audio_payload = b'\x00\x00\x00\x01hello'
    student_client.emit('audio_chunk', audio_payload)

    # Instructor should receive the audio chunk event from the student.
    instructor_events = socket_client.get_received()
    audio_event = next((item for item in instructor_events if item['name'] == 'audio_chunk'), None)
    assert audio_event is not None
    assert audio_event['args'][0] == audio_payload

    student_client.disconnect()


def test_create_net_validation_error(app, socket_client):
    # Emit create_net with invalid data (e.g. invalid callsign_indicator 'ZZ')
    socket_client.emit('create_net', {'name': 'Invalid Net', 'callsign_indicator': 'ZZ'})
    received = socket_client.get_received()
    response = next(item for item in received if item['name'] == 'create_response')['args'][0]
    assert response['success'] is False
    assert 'reason' in response


def test_join_net_error_cases(app, socket_client):
    # Test invalid PIN
    socket_client.emit('join_net', {'pin': 'XXXX', 'nickname': 'User1', 'role': 'SUB_STATION'})
    received = socket_client.get_received()
    resp = next(item for item in received if item['name'] == 'join_response')['args'][0]
    assert resp['success'] is False
    assert 'Invalid Net PIN' in resp['reason']

    # Create a net session
    socket_client.emit('create_net', {'name': 'Join Errors Net', 'callsign_indicator': 'J'})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    # Create a separate net session for CONTROL join
    socket_client.emit('create_net', {'name': 'Control Net', 'callsign_indicator': 'C'})
    ctrl_pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    # Join student with nickname 'INSTRUCTOR' (defaults to CONTROL role and callsign)
    student1 = socketio.test_client(app, flask_test_client=app.test_client())
    student1.emit('join_net', {'pin': ctrl_pin, 'nickname': 'INSTRUCTOR', 'role': 'SUB_STATION'})
    resp_ctrl = next(item for item in student1.get_received() if item['name'] == 'join_response')['args'][0]
    assert resp_ctrl['success'] is True
    assert resp_ctrl['role'] == 'CONTROL'
    student1.disconnect()

    # Try duplicate active nickname on Join Errors Net
    student2 = socketio.test_client(app, flask_test_client=app.test_client())
    student2.emit('join_net', {'pin': pin, 'nickname': 'OperatorA', 'role': 'SUB_STATION'})
    student2.get_received()

    student3 = socketio.test_client(app, flask_test_client=app.test_client())
    student3.emit('join_net', {'pin': pin, 'nickname': 'OperatorA', 'role': 'SUB_STATION'})
    resp_dup = next(item for item in student3.get_received() if item['name'] == 'join_response')['args'][0]
    assert resp_dup['success'] is False
    assert 'already in use' in resp_dup['reason']

    student2.disconnect()
    student3.disconnect()

    # Test joining a CLOSED session
    db = db_session()
    closed_session = NetSession(name="Closed Net", pin="CLOS", callsign_indicator="C", status="CLOSED")
    db.add(closed_session)
    db.commit()

    student_closed = socketio.test_client(app, flask_test_client=app.test_client())
    student_closed.emit('join_net', {'pin': 'CLOS', 'nickname': 'OperatorB'})
    resp_closed = next(item for item in student_closed.get_received() if item['name'] == 'join_response')['args'][0]
    assert resp_closed['success'] is False
    assert 'closed' in resp_closed['reason']
    student_closed.disconnect()



def test_assign_callsign_error_cases(app, socket_client):
    # Setup net session
    socket_client.emit('create_net', {'name': 'Assign Net', 'callsign_indicator': 'A'})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    student = socketio.test_client(app, flask_test_client=app.test_client())
    student.emit('join_net', {'pin': pin, 'nickname': 'StudentX', 'role': 'SUB_STATION'})
    student_id = next(item for item in student.get_received() if item['name'] == 'join_response')['args'][0]['stationId']

    # Unauthorized client (student trying to assign callsign)
    student.emit('assign_callsign', {'stationId': student_id, 'callSign': '10'})
    err = next(item for item in student.get_received() if item['name'] == 'error')['args'][0]
    assert err['reason'] == 'Unauthorized action.'

    # Instructor joins
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'InstAssign', 'role': 'INSTRUCTOR'})
    socket_client.get_received()

    # Non-existent station ID
    socket_client.emit('assign_callsign', {'stationId': 99999, 'callSign': '10'})
    err_station = next(item for item in socket_client.get_received() if item['name'] == 'error')['args'][0]
    assert err_station['reason'] == 'Station not found.'

    # Assign callsign to student successfully
    socket_client.emit('assign_callsign', {'stationId': student_id, 'callSign': '10'})
    socket_client.get_received()
    student.get_received()

    # Join student2 and try to assign duplicate callsign
    student2 = socketio.test_client(app, flask_test_client=app.test_client())
    student2.emit('join_net', {'pin': pin, 'nickname': 'StudentY', 'role': 'SUB_STATION'})
    s2_id = next(item for item in student2.get_received() if item['name'] == 'join_response')['args'][0]['stationId']

    socket_client.emit('assign_callsign', {'stationId': s2_id, 'callSign': '10'})
    err_dup = next(item for item in socket_client.get_received() if item['name'] == 'error')['args'][0]
    assert 'already assigned' in err_dup['reason']

    student.disconnect()
    student2.disconnect()


def test_ptt_request_denials_and_control_override(app, socket_client):
    socket_client.emit('create_net', {'name': 'PTT Net', 'callsign_indicator': 'P'})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    # Instructor joins as CONTROL
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'ControlStation', 'role': 'CONTROL'})
    socket_client.get_received()

    # Student 1 joins but is AWAITING_ASSIGNMENT
    student1 = socketio.test_client(app, flask_test_client=app.test_client())
    student1.emit('join_net', {'pin': pin, 'nickname': 'UnassignedStudent'})
    s1_id = next(item for item in student1.get_received() if item['name'] == 'join_response')['args'][0]['stationId']

    # PTT request while unassigned -> denied
    student1.emit('ptt_request', {})
    ptt_resp = next(item for item in student1.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_resp['allowed'] is False
    assert 'not assigned' in ptt_resp['reason']

    # Assign callsign to Student 1
    socket_client.emit('assign_callsign', {'stationId': s1_id, 'callSign': '01'})
    student1.get_received()
    socket_client.get_received()

    # Student 1 gets PTT key
    student1.emit('ptt_request', {})
    ptt_granted = next(item for item in student1.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_granted['allowed'] is True
    tx_id_s1 = ptt_granted['transmissionId']

    # Student 2 tries PTT while Student 1 is transmitting -> Channel Busy
    student2 = socketio.test_client(app, flask_test_client=app.test_client())
    student2.emit('join_net', {'pin': pin, 'nickname': 'StudentTwo'})
    s2_id = next(item for item in student2.get_received() if item['name'] == 'join_response')['args'][0]['stationId']
    socket_client.emit('assign_callsign', {'stationId': s2_id, 'callSign': '02'})
    student2.get_received()
    socket_client.get_received()

    student2.emit('ptt_request', {})
    ptt_busy = next(item for item in student2.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_busy['allowed'] is False
    assert 'Channel Busy' in ptt_busy['reason']

    # CONTROL station requests PTT while Student 1 is transmitting -> Override / Break-in
    socket_client.emit('ptt_request', {})
    ptt_ctrl = next(item for item in socket_client.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_ctrl['allowed'] is True

    # Student 1 receives ptt_override event
    s1_events = student1.get_received()
    override_evt = next(item for item in s1_events if item['name'] == 'ptt_override')['args'][0]
    assert override_evt['reason'] == 'NCS_BREAK_IN'

    # Release CONTROL PTT
    socket_client.emit('ptt_release', {'transmissionId': ptt_ctrl['transmissionId']})
    socket_client.get_received()

    # Test MUTED student PTT request
    db = db_session()
    st1 = db.query(Station).filter_by(id=s1_id).first()
    st1.status = 'MUTED'
    db.commit()
    db_session.remove()

    student1.emit('ptt_request', {})
    ptt_muted = next(item for item in student1.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_muted['allowed'] is False
    assert 'muted' in ptt_muted['reason']

    # Test PTT request when NetSession status is SUSPENDED
    st1 = db.query(Station).filter_by(id=s1_id).first()
    st1.status = 'CONNECTED'
    session_obj = db.query(NetSession).filter_by(pin=pin).first()
    session_obj.status = 'SUSPENDED'
    db.commit()
    db_session.remove()


    student1.emit('ptt_request', {})
    ptt_susp = next(item for item in student1.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_susp['allowed'] is False
    assert 'suspended' in ptt_susp['reason']

    student1.disconnect()
    student2.disconnect()



def test_audio_chunk_edge_cases(app, socket_client):
    socket_client.emit('create_net', {'name': 'Audio Edge Net', 'callsign_indicator': 'E'})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    socket_client.emit('join_net', {'pin': pin, 'nickname': 'AudioInst', 'role': 'INSTRUCTOR'})
    socket_client.get_received()

    # Invalid audio chunk data (too short or wrong type)
    socket_client.emit('audio_chunk', b'12')
    socket_client.emit('audio_chunk', 'not bytes')
    assert len(socket_client.get_received()) == 0

    # Emit chunk when station is not in TRANSMITTING state
    socket_client.emit('audio_chunk', b'\x00\x00\x00\x01data')
    assert len(socket_client.get_received()) == 0


def test_sync_log_entry_draft_and_finalized_locking(app, socket_client):
    socket_client.emit('create_net', {'name': 'Log Net', 'callsign_indicator': 'L'})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    # Student joins and gets callsign
    student = socketio.test_client(app, flask_test_client=app.test_client())
    student.emit('join_net', {'pin': pin, 'nickname': 'LogStudent'})
    join_resp = next(item for item in student.get_received() if item['name'] == 'join_response')['args'][0]
    net_id = join_resp['netId']
    station_id = join_resp['stationId']

    # Unassigned station sync_log_entry -> fails
    entry_payload = {
        'entryId': 'log-001',
        'dtg': '281015Z JUL 26',
        'from_call_sign': 'L01',
        'to_call_sign': 'CONTROL',
        'precedence': 'ROUTINE',
        'event_text': 'Draft message text',
        'operator_initials': 'LS'
    }
    student.emit('sync_log_entry', {'netId': net_id, 'entry': entry_payload})
    sync_unauth = next(item for item in student.get_received() if item['name'] == 'sync_response')['args'][0]
    assert sync_unauth['success'] is False

    # Assign callsign
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'LogInst', 'role': 'INSTRUCTOR'})
    socket_client.get_received()
    socket_client.emit('assign_callsign', {'stationId': station_id, 'callSign': '01'})
    socket_client.get_received()
    student.get_received()

    # Invalid LogEntry validation failure
    bad_payload = {**entry_payload, 'dtg': 'INVALID_DTG'}
    student.emit('sync_log_entry', {'netId': net_id, 'entry': bad_payload})
    sync_invalid = next(item for item in student.get_received() if item['name'] == 'sync_response')['args'][0]
    assert sync_invalid['success'] is False

    # Sync valid new entry (finalized with operator_initials = 'LS')
    student.emit('sync_log_entry', {'netId': net_id, 'entry': entry_payload})
    sync_ok = next(item for item in student.get_received() if item['name'] == 'sync_response')['args'][0]
    assert sync_ok['success'] is True
    assert sync_ok['entryId'] == 'log-001'

    # Try modifying finalized/locked entry -> fails
    modified_payload = {**entry_payload, 'event_text': 'Attempted edit after locking'}
    student.emit('sync_log_entry', {'netId': net_id, 'entry': modified_payload})
    sync_locked = next(item for item in student.get_received() if item['name'] == 'sync_response')['args'][0]
    assert sync_locked['success'] is False
    assert 'locked/finalized' in sync_locked['reason']

    student.disconnect()



def test_radio_check_start_and_set_signal_quality(app, socket_client):
    socket_client.emit('create_net', {'name': 'Radio Check Net', 'callsign_indicator': 'R'})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    student = socketio.test_client(app, flask_test_client=app.test_client())
    student.emit('join_net', {'pin': pin, 'nickname': 'RadioCheckStudent'})
    student_id = next(item for item in student.get_received() if item['name'] == 'join_response')['args'][0]['stationId']

    # Student attempts start_radio_check or set_signal_quality -> Unauthorized
    student.emit('start_radio_check', {})
    err1 = next(item for item in student.get_received() if item['name'] == 'error')['args'][0]
    assert err1['reason'] == 'Unauthorized action.'

    student.emit('set_signal_quality', {'stationId': student_id, 'signalQuality': 'POOR'})
    err2 = next(item for item in student.get_received() if item['name'] == 'error')['args'][0]
    assert err2['reason'] == 'Unauthorized action.'

    # Instructor joins
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'RadioCheckInst', 'role': 'INSTRUCTOR'})
    socket_client.get_received()

    # Instructor starts radio check before any active sub-stations are connected -> error
    socket_client.emit('start_radio_check', {})
    err_no_sub = next(item for item in socket_client.get_received() if item['name'] == 'error')['args'][0]
    assert 'No active sub-stations' in err_no_sub['reason']

    # Assign callsign to student
    socket_client.emit('assign_callsign', {'stationId': student_id, 'callSign': '05'})
    socket_client.get_received()
    student.get_received()

    # Instructor alters signal quality
    socket_client.emit('set_signal_quality', {'stationId': student_id, 'signalQuality': 'POOR'})
    roster_evt = next(item for item in socket_client.get_received() if item['name'] == 'roster_update')['args'][0]
    sub_station = next(s for s in roster_evt['stations'] if s['stationId'] == student_id)
    assert sub_station['signalQuality'] == 'POOR'

    student.disconnect()


def test_end_session_and_ephemeral_purge(app, socket_client):
    socket_client.emit('create_net', {'name': 'Purge Net', 'callsign_indicator': 'P'})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    student = socketio.test_client(app, flask_test_client=app.test_client())
    student.emit('join_net', {'pin': pin, 'nickname': 'PurgeStudent'})
    student.get_received()

    # Student attempts end_session -> error
    student.emit('end_session', {})
    err = next(item for item in student.get_received() if item['name'] == 'error')['args'][0]
    assert err['reason'] == 'Unauthorized action.'

    # Instructor joins and ends session
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'PurgeInst', 'role': 'INSTRUCTOR'})
    socket_client.get_received()

    socket_client.emit('end_session', {})
    inst_received = socket_client.get_received()
    ended_evt = next(item for item in inst_received if item['name'] == 'session_ended')['args'][0]
    assert ended_evt['reason'] == 'SESSION_CLOSED_BY_INSTRUCTOR'

    student.disconnect()

