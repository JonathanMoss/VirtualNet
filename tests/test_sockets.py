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
