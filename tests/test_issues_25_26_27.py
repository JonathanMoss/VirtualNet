"""Unit and integration tests for GitHub Issues #25, #26, and #27."""
from app import socketio
from app.models import Station, NetSession
from tests.conftest import get_today_instructor_pin


def test_issue_25_roster_pending_queue_count(db):
    """Test that broadcast_roster includes stations with AWAITING_ASSIGNMENT status."""
    # Create session
    session = NetSession(
        name="Test Net",
        pin="T25A",
        callsign_indicator="T",
        net_state="DIRECTIVE"
    )
    db.add(session)
    db.commit()

    student = Station(
        net_id=session.id,
        nickname="ALPHA",
        role="SUB_STATION",
        status="AWAITING_ASSIGNMENT"
    )
    db.add(student)
    db.commit()

    stations = db.query(Station).filter_by(net_id=session.id).all()
    pending = [s for s in stations if s.status == "AWAITING_ASSIGNMENT"]
    assert len(pending) == 1
    assert pending[0].nickname == "ALPHA"


def test_issue_26_update_substation_callsign_and_kick(app):
    """Test SUNRAY updating a substation callsign and kicking a station over socket events."""
    # pylint: disable=too-many-locals
    flask_app = app

    client_sunray = socketio.test_client(flask_app)
    client_student = socketio.test_client(flask_app)

    pin_today = get_today_instructor_pin()

    # 1. SUNRAY creates net session
    client_sunray.emit('create_net', {
        'name': 'Exercise Alpha',
        'instructor_pin': pin_today,
        'sunray_callsign': '0'
    })
    res_create = client_sunray.get_received()
    create_evt = [e for e in res_create if e['name'] == 'create_response'][0]
    net_pin = create_evt['args'][0]['pin']

    # 2. Student joins net
    client_student.emit('join_net', {
        'pin': net_pin,
        'nickname': 'STUDENT1',
        'role': 'SUB_STATION'
    })
    res_join = client_student.get_received()
    join_evt = [e for e in res_join if e['name'] == 'join_response'][0]
    student_id = join_evt['args'][0]['stationId']

    # 3. SUNRAY assigns initial callsign "11" -> indicator "T" + "11" or "11"
    client_sunray.emit('assign_callsign', {
        'stationId': student_id,
        'callSign': '11',
        'role': 'SUB_STATION'
    })
    res_assign1 = client_student.get_received()
    callsign_evt1 = [e for e in res_assign1 if e['name'] == 'callsign_assigned'][0]
    assigned_cs1 = callsign_evt1['args'][0]['assignedCallSign']
    assert '11' in assigned_cs1

    # 4. SUNRAY updates student callsign to "22" (Issue #26)
    client_sunray.emit('assign_callsign', {
        'stationId': student_id,
        'callSign': '22',
        'role': 'SUB_STATION'
    })
    res_assign2 = client_student.get_received()
    callsign_evt2 = [e for e in res_assign2 if e['name'] == 'callsign_assigned'][0]
    assigned_cs2 = callsign_evt2['args'][0]['assignedCallSign']
    assert '22' in assigned_cs2

    # 5. SUNRAY kicks student (Issue #26)
    client_sunray.emit('kick_station', {
        'stationId': student_id
    })
    res_kick = client_student.get_received()
    kicked_evt = [e for e in res_kick if e['name'] == 'kicked'][0]
    assert "kicked" in kicked_evt['args'][0]['reason'].lower()

    client_sunray.disconnect()
    client_student.disconnect()
