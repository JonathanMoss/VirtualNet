"""Socket event integration tests for VirtualNet WebSocket communication."""
import struct
import time
import pytest
from conftest import get_today_instructor_pin

from app import create_app, socketio
from app.database import Base, db_session, engine, init_db
from app.models import NetSession, Station
from app.sockets import sid_to_station_id, station_id_to_sid, transmitting_sids




@pytest.fixture(scope="function")
def app():
    """Create the Flask app and initialize the database for socket tests."""
    app_instance = create_app()
    app_instance.config['TESTING'] = True
    init_db()
    yield app_instance
    db_session.remove()
    Base.metadata.drop_all(bind=engine)
    sid_to_station_id.clear()
    station_id_to_sid.clear()
    transmitting_sids.clear()


@pytest.fixture
def socket_client(app, db):
    # pylint: disable=redefined-outer-name,unused-argument
    """Fixture providing a connected SocketIO test client."""
    client = socketio.test_client(app)
    assert client.is_connected()
    yield client
    if client.is_connected():
        client.disconnect()
    sid_to_station_id.clear()
    station_id_to_sid.clear()
    transmitting_sids.clear()


def test_join_net_and_assign_callsign(app, socket_client):
    # pylint: disable=redefined-outer-name,too-many-locals
    """Test joining a net as student and callsign assignment by instructor."""
    valid_pin = get_today_instructor_pin()
    # Instructor creates a net and joins as an instructor.
    socket_client.emit('create_net', {'name': 'Socket LAN Net', 'callsign_indicator': 'R', 'instructor_pin': valid_pin})
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

    student_client = socketio.test_client(app)
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
    # pylint: disable=redefined-outer-name
    """Test broadcasting audio chunks from speaker to connected stations."""
    valid_pin = get_today_instructor_pin()
    socket_client.emit('create_net', {'name': 'Audio Net', 'callsign_indicator': 'R', 'instructor_pin': valid_pin})
    received = socket_client.get_received()
    pin = next(item for item in received if item['name'] == 'create_response')['args'][0]['pin']

    # Instructor joins
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'InstructorA', 'role': 'INSTRUCTOR'})
    instruct_join = next(item for item in socket_client.get_received() if item['name'] == 'join_response')
    assert instruct_join['args'][0]['success'] is True

    # Student joins and receives a callsign
    student_client = socketio.test_client(app)
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
    # pylint: disable=redefined-outer-name,unused-argument
    """Test validation errors when creating a net session."""
    valid_pin = get_today_instructor_pin()
    # Emit create_net with invalid data (e.g. invalid callsign_indicator 'ZZ')
    socket_client.emit('create_net', {'name': 'Invalid Net', 'callsign_indicator': 'ZZ', 'instructor_pin': valid_pin})
    received = socket_client.get_received()
    response = next(item for item in received if item['name'] == 'create_response')['args'][0]
    assert response['success'] is False
    assert 'reason' in response


def test_create_net_invalid_instructor_pin(app, socket_client):
    # pylint: disable=redefined-outer-name,unused-argument
    """Test rejection when creating a net session with an invalid 6-digit instructor PIN."""
    socket_client.emit('create_net', {'name': 'Invalid Pin Net', 'callsign_indicator': 'R', 'instructor_pin': '000000'})
    received = socket_client.get_received()
    response = next(item for item in received if item['name'] == 'create_response')['args'][0]
    assert response['success'] is False
    assert 'Invalid 6-digit Instructor PIN' in response['reason']


def test_join_net_error_cases(app, socket_client):
    # pylint: disable=redefined-outer-name,too-many-locals
    """Test edge cases and error responses when joining net sessions."""
    valid_pin = get_today_instructor_pin()
    # Test invalid PIN
    socket_client.emit('join_net', {'pin': 'XXXX', 'nickname': 'User1', 'role': 'SUB_STATION'})
    received = socket_client.get_received()
    resp = next(item for item in received if item['name'] == 'join_response')['args'][0]
    assert resp['success'] is False
    assert 'Invalid Net PIN' in resp['reason']

    # Create a net session
    socket_client.emit(
        'create_net',
        {'name': 'Join Errors Net', 'callsign_indicator': 'J', 'instructor_pin': valid_pin}
    )

    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    socket_client.emit('create_net', {'name': 'Control Net', 'callsign_indicator': 'C', 'instructor_pin': valid_pin})
    ctrl_resp = socket_client.get_received()
    ctrl_pin = next(item for item in ctrl_resp if item['name'] == 'create_response')['args'][0]['pin']

    # Join instructor on Control Net (reconnects creator socket)
    socket_client.emit('join_net', {'pin': ctrl_pin, 'nickname': 'INSTRUCTOR', 'role': 'INSTRUCTOR'})
    resp_ctrl = next(item for item in socket_client.get_received() if item['name'] == 'join_response')['args'][0]
    assert resp_ctrl['success'] is True
    assert resp_ctrl['role'] == 'CONTROL'

    # Try duplicate active nickname on Join Errors Net
    student2 = socketio.test_client(app)
    student2.emit('join_net', {'pin': pin, 'nickname': 'OperatorA', 'role': 'SUB_STATION'})
    student2.get_received()

    student3 = socketio.test_client(app)
    student3.emit('join_net', {'pin': pin, 'nickname': 'OperatorA', 'role': 'SUB_STATION'})
    resp_dup = next(item for item in student3.get_received() if item['name'] == 'join_response')['args'][0]
    assert resp_dup['success'] is False
    assert 'already in use' in resp_dup['reason']

    student2.disconnect()
    student3.disconnect()

    # Test joining a CLOSED session
    session_db = db_session()
    closed_session = NetSession(name="Closed Net", pin="CLOS", callsign_indicator="C", status="CLOSED")
    session_db.add(closed_session)
    session_db.commit()

    student_closed = socketio.test_client(app)
    student_closed.emit('join_net', {'pin': 'CLOS', 'nickname': 'OperatorB'})
    resp_closed = next(item for item in student_closed.get_received() if item['name'] == 'join_response')['args'][0]
    assert resp_closed['success'] is False
    assert 'closed' in resp_closed['reason']
    student_closed.disconnect()


def test_assign_callsign_error_cases(app, socket_client):
    # pylint: disable=redefined-outer-name
    """Test unauthorized actions and duplicate errors in assign_callsign."""
    valid_pin = get_today_instructor_pin()
    # Setup net session
    socket_client.emit('create_net', {'name': 'Assign Net', 'callsign_indicator': 'A', 'instructor_pin': valid_pin})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    student = socketio.test_client(app)
    student.emit('join_net', {'pin': pin, 'nickname': 'StudentX', 'role': 'SUB_STATION'})
    s_resp = student.get_received()
    student_id = next(item for item in s_resp if item['name'] == 'join_response')['args'][0]['stationId']

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
    student2 = socketio.test_client(app)
    student2.emit('join_net', {'pin': pin, 'nickname': 'StudentY', 'role': 'SUB_STATION'})
    s2_id = next(item for item in student2.get_received() if item['name'] == 'join_response')['args'][0]['stationId']

    socket_client.emit('assign_callsign', {'stationId': s2_id, 'callSign': '10'})
    err_dup = next(item for item in socket_client.get_received() if item['name'] == 'error')['args'][0]
    assert 'already assigned' in err_dup['reason']

    student.disconnect()
    student2.disconnect()


def test_ptt_request_denials_and_control_override(app, socket_client):
    # pylint: disable=redefined-outer-name,too-many-locals,too-many-statements
    """Test PTT request denials, channel busy responses, and CONTROL break-in override."""
    valid_pin = get_today_instructor_pin()
    socket_client.emit('create_net', {'name': 'PTT Net', 'callsign_indicator': 'P', 'instructor_pin': valid_pin})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    # Instructor joins as CONTROL
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'ControlStation', 'role': 'CONTROL'})
    socket_client.get_received()

    # Student 1 joins but is AWAITING_ASSIGNMENT
    student1 = socketio.test_client(app)
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

    # Student 2 tries PTT while Student 1 is transmitting -> Channel Busy
    student2 = socketio.test_client(app)
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
    session_db = db_session()
    st1 = session_db.query(Station).filter_by(id=s1_id).first()
    st1.status = 'MUTED'
    session_db.commit()
    db_session.remove()

    student1.emit('ptt_request', {})
    ptt_muted = next(item for item in student1.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_muted['allowed'] is False
    assert 'muted' in ptt_muted['reason']

    # Test PTT request when NetSession status is SUSPENDED
    st1 = session_db.query(Station).filter_by(id=s1_id).first()
    st1.status = 'CONNECTED'
    session_obj = session_db.query(NetSession).filter_by(pin=pin).first()
    session_obj.status = 'SUSPENDED'
    session_db.commit()
    db_session.remove()

    student1.emit('ptt_request', {})
    ptt_susp = next(item for item in student1.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_susp['allowed'] is False
    assert 'suspended' in ptt_susp['reason']

    student1.disconnect()
    student2.disconnect()


def test_audio_chunk_edge_cases(app, socket_client):
    # pylint: disable=redefined-outer-name,unused-argument
    """Test audio_chunk edge cases for short payloads and non-transmitting stations."""
    valid_pin = get_today_instructor_pin()
    socket_client.emit('create_net', {'name': 'Audio Edge Net', 'callsign_indicator': 'E', 'instructor_pin': valid_pin})
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
    # pylint: disable=redefined-outer-name
    """Test log entry synchronization and finalized entry locking immutability."""
    valid_pin = get_today_instructor_pin()
    socket_client.emit('create_net', {'name': 'Log Net', 'callsign_indicator': 'L', 'instructor_pin': valid_pin})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    # Student joins and gets callsign
    student = socketio.test_client(app)
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
    # pylint: disable=redefined-outer-name
    """Test start_radio_check authorization and set_signal_quality events."""
    valid_pin = get_today_instructor_pin()
    socket_client.emit(
        'create_net',
        {'name': 'Radio Check Net', 'callsign_indicator': 'R', 'instructor_pin': valid_pin}
    )

    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    student = socketio.test_client(app)
    student.emit('join_net', {'pin': pin, 'nickname': 'RadioCheckStudent'})
    st_resp = student.get_received()
    student_id = next(item for item in st_resp if item['name'] == 'join_response')['args'][0]['stationId']

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
    assert sub_station['status'] == 'CONNECTED'

    student.disconnect()


def test_rejoin_session_and_unworkable_grace_period(app, socket_client):
    # pylint: disable=redefined-outer-name,too-many-locals
    """Test rejoining session with stationId, preserving callsign, and UNWORKABLE grace period."""
    valid_pin = get_today_instructor_pin()
    socket_client.emit('create_net', {'name': 'Rejoin Net', 'callsign_indicator': 'R', 'instructor_pin': valid_pin})
    create_resp = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]
    pin = create_resp['pin']

    # Instructor joins
    socket_client.emit('join_net', {'pin': pin, 'nickname': 'InstructorOne', 'role': 'INSTRUCTOR'})
    inst_join = next(item for item in socket_client.get_received() if item['name'] == 'join_response')['args'][0]
    inst_station_id = inst_join['stationId']

    # Student joins
    student = socketio.test_client(app)
    student.emit('join_net', {'pin': pin, 'nickname': 'StudentOne', 'role': 'SUB_STATION'})
    st_join = next(item for item in student.get_received() if item['name'] == 'join_response')['args'][0]
    student_station_id = st_join['stationId']

    # Instructor assigns callsign R11 to student
    socket_client.emit('assign_callsign', {'stationId': student_station_id, 'callSign': '11'})
    socket_client.get_received()
    student.get_received()

    # Student disconnects (simulating refresh / Wi-Fi drop)
    student.disconnect()

    # Instructor receives roster update showing student status UNWORKABLE
    inst_events = socket_client.get_received()
    roster_evt = next(item for item in inst_events if item['name'] == 'roster_update')['args'][0]
    unworkable_st = next(s for s in roster_evt['stations'] if s['stationId'] == student_station_id)
    assert unworkable_st['status'] == 'UNWORKABLE'
    assert 'Active' in unworkable_st['lastActiveAgo'] or '0s' in unworkable_st['lastActiveAgo']

    # Student reconnects with stationId & pin from cookie
    student_rejoin = socketio.test_client(app)
    student_rejoin.emit(
        'join_net',
        {'pin': pin, 'nickname': 'StudentOne', 'role': 'SUB_STATION', 'stationId': student_station_id}
    )
    rejoin_resp = next(item for item in student_rejoin.get_received() if item['name'] == 'join_response')['args'][0]

    assert rejoin_resp['success'] is True
    assert rejoin_resp['stationId'] == student_station_id
    assert rejoin_resp['callSign'] == 'R11'
    assert rejoin_resp['status'] == 'CONNECTED'

    # Instructor roster updates back to CONNECTED
    inst_events2 = socket_client.get_received()
    roster_evt2 = next(item for item in inst_events2 if item['name'] == 'roster_update')['args'][0]
    connected_st = next(s for s in roster_evt2['stations'] if s['stationId'] == student_station_id)
    assert connected_st['status'] == 'CONNECTED'

    # Instructor disconnects and reconnects (simulating instructor refresh)
    if socket_client.is_connected():
        socket_client.disconnect()
    inst_rejoin = socketio.test_client(app)
    inst_rejoin.emit(
        'join_net',
        {'pin': pin, 'nickname': 'InstructorOne', 'role': 'INSTRUCTOR', 'stationId': inst_station_id}
    )
    inst_rejoin_resp = next(item for item in inst_rejoin.get_received() if item['name'] == 'join_response')['args'][0]

    assert inst_rejoin_resp['success'] is True
    assert inst_rejoin_resp['role'] == 'INSTRUCTOR'
    assert inst_rejoin_resp['pin'] == pin
    assert inst_rejoin_resp['callSign'] == 'CONTROL'

    # Student explicitly leaves net
    student_rejoin.emit('leave_net', {})
    inst_rejoin_events = inst_rejoin.get_received()

    # Roster updated and student is removed from roster
    roster_evt3 = next(item for item in inst_rejoin_events if item['name'] == 'roster_update')['args'][0]
    left_st = next((s for s in roster_evt3['stations'] if s['stationId'] == student_station_id), None)
    assert left_st is None

    student_rejoin.disconnect()
    inst_rejoin.disconnect()


def test_end_session_and_ephemeral_purge(app, socket_client):
    # pylint: disable=redefined-outer-name
    """Test session termination by instructor and purging ephemeral data."""
    valid_pin = get_today_instructor_pin()
    socket_client.emit('create_net', {'name': 'Purge Net', 'callsign_indicator': 'P', 'instructor_pin': valid_pin})
    pin = next(item for item in socket_client.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    student = socketio.test_client(app)
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


def test_realtime_audio_transmission_latency_benchmark(app, db):
    # pylint: disable=redefined-outer-name,too-many-locals,unused-argument
    """Benchmark real-time zero-DB audio packet forwarding latency between 2 clients."""
    valid_pin = get_today_instructor_pin()
    # Create Net Session
    instructor = socketio.test_client(app)
    instructor.emit('create_net', {'name': 'Latency Net', 'callsign_indicator': 'L', 'instructor_pin': valid_pin})
    pin = next(item for item in instructor.get_received() if item['name'] == 'create_response')['args'][0]['pin']

    # Join Instructor & Student
    instructor.emit('join_net', {'pin': pin, 'nickname': 'InstCtrl', 'role': 'INSTRUCTOR'})
    instructor.get_received()

    student = socketio.test_client(app)
    student.emit('join_net', {'pin': pin, 'nickname': 'StudentSpeaker'})
    s_resp = student.get_received()
    student_id = next(item for item in s_resp if item['name'] == 'join_response')['args'][0]['stationId']

    # Assign Callsign to Student
    instructor.emit('assign_callsign', {'stationId': student_id, 'callSign': '01'})
    instructor.get_received()
    student.get_received()

    # Student Requests PTT
    student.emit('ptt_request', {})
    ptt_resp = next(item for item in student.get_received() if item['name'] == 'ptt_response')['args'][0]
    assert ptt_resp['allowed'] is True

    # Stream 100 timestamped audio chunks from Student to Instructor
    latencies_ms = []
    num_packets = 100

    for idx in range(1, num_packets + 1):
        send_time = time.time()
        # Binary payload: 4-byte tx_id + 8-byte send timestamp + 64-byte audio frame
        payload = struct.pack('!I d', 1, send_time) + (b'X' * 64)

        student.emit('audio_chunk', payload)

        # Instructor receives packet
        received = instructor.get_received()
        recv_time = time.time()

        audio_evt = next((m for m in received if m['name'] == 'audio_chunk'), None)
        assert audio_evt is not None, f"Packet {idx} dropped or missing!"

        recv_payload = audio_evt['args'][0]
        _, pkt_send_time = struct.unpack('!I d', recv_payload[:12])

        latency = (recv_time - pkt_send_time) * 1000.0  # ms
        latencies_ms.append(latency)

    # Calculate Benchmark Metrics
    avg_latency = sum(latencies_ms) / len(latencies_ms)
    min_latency = min(latencies_ms)
    max_latency = max(latencies_ms)
    sorted_latencies = sorted(latencies_ms)
    p99_latency = sorted_latencies[int(len(sorted_latencies) * 0.99) - 1]

    print("\n" + "=" * 50)
    print(" 🚀 REAL-TIME ZERO-DB AUDIO LATENCY BENCHMARK RESULT")
    print("=" * 50)
    print(f" Packets Sent / Delivered: {num_packets} / {len(latencies_ms)} (100% Delivery)")
    print(f" Average Broadcast Latency: {avg_latency:.3f} ms")
    print(f" Minimum Latency          : {min_latency:.3f} ms")
    print(f" Maximum Latency          : {max_latency:.3f} ms")
    print(f" 99th Percentile (p99)    : {p99_latency:.3f} ms")
    print("=" * 50)

    # Assert sub-15ms average latency inside container
    assert avg_latency < 15.0, f"Average latency too high: {avg_latency:.3f} ms"

    # Clean up
    student.emit('ptt_release', {'transmissionId': ptt_resp['transmissionId']})
    student.disconnect()
    instructor.disconnect()
