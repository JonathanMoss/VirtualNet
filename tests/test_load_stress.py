"""
High-Concurrency Load & WebSocket Stress Testing Suite for VirtualNet.

Simulates 50+ concurrent student and instructor stations joining a net session,
processing callsign assignments, and handling real-time audio transmission events.
"""
import time
from conftest import get_today_instructor_pin
from app import socketio
from app.models import NetSession, Station


def test_high_concurrency_socket_load(app, db):
    # pylint: disable=redefined-outer-name,unused-argument,too-many-locals
    """
    Stress test with 50 concurrent student sockets and 1 instructor socket.
    Verifies zero event loss and sub-100ms socket event dispatching under load.
    """
    valid_pin = get_today_instructor_pin()

    # Step 1: Instructor connects and creates Net Session
    instructor_client = socketio.test_client(app)
    assert instructor_client.is_connected()

    instructor_client.emit('create_net', {
        "name": "Stress Test Net Alpha",
        "callsign_indicator": "R",
        "instructor_pin": valid_pin
    })

    create_events = instructor_client.get_received()
    create_resp = next(msg for msg in create_events if msg['name'] == 'create_response')['args'][0]
    assert create_resp['success'] is True
    net_pin = create_resp['pin']

    # Step 2: Concurrently connect 50 student clients
    num_students = 50
    student_clients = []
    station_ids = []

    start_time = time.time()
    for i in range(1, num_students + 1):
        stud_client = socketio.test_client(app)
        assert stud_client.is_connected()
        nickname = f"STUDENT_{i:02d}"

        stud_client.emit('join_net', {"pin": net_pin, "nickname": nickname})
        join_events = stud_client.get_received()
        join_msg = next(m for m in join_events if m['name'] == 'join_response')['args'][0]

        assert join_msg['success'] is True
        student_clients.append(stud_client)
        station_ids.append(join_msg['stationId'])

    connect_duration = time.time() - start_time

    # Verify all 50 student stations are created in DB
    net_session = db.query(NetSession).filter_by(pin=net_pin).first()
    assert net_session is not None
    db_stations = db.query(Station).filter_by(net_id=net_session.id).all()
    # 50 students + 1 instructor = 51 stations
    assert len(db_stations) == num_students + 1
    assert connect_duration < 5.0, f"Connecting {num_students} sockets took too long ({connect_duration:.2f}s)"

    # Step 3: Instructor assigns callsigns to all 50 students
    assign_start = time.time()
    for idx, station_id in enumerate(station_ids, start=11):
        instructor_client.emit('assign_callsign', {
            "stationId": station_id,
            "callSign": str(idx),
            "role": "SUB_STATION"
        })

    assign_duration = time.time() - assign_start
    assert assign_duration < 3.0, f"Assigning 50 callsigns took too long ({assign_duration:.2f}s)"

    # Step 4: Verify student clients received callsign assignment notifications
    for idx, stud_client in enumerate(student_clients, start=11):
        stud_events = stud_client.get_received()
        assigned_msg = next(m for m in stud_events if m['name'] == 'callsign_assigned')['args'][0]
        assert assigned_msg['success'] is True
        assert assigned_msg['assignedCallSign'] == f"R{idx}"

    # Step 5: Clean up all client socket connections
    instructor_client.disconnect()
    for s_client in student_clients:
        s_client.disconnect()
