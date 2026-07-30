Feature: VirtualNet Core Radio Net Operations

  As a radio operator student or instructor,
  I want to interact with a simulated, half-duplex client/server radio network,
  So that I can practice military voice procedures and radio logging without physical radios.

  Scenario: A student joins a hosted Net Session using a PIN and nickname
    Given a Net Session is hosted on the server with PIN "A3F9"
    When the student accesses the landing page
    And enters the PIN "A3F9" and nickname "John"
    And clicks "Join Net"
    Then the client should establish a socket connection
    And the student's screen should show "Awaiting Callsign Assignment..."
    And the student should not have access to PTT, logsheet, or roster

  Scenario: A student tries to join with an invalid PIN
    Given a Net Session is hosted on the server with PIN "A3F9"
    When the student enters the PIN "B7Y2" and nickname "John"
    And clicks "Join Net"
    Then the client should display an error "Invalid Net PIN"
    And the connection should be rejected by the server

  Scenario: Instructor assigns a call sign to a waiting student
    Given a Net Session is hosted with PIN "A3F9"
    And a student has joined with nickname "John" and is waiting in the queue
    When the instructor enters call sign "R11" for nickname "John"
    And clicks "Assign Callsign"
    Then the server should bind nickname "John" to call sign "R11"
    And "R11" should appear on the active net roster as "Idle"
    And "R11"'s client dashboard should unlock, showing the PTT control, logsheet, and roster

  Scenario: A student initiates a voice transmission when the channel is free
    Given the student is connected as "R11 (John)"
    And the net channel state is currently "Idle"
    When the student presses and holds the Push-to-Talk (PTT) key
    Then the client UI should show "TRANSMITTING" in red
    And the student should hear a brief transmission start tone
    And the microphone audio should stream to the server
    And all other connected stations should hear the audio
    And their UIs should display "RECEIVING: R11 (John)"

  Scenario: A student attempts to transmit when the channel is busy
    Given the student is connected as "H10 (Sarah)"
    And "R11 (John)" is currently transmitting
    When the student attempts to press the PTT key
    Then the student should hear a warning "channel busy" tone
    And the client UI should display "Channel Busy - Transmission Blocked"
    And the client should not capture or stream mic audio

  Scenario: Net Control Station interrupts a transmission (Break-In)
    Given the student is connected as "R11 (John)" and is currently transmitting
    And another user is connected as "CONTROL"
    When "CONTROL" presses the PTT key
    Then the server should cut off the audio stream from "R11 (John)"
    And the server should stream audio from "CONTROL"
    And "R11 (John)"'s client UI should transition to "RECEIVING: CONTROL"



  Scenario: Instructor terminates the net session
    Given a Net Session "A3F9" is active with connected students "R11 (John)" and "H10 (Sarah)"
    When the instructor clicks "End Net Session"
    Then the server should disconnect all connected sockets
    And the client UIs for "R11 (John)" and "H10 (Sarah)" should redirect to the "Join Net" landing page
    And all local active session variables should be wiped
