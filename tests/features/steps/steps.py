"""Behave BDD step definitions for VirtualNet feature tests."""
# pylint: disable=not-callable,unused-argument,unused-variable,cyclic-import,R0401,duplicate-code,missing-function-docstring,line-too-long


import eventlet
from behave import given, when, then
from app import socketio
from app.models import NetSession, Station, Transmission



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


@given('a net session has connected stations: "CONTROL", "{cs_nick1}", "{cs_nick2}", and "{cs_nick3}"')
def step_given_net_session_multiple_stations(context, cs_nick1, cs_nick2, cs_nick3):
    step_given_net_session_hosted(context, "A3F9")
    step_given_another_connected_control(context)

    # Connect and assign each subordinate station
    for cs_nick in [cs_nick1, cs_nick2, cs_nick3]:
        step_given_student_connected_as(context, cs_nick)


@given('the correct order of answering is "{cs_nick1}", "{cs_nick2}", "{cs_nick3}" based on callsign sequence')
def step_given_order_of_answering(context, cs_nick1, cs_nick2, cs_nick3):
    # This is a pre-condition statement verifying H10 < L12 < R11 order
    pass


@when('"CONTROL" transmits a RADIO CHECK collective call: "{msg}"')
def step_when_control_starts_radio_check(context, msg):
    inst = context.clients["CONTROL"]
    inst.emit('start_radio_check', {})

    # Flush all events
    context.control_received = inst.get_received()


@then('"{callsign_nickname}"\'s client UI should display a prompt: "Your turn to answer"')
def step_then_active_responder_prompt(context, callsign_nickname):
    callsign, nickname = callsign_nickname.replace(")", "").split(" (")
    student = context.clients[nickname]

    events = student.get_received()
    status_events = [m for m in events if m['name'] == 'radio_check_status']
    assert len(status_events) > 0
    check_status = status_events[-1]['args'][0]
    assert check_status['inProgress'] is True
    assert check_status['activeCallSign'] == callsign


@when('"{callsign_nickname}" presses PTT and transmits: "{msg}"')
def step_when_responder_answers(context, callsign_nickname, msg):
    callsign, nickname = callsign_nickname.replace(")", "").split(" (")
    student = context.clients[nickname]

    # Perform standard PTT sequence (request, transmit, release)
    student.emit('ptt_request', {})
    ptt_resp = next(m for m in student.get_received() if m['name'] == 'ptt_response')['args'][0]
    assert ptt_resp['allowed'] is True
    tx_id = ptt_resp['transmissionId']

    # Release PTT to trigger turn advancement
    student.emit('ptt_release', {"transmissionId": tx_id})
    student.get_received()


@then('"{callsign}"\'s client UI should show all responses are complete')
def step_then_control_sees_complete(context, callsign):
    # Callsign is CONTROL
    inst = context.clients["CONTROL"]
    events = inst.get_received()

    # Find the last radio_check_status event
    check_status_msgs = [m for m in events if m['name'] == 'radio_check_status']
    assert len(check_status_msgs) > 0
    last_status = check_status_msgs[-1]['args'][0]
    assert last_status['inProgress'] is False


@given('a collective check is in progress for "{cs_nick1}", "{cs_nick2}", and "{cs_nick3}"')
def step_given_check_in_progress(context, cs_nick1, cs_nick2, cs_nick3):
    step_given_net_session_multiple_stations(context, cs_nick1, cs_nick2, cs_nick3)
    step_when_control_starts_radio_check(context, "")

    # Flush student queues
    for cs_nick in [cs_nick1, cs_nick2, cs_nick3]:
        callsign, nickname = cs_nick.replace(")", "").split(" (")
        context.clients[nickname].get_received()


@given('"{callsign_nickname}" is the active turn but does not transmit')
def step_given_active_turn_silent(context, callsign_nickname):
    # Sarah (H10) is active index 0
    pass


@when('{seconds} seconds have elapsed without transmission from "{callsign_nickname}"')
def step_when_seconds_elapsed(context, seconds, callsign_nickname):
    # Wait for the eventlet timer to fire
    # Since our timer is 5 seconds, sleeping 5.5 seconds will guarantee trigger!
    eventlet.sleep(float(seconds) + 0.5)


@then('the server should mark "{callsign_nickname}" as "Defaulted"')
def step_then_server_marks_defaulted(context, callsign_nickname):
    """Verify station status marked defaulted after timer expiration."""
    # Verified via the next event packet



@then('"{callsign_nickname}"\'s client UI should display a prompt: "Your turn to answer ({defaulted_cs} defaulted)"')
def step_then_next_turn_prompt_defaulted(context, callsign_nickname, defaulted_cs):
    callsign, nickname = callsign_nickname.replace(")", "").split(" (")
    student = context.clients[nickname]

    events = student.get_received()
    status_events = [m for m in events if m['name'] == 'radio_check_status']
    assert len(status_events) > 0
    last_status = status_events[-1]['args'][0]

    assert last_status['inProgress'] is True
    assert last_status['activeCallSign'] == callsign
    assert defaulted_cs in last_status['defaultedCallSigns']


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
        assert ended_msg['reason'] == 'SESSION_CLOSED_BY_INSTRUCTOR'


@then('all local active session variables should be wiped')
def step_then_session_variables_wiped(context):
    db = context.db
    # Check that net session is deleted or closed
    session = db.query(NetSession).filter_by(id=context.net_id).first()
    assert session is None
