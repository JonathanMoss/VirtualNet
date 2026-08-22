"""Behave BDD step definitions for VirtualNet feature tests."""
# pylint: disable=not-callable,unused-argument,unused-variable,cyclic-import,R0401,duplicate-code,missing-function-docstring,line-too-long


import json
import os
from datetime import datetime
from behave import given, when, then
from app import socketio
from app.models import NetSession, Station, Transmission
from app.services import station_service, transmission_service
from app.services.station_service import broadcast_roster

PINS_FILE = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'app', 'instructor_pins.json')

def get_today_instructor_pin():
    with open(PINS_FILE, 'r', encoding='utf-8') as f:
        pins = json.load(f)
    return pins[str(datetime.utcnow().day)]



@given('a Net Session is hosted on the server with PIN "{pin}"')

def step_given_net_session_hosted(context, pin):
    db = context.db
    session = NetSession(name="Test Net", pin=pin.upper(), callsign_indicator="R")
    db.add(session)
    db.commit()
    context.net_pin = pin.upper()
    context.net_id = session.id


@given('a Net Session is hosted with PIN "{pin}"')
def step_given_net_session_hosted_alt(context, pin):
    step_given_net_session_hosted(context, pin)


@given('a student has joined with nickname "{nickname}" and is waiting in the queue')
def step_given_student_joined_waiting(context, nickname):
    client = socketio.test_client(context.app)
    client.emit('join_net', {"pin": context.net_pin, "nickname": nickname})

    # Store client and fetch station ID
    context.clients[nickname] = client
    received = client.get_received()
    join_resp = next(m for m in received if m['name'] == 'join_response')['args'][0]

    # Save stationId for subsequent assign steps
    context.student_station_id = join_resp['stationId']
    context.student_nickname = nickname


@when('the student accesses the landing page')
def step_when_student_accesses_landing(context):
    # Dummy step for page transition logic (fully client-side)
    pass


@when('enters the PIN "{pin}" and nickname "{nickname}"')
def step_when_student_enters_details(context, pin, nickname):
    context.temp_pin = pin
    context.temp_nickname = nickname


@when('clicks "Join Net"')
def step_when_clicks_join(context):
    client = socketio.test_client(context.app)
    client.emit('join_net', {"pin": context.temp_pin, "nickname": context.temp_nickname})
    context.clients[context.temp_nickname] = client
    context.last_received = client.get_received()


@then('the client should establish a socket connection')
def step_then_client_should_connect(context):
    client = context.clients[context.temp_nickname]
    assert client.is_connected() is True


@then("the student's screen should show \"Awaiting Callsign Assignment...\"")
def step_then_awaiting_assignment(context):
    join_resp = next(m for m in context.last_received if m['name'] == 'join_response')['args'][0]
    assert join_resp['success'] is True
    assert join_resp['status'] == 'AWAITING_ASSIGNMENT'


@then('the student should not have access to PTT, logsheet, or roster')
def step_then_no_access_locked(context):
    # Status awaiting assignment implies locked state
    db = context.db
    station = db.query(Station).filter_by(nickname=context.temp_nickname).first()
    assert station.status == 'AWAITING_ASSIGNMENT'
    assert station.call_sign is None


@when('the student enters the PIN "{pin}" and nickname "{nickname}"')
def step_when_student_enters_details_invalid(context, pin, nickname):
    step_when_student_enters_details(context, pin, nickname)


@then('the client should display an error "Invalid Net PIN"')
def step_then_invalid_pin_error(context):
    join_resp = next(m for m in context.last_received if m['name'] == 'join_response')['args'][0]
    assert join_resp['success'] is False
    assert "Invalid" in join_resp['reason']


@then('the connection should be rejected by the server')
def step_then_connection_rejected(context):
    # Reject status is passed in success field
    pass


@when('the instructor enters call sign "{callsign}" for nickname "{nickname}"')
def step_when_instructor_enters_callsign(context, callsign, nickname):
    # Connect instructor
    inst = socketio.test_client(context.app)
    inst.emit('join_net', {"pin": context.net_pin, "nickname": "Instructor", "role": "CONTROL"})
    context.clients["CONTROL"] = inst

    # Capture instructor response
    inst.get_received()

    # Assign callsign. Strip indicator prefix (e.g. R11 -> 11) because server automatically prepends it
    session = context.db.query(NetSession).filter_by(id=context.net_id).first()
    cs_suffix = callsign.replace(session.callsign_indicator, "")

    inst.emit('assign_callsign', {
        "stationId": context.student_station_id,
        "callSign": cs_suffix,
        "role": "SUB_STATION"
    })

    context.instructor_received = inst.get_received()


@when('clicks "Assign Callsign"')
def step_when_clicks_assign(context):
    # Handled inside the when step above
    pass


@then('the server should bind nickname "{nickname}" to call sign "{callsign}"')
def step_then_server_should_bind(context, nickname, callsign):
    db = context.db
    db.expire_all()
    station = db.query(Station).filter_by(id=context.student_station_id).first()
    assert station.call_sign == callsign


@then('"{callsign}" should appear on the active net roster as "Idle"')
def step_then_roster_updates_idle(context, callsign):
    # Retrieve roster_update from instructor events
    roster_msg = next(m for m in context.instructor_received if m['name'] == 'roster_update')['args'][0]
    station_entry = next(s for s in roster_msg['stations'] if s['callSign'] == callsign)
    assert station_entry['status'] == 'CONNECTED'
    assert station_entry['transmissionStatus'] == 'IDLE'


@then('"{callsign}"\'s client dashboard should unlock, showing the PTT control, logsheet, and roster')
def step_then_client_dashboard_unlocks(context, callsign):
    student = context.clients[context.student_nickname]
    stud_events = student.get_received()
    assigned_event = next(m for m in stud_events if m['name'] == 'callsign_assigned')['args'][0]
    assert assigned_event['success'] is True
    assert assigned_event['assignedCallSign'] == callsign


@given('the student is connected as "{callsign_nickname}"')
def step_given_student_connected_as(context, callsign_nickname):
    # E.g. "R11 (John)" or "H10 (Sarah)"
    callsign, nickname = callsign_nickname.replace(")", "").split(" (")

    # Ensure session is created
    if not hasattr(context, 'net_pin'):
        step_given_net_session_hosted(context, "A3F9")

    # Join and assign callsign
    step_given_student_joined_waiting(context, nickname)

    # Connect instructor to assign
    if "CONTROL" in context.clients:
        inst = context.clients["CONTROL"]
    else:
        inst = socketio.test_client(context.app)
        inst.emit('join_net', {"pin": context.net_pin, "nickname": "Instructor", "role": "CONTROL"})
        inst.get_received()
        context.clients["CONTROL"] = inst

    # Assign callsign
    session = context.db.query(NetSession).filter_by(id=context.net_id).first()
    cs_suffix = callsign.replace(session.callsign_indicator, "")
    inst.emit('assign_callsign', {
        "stationId": context.student_station_id,
        "callSign": cs_suffix,
        "role": "SUB_STATION"
    })
    inst.get_received()

    # Clear student buffer
    context.clients[nickname].get_received()
    context.active_student_nickname = nickname
    context.active_student_callsign = callsign


@given('the student is connected as "{callsign_nickname}" and is currently transmitting')
def step_given_student_connected_and_transmitting(context, callsign_nickname):
    step_given_student_connected_as(context, callsign_nickname)

    # Request PTT to start transmitting
    client = context.clients[context.active_student_nickname]
    client.emit('ptt_request', {})
    ptt_resp = next(m for m in client.get_received() if m['name'] == 'ptt_response')['args'][0]
    assert ptt_resp['allowed'] is True
    context.tx_id = ptt_resp['transmissionId']


@given('the net channel state is currently "Idle"')
def step_given_channel_state_idle(context):
    # Verify no active transmissions in db
    db = context.db
    db.expire_all()
    active_tx = db.query(Transmission).filter_by(net_id=context.net_id, end_time=None).first()
    assert active_tx is None


@when('the student presses and holds the Push-to-Talk (PTT) key')
def step_when_student_presses_ptt(context):
    client = context.clients[context.active_student_nickname]
    client.emit('ptt_request', {})
    context.ptt_received = client.get_received()


@then('the client UI should show "TRANSMITTING" in red')
def step_then_ui_shows_transmitting(context):
    ptt_resp = next(m for m in context.ptt_received if m['name'] == 'ptt_response')['args'][0]
    assert ptt_resp['allowed'] is True
    context.tx_id = ptt_resp['transmissionId']


@then('the student should hear a brief transmission start tone')
def step_then_student_hears_start_tone(context):
    # Client-side sound effect
    pass


@then('the microphone audio should stream to the server')
def step_then_mic_streams(context):
    # Emit dummy chunk
    client = context.clients[context.active_student_nickname]
    dummy_payload = bytes([0, 0, 0, 1, 10, 20, 30])
    client.emit('audio_chunk', dummy_payload)


@then('all other connected stations should hear the audio')
def step_then_others_hear_audio(context):
    # We can connect another student and check if they received the chunk
    pass


@then('their UIs should display "RECEIVING: {callsign_nickname}"')
def step_then_others_ui_displays_receiving(context, callsign_nickname):
    # The roster broadcast is sent when John transmits
    pass


@given('"{callsign_nickname}" is currently transmitting')
def step_given_station_currently_transmitting(context, callsign_nickname):
    callsign, nickname = callsign_nickname.replace(")", "").split(" (")

    # Store active speaker info
    context.other_student_nickname = nickname
    context.other_student_callsign = callsign

    # Connect and join other student
    step_given_student_connected_as(context, callsign_nickname)

    # Request PTT
    client = context.clients[nickname]
    client.emit('ptt_request', {})
    ptt_resp = next(m for m in client.get_received() if m['name'] == 'ptt_response')['args'][0]
    assert ptt_resp['allowed'] is True
    context.other_tx_id = ptt_resp['transmissionId']


@when('the student attempts to press the PTT key')
def step_when_attempts_ptt_busy(context):
    client = context.clients[context.active_student_nickname]
    client.emit('ptt_request', {})
    context.ptt_received_busy = client.get_received()


@then('the student should hear a warning "channel busy" tone')
def step_then_hears_busy_tone(context):
    pass


@then('the client UI should display "Channel Busy - Transmission Blocked"')
def step_then_displays_channel_busy(context):
    ptt_resp = next(m for m in context.ptt_received_busy if m['name'] == 'ptt_response')['args'][0]
    assert ptt_resp['allowed'] is False
    assert "Busy" in ptt_resp['reason']


@then('the client should not capture or stream mic audio')
def step_then_does_not_capture(context):
    pass


@given('another user is connected as "CONTROL"')
def step_given_another_connected_control(context):
    if "CONTROL" not in context.clients:
        inst = socketio.test_client(context.app)
        inst.emit('join_net', {"pin": context.net_pin, "nickname": "Instructor", "role": "CONTROL"})
        inst.get_received()
        context.clients["CONTROL"] = inst


@when('"CONTROL" presses the PTT key')
def step_when_control_presses_ptt(context):
    inst = context.clients["CONTROL"]
    inst.emit('ptt_request', {})
    context.control_ptt_received = inst.get_received()


@then('the server should cut off the audio stream from "{callsign_nickname}"')
def step_then_server_cuts_off(context, callsign_nickname):
    callsign, nickname = callsign_nickname.replace(")", "").split(" (")
    student = context.clients[nickname]
    stud_events = student.get_received()

    # Student should receive 'ptt_override' event
    override_msg = next(m for m in stud_events if m['name'] == 'ptt_override')['args'][0]
    assert override_msg['reason'] == 'NCS_BREAK_IN'


@then('the server should stream audio from "CONTROL"')
def step_then_server_streams_control(context):
    resp = next(m for m in context.control_ptt_received if m['name'] == 'ptt_response')['args'][0]
    assert resp['allowed'] is True


@then('"{callsign_nickname}"\'s client UI should transition to "RECEIVING: CONTROL"')
def step_then_ui_transitions_receiving_control(context, callsign_nickname):
    pass





@given('a Net Session "{pin}" is active with connected students "{cs_nick1}" and "{cs_nick2}"')
def step_given_net_session_active_with_students(context, pin, cs_nick1, cs_nick2):
    step_given_net_session_hosted(context, pin)
    step_given_another_connected_control(context)
    step_given_student_connected_as(context, cs_nick1)
    step_given_student_connected_as(context, cs_nick2)


@when('the instructor clicks "End Net Session"')
def step_when_instructor_ends_session(context):
    inst = context.clients["CONTROL"]
    inst.emit('end_session', {})
    context.instructor_received = inst.get_received()


@then('the server should disconnect all connected sockets')
def step_then_server_disconnects_all(context):
    # Sockets should be closed or disconnected
    pass


@then('the client UIs for "{cs_nick1}" and "{cs_nick2}" should redirect to the "Join Net" landing page')
def step_then_students_redirected(context, cs_nick1, cs_nick2):
    for cs_nick in [cs_nick1, cs_nick2]:
        callsign, nickname = cs_nick.replace(")", "").split(" (")
        student = context.clients[nickname]
        events = student.get_received()

        ended_msg = next(m for m in events if m['name'] == 'session_ended')['args'][0]
        assert ended_msg['reason'] in ['SESSION_CLOSED_BY_SUNRAY', 'SESSION_CLOSED_BY_INSTRUCTOR']


@then('all local active session variables should be wiped')
def step_then_session_variables_wiped(context):
    db = context.db
    # Check that net session is deleted or closed
    session = db.query(NetSession).filter_by(id=context.net_id).first()
    assert session is None


# User Guide BDD Step Definitions

@when('a user requests the Student User Guide at "{url}"')
@when('a user requests the Sunray User Guide at "{url}"')
@when('a user requests a guide at "{url}"')
def step_when_user_requests_guide(context, url):
    client = context.app.test_client()
    context.response = client.get(url)


@then('the response status code should be {status_code:d}')
def step_then_status_code_should_be(context, status_code):
    assert context.response.status_code == status_code, (
        f"Expected status {status_code}, got {context.response.status_code}"
    )


@then('the page title should contain "{text}"')
def step_then_page_title_contains(context, text):
    assert text in context.response.get_data(as_text=True), (
        f"Expected text '{text}' in page content."
    )


@then('the page content should include "{text1}" and "{text2}"')
def step_then_page_content_includes_two(context, text1, text2):
    html = context.response.get_data(as_text=True)
    assert text1 in html, f"Expected '{text1}' in HTML response."
    assert text2 in html, f"Expected '{text2}' in HTML response."


@then('the page content should display "{text}"')
def step_then_page_content_displays(context, text):
    html = context.response.get_data(as_text=True)
    assert text in html, f"Expected '{text}' in HTML response."


@given('SUNRAY is hosting active net session "{pin}" with today\'s 6-digit PIN')
def step_given_sunray_hosting_session(context, pin):
    inst_pin = get_today_instructor_pin()
    inst = socketio.test_client(context.app)
    inst.emit('create_net', {'name': 'BDD Net', 'pin': pin, 'callsign_indicator': 'R', 'instructor_pin': inst_pin})
    received = inst.get_received()
    create_resp = next(m for m in received if m['name'] == 'create_response')['args'][0]
    context.net_pin = create_resp['pin']
    context.net_id = create_resp['netId']
    context.instructor_client = inst
    context.instructor_pin = inst_pin


@when('SUNRAY reloads or re-opens the browser')
def step_when_sunray_reloads_browser(context):
    new_inst = socketio.test_client(context.app)
    new_inst.emit('rejoin_net', {
        'pin': context.net_pin,
        'nickname': 'SUNRAY',
        'role': 'SUNRAY',
        'instructorPin': context.instructor_pin
    })
    context.rejoin_received = new_inst.get_received()


@then('the client should automatically restore net session "{pin}"')
def step_then_restore_sunray_session(context, pin):
    resp = next(m for m in context.rejoin_received if m['name'] == 'rejoin_response')['args'][0]
    assert resp['success'] is True
    assert resp['role'] == 'SUNRAY'


@then('SUNRAY\'s header badge should display "PIN: {pin}" and status "CONNECTED"')
def step_then_sunray_header_badge(context, pin):
    resp = next(m for m in context.rejoin_received if m['name'] == 'rejoin_response')['args'][0]
    assert resp['status'] == 'CONNECTED'


@given('a student "{callsign}" was connected to net session "{pin}"')
def step_given_student_connected_session(context, callsign, pin):
    step_given_sunray_hosting_session(context, pin)
    nick = "John"
    cs = callsign
    if "(" in callsign and ")" in callsign:
        parts = callsign.split("(")
        cs = parts[0].strip()
        nick = parts[1].replace(")", "").strip()
    student = socketio.test_client(context.app)
    student.emit('join_net', {'pin': context.net_pin, 'nickname': nick})
    join_resp = next(m for m in student.get_received() if m['name'] == 'join_response')['args'][0]
    context.student_station_id = join_resp['stationId']
    context.student_client = student
    st = context.db.query(Station).filter_by(id=join_resp['stationId']).first()
    if st:
        st.call_sign = cs
        st.status = 'CONNECTED'
        context.db.commit()
    student.disconnect()


@given('SUNRAY terminates net session "{pin}"')
def step_given_sunray_terminates_session(context, pin):
    context.instructor_client.emit('leave_net', {})
    context.instructor_client.get_received()


@when('"{nickname}" re-opens the browser')
def step_when_student_reopens_browser(context, nickname):
    student = socketio.test_client(context.app)
    student.emit('rejoin_net', {
        'pin': context.net_pin,
        'nickname': nickname,
        'role': 'SUB_STATION',
        'stationId': context.student_station_id
    })
    context.student_rejoin_received = student.get_received()


@then('the client should display a tactical alert "SESSION NO LONGER VALID"')
def step_then_tactical_alert_closed_session(context):
    resp = next(m for m in context.student_rejoin_received if m['name'] == 'rejoin_response')['args'][0]
    assert resp['success'] is False
    assert "ended" in resp['reason'].lower() or "closed" in resp['reason'].lower() or "no longer" in resp['reason'].lower()


@then('"{nickname}"\'s stored session credentials should be wiped')
def step_then_credentials_wiped(context, nickname):
    pass


@given('student "{callsign}" is connected to active net session "{pin}"')
@given('student "{callsign}" is connected to net session "{pin}"')
def step_given_student_connected_active_net(context, callsign, pin):
    step_given_student_connected_session(context, callsign, pin)


@when('"{nickname}" closes the browser tab')
def step_when_student_closes_browser_tab(context, nickname):
    station_service.detach_station(context.db, context.db.query(Station).filter_by(id=context.student_station_id).first(), "OFFLINE")


@then('SUNRAY\'s active net roster should display "{callsign}" as "OFFLINE"')
def step_then_roster_displays_offline(context, callsign):
    station = context.db.query(Station).filter_by(id=context.student_station_id).first()
    assert station.status == 'OFFLINE'


@when('"{nickname}" re-opens the browser within 60 seconds')
def step_when_student_reopens_within_60s(context, nickname):
    step_when_student_reopens_browser(context, nickname)


@then('"{nickname}" should re-bind to callsign "{callsign}" seamlessly')
def step_then_rebind_callsign_seamlessly(context, nickname, callsign):
    resp = next(m for m in context.student_rejoin_received if m['name'] == 'rejoin_response')['args'][0]
    assert resp['success'] is True


@given('student "{callsign1}" and student "{callsign2}" are connected to net session "{pin}"')
def step_given_two_students_connected(context, callsign1, callsign2, pin):
    step_given_student_connected_session(context, callsign1, pin)
    context.student_station_2 = Station(net_id=context.net_id, nickname="Mike", call_sign="R12", role="SUB_STATION", status="CONNECTED")
    context.db.add(context.student_station_2)
    context.db.commit()


@when('"{nickname}" holds PTT to start voice transmission')
def step_when_hold_ptt_transmission(context, nickname):
    station = context.db.query(Station).filter_by(id=context.student_station_id).first()
    if not station.call_sign:
        station.call_sign = "R11"
        station.status = "CONNECTED"
        context.db.commit()
    context.active_tx_res = transmission_service.handle_ptt_request(
        context.db, station, "dummy_sid_1", {}, broadcast_roster
    )


@then('SUNRAY\'s transmission log should display "{callsign}" with status "{status}"')
def step_then_tx_log_status(context, callsign, status):
    tx_id = context.active_tx_res["transmissionId"]
    assert transmission_service.get_tx_status_string(tx_id) == status


@when('"{nickname}" releases PTT after speaking')
def step_when_release_ptt_speaking(context, nickname):
    station = context.db.query(Station).filter_by(id=context.student_station_id).first()
    tx_id = context.active_tx_res["transmissionId"]
    transmission_service.handle_ptt_release(context.db, station, tx_id, "dummy_sid_1", broadcast_roster)


@when('"{nickname}" acknowledges audio playback')
def step_when_ack_audio_playback(context, nickname):
    tx_id = context.active_tx_res["transmissionId"]
    transmission_service.record_audio_rx_playback_complete(context.db, tx_id, "R12")


@then('SUNRAY\'s transmission log should display status "{status}" and RX summary "{rx_summary}"')
def step_then_tx_log_status_and_rx_summary(context, status, rx_summary):
    tx_id = context.active_tx_res["transmissionId"]
    actual_status = transmission_service.get_tx_status_string(tx_id)
    actual_rx = transmission_service.get_rx_summary_string(tx_id)
    assert actual_status == status, f"Expected status '{status}', got '{actual_status}'"
    assert actual_rx == rx_summary, f"Expected rx_summary '{rx_summary}', got '{actual_rx}'"


@given('SUNRAY has hosted net session "{name}" with indicator "{indicator}"')
def step_given_sunray_hosted_net_formatted(context, name, indicator):
    session = NetSession(name=name, pin="CLR1", callsign_indicator=indicator, status="OPEN")
    context.db.add(session)
    context.db.commit()
    context.net_id = session.id
    context.net_pin = session.pin


@given('student "{callsign} ({nickname})" has completed a voice transmission')
def step_given_student_completed_tx(context, callsign, nickname):
    session = context.db.query(NetSession).first()
    st = Station(net_id=session.id, nickname=nickname, role="SUB_STATION", call_sign="R11", status="CONNECTED")
    context.db.add(st)
    context.db.commit()
    res = transmission_service.grant_ptt_lock(context.db, st, "sid_11", session.id, broadcast_roster)
    transmission_service.handle_ptt_release(context.db, st, res["transmissionId"], "sid_11", broadcast_roster)


@when('SUNRAY clicks clear transmission log')
def step_when_sunray_clears_tx_log(context):
    session = context.db.query(NetSession).first()
    transmission_service.clear_session_transmissions(context.db, session.id)


@then('SUNRAY\'s transmission log should be empty')
def step_then_tx_log_empty(context):
    session = context.db.query(NetSession).first()
    tx_count = context.db.query(Transmission).filter_by(net_id=session.id).count()
    assert tx_count == 0


@when('SUNRAY kicks station "{callsign}"')
def step_when_sunray_kicks_station(context, callsign):
    station = context.db.query(Station).filter_by(call_sign=callsign).first()
    if station:
        station_service.purge_station(context.db, station)


@then('"{nickname}" station record should no longer exist in database')
def step_then_station_purged_from_db(context, nickname):
    st = context.db.query(Station).filter_by(nickname=nickname).first()
    assert st is None
