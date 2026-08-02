"""Unit tests for instructor service (telemetry, scenario injects, and net state controls)."""
from app.models import NetSession, Station, LogEntry, Transmission
from app.services import instructor_service


def test_get_net_telemetry_not_found(db):
    """Test telemetry query for non-existent session PIN."""
    res = instructor_service.get_net_telemetry(db, "XXXX")
    assert res["success"] is False
    assert "Session not found" in res["reason"]


def test_get_net_telemetry_and_injects_lifecycle(db):
    # pylint: disable=too-many-locals
    """Test full lifecycle of creating session, querying telemetry, managing injects, and setting net state."""
    session = NetSession(name="Telemetry Net", pin="T123", callsign_indicator="T")
    db.add(session)
    db.commit()

    sunray = Station(net_id=session.id, nickname="SUNRAY", role="SUNRAY", call_sign="0", status="CONNECTED")
    student = Station(net_id=session.id, nickname="Student1", role="SUB_STATION", call_sign="T11", status="CONNECTED")
    db.add(sunray)
    db.add(student)
    db.commit()

    # Initial Telemetry Check
    telemetry = instructor_service.get_net_telemetry(db, "T123")
    assert telemetry["success"] is True
    assert telemetry["netName"] == "Telemetry Net"
    assert telemetry["netState"] == "DIRECTED"
    assert telemetry["stationCount"] == 2

    # Create Inject
    inject_payload = {
        "title": "MEDEVAC 9-LINE",
        "description": "Casualty at Grid 654321",
        "target_call_sign": "T11",
        "time_offset_seconds": 60
    }
    create_res = instructor_service.create_inject(db, session.id, inject_payload)
    assert create_res["success"] is True
    inject_id = create_res["inject"]["id"]
    assert create_res["inject"]["status"] == "PENDING"

    # Invalid Inject Validation Error
    bad_res = instructor_service.create_inject(db, session.id, {"title": "", "description": ""})
    assert bad_res["success"] is False

    # Get Injects
    injects = instructor_service.get_injects(db, session.id)
    assert len(injects) == 1
    assert injects[0]["title"] == "MEDEVAC 9-LINE"

    # Dispatch Inject
    dispatch_res = instructor_service.dispatch_inject(db, inject_id)
    assert dispatch_res["success"] is True
    assert dispatch_res["inject"]["status"] == "DISPATCHED"

    # Dispatch Non-existent Inject
    bad_dispatch = instructor_service.dispatch_inject(db, "non-existent-id")
    assert bad_dispatch["success"] is False

    # Set Net State
    state_res = instructor_service.set_net_state(db, session.id, "FREE")
    assert state_res["success"] is True
    assert state_res["netState"] == "FREE"

    # Invalid Net State
    bad_state = instructor_service.set_net_state(db, session.id, "INVALID_MODE")
    assert bad_state["success"] is False

    # Delete Inject
    delete_res = instructor_service.delete_inject(db, inject_id)
    assert delete_res["success"] is True

    # Delete Non-existent Inject
    bad_delete = instructor_service.delete_inject(db, "non-existent-id")
    assert bad_delete["success"] is False


def test_instructor_api_endpoints(app, db):
    # pylint: disable=redefined-outer-name,too-many-locals
    """Test REST API endpoints for telemetry, roster, logs, and injects."""
    session = NetSession(name="API Net", pin="A999", callsign_indicator="A")
    db.add(session)
    db.commit()

    sunray = Station(
        net_id=session.id,
        nickname="SUNRAY",
        role="SUNRAY",
        call_sign="0",
        status="CONNECTED",
        transmission_status="TRANSMITTING"
    )
    db.add(sunray)
    db.commit()

    log = LogEntry(
        net_id=session.id,
        owner_station_id=sunray.id,
        dtg="281015Z JUL 26",
        from_call_sign="0",
        to_call_sign="11",
        precedence="ROUTINE",
        event_text="Test Log Event",
        operator_initials="AB"
    )
    db.add(log)

    tx = Transmission(
        net_id=session.id,
        sender_call_sign="0",
        termination_reason="PTT_RELEASED"
    )
    db.add(tx)
    db.commit()

    client = app.test_client()

    # Telemetry endpoint
    res = client.get("/api/session/A999/telemetry")
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data["success"] is True
    assert json_data["pin"] == "A999"
    assert len(json_data["activeSpeakers"]) == 1

    # Telemetry endpoint 404
    res_404 = client.get("/api/session/XXXX/telemetry")
    assert res_404.status_code == 404

    # Roster endpoint
    res_roster = client.get("/api/session/A999/roster")
    assert res_roster.status_code == 200
    assert len(res_roster.get_json()["roster"]) == 1

    # Roster endpoint 404
    assert client.get("/api/session/XXXX/roster").status_code == 404

    # Logs endpoint
    res_logs = client.get("/api/session/A999/logs")
    assert res_logs.status_code == 200
    assert len(res_logs.get_json()["logs"]) == 1

    # Logs endpoint 404
    assert client.get("/api/session/XXXX/logs").status_code == 404

    # Injects endpoint
    res_inj = client.get("/api/session/A999/injects")
    assert res_inj.status_code == 200

    # Injects endpoint 404
    assert client.get("/api/session/XXXX/injects").status_code == 404

    # Create inject non-existent session
    bad_create = instructor_service.create_inject(db, "non-existent-net-id", {
        "title": "Test", "description": "Test"
    })
    assert bad_create["success"] is False

    # Set net state non-existent session
    bad_set = instructor_service.set_net_state(db, "non-existent-net-id", "FREE")
    assert bad_set["success"] is False
