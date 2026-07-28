# API & Protocol Specification: VirtualNet

VirtualNet uses **Flask-SocketIO** (WebSocket) to manage real-time communication events between the web client and the server. Communication is structured using custom SocketIO event names passing JSON payloads validated by backend Pydantic models.

---

## 1. Connection & Registration

### Event: `join_net` (Client -> Server)
Sent by a client attempting to join the active net session using a PIN.

**Payload**:
```json
{
  "pin": "A3F9",
  "nickname": "John"
}
```

### Event: `join_response` (Server -> Client)
Sent back to the requesting client to acknowledge or reject the join request.

**Success (Placed in queue)**:
```json
{
  "success": true,
  "stationId": "d3b07384-d113-4ec2-a5d6-8e50b73c4d72",
  "status": "AWAITING_ASSIGNMENT"
}
```

**Failure**:
```json
{
  "success": false,
  "reason": "Invalid PIN 'B7Y2'."
}
```

---

## 2. Callsign & Link Quality Control (Instructor Control)

### Event: `assign_callsign` (Instructor -> Server)
Sent by the instructor to bind a call sign to a waiting nickname.

**Payload**:
```json
{
  "stationId": "d3b07384-d113-4ec2-a5d6-8e50b73c4d72",
  "callSign": "R11",
  "role": "SUB_STATION"
}
```

### Event: `callsign_assigned` (Server -> Client)
Pushed by the server to the specific student client once the instructor assigns their callsign, unlocking their interface.

**Payload**:
```json
{
  "success": true,
  "assignedCallSign": "R11",
  "role": "SUB_STATION",
  "netSession": {
    "netId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "netName": "Exercise Alpha",
    "netState": "DIRECTED"
  }
}
```

### Event: `set_signal_quality` (Instructor -> Server)
Sent by the instructor to dynamically adjust the audio link quality for a specific station.

**Payload**:
```json
{
  "stationId": "d3b07384-d113-4ec2-a5d6-8e50b73c4d72",
  "signalQuality": "DIFFICULT"
}
```

---

## 3. Roster Management

### Event: `roster_update` (Server -> Client Broadcast)
Sent by the server to all connected clients when the net roster changes. Only clients with active call signs are visible to student stations. Instructors see all waiting stations.

**Payload**:
```json
{
  "stations": [
    {
      "stationId": "00000000-0000-0000-0000-000000000000",
      "callSign": "CONTROL",
      "nickname": "Instructor Bill",
      "role": "CONTROL",
      "status": "IDLE",
      "signalQuality": "OK"
    },
    {
      "stationId": "d3b07384-d113-4ec2-a5d6-8e50b73c4d72",
      "callSign": "R11",
      "nickname": "John",
      "role": "SUB_STATION",
      "status": "TRANSMITTING",
      "signalQuality": "DIFFICULT"
    }
  ]
}
```

---

## 4. Push-to-Talk (PTT) Control

### Event: `ptt_request` (Client -> Server)
Sent by a client trying to acquire the frequency to speak.

**Payload**:
```json
{
  "stationId": "d3b07384-d113-4ec2-a5d6-8e50b73c4d72"
}
```

### Event: `ptt_response` (Server -> Client)
Sent back to the requesting client indicating if the channel lock was successfully acquired.

**Success (Granted)**:
```json
{
  "allowed": true,
  "transmissionId": "77a8dfbb-6a7f-44e2-9b2f-3dcd8e1e7fca"
}
```

**Failure (Denied)**:
```json
{
  "allowed": false,
  "reason": "Channel Busy - R11 (John) is currently transmitting."
}
```

### Event: `ptt_release` (Client -> Server)
Sent by the client currently transmitting when the user releases PTT.

**Payload**:
```json
{
  "stationId": "d3b07384-d113-4ec2-a5d6-8e50b73c4d72",
  "transmissionId": "77a8dfbb-6a7f-44e2-9b2f-3dcd8e1e7fca"
}
```

### Event: `ptt_override` (Server -> Client)
Sent by the server to a transmitting standard station when Net Control starts transmitting.

**Payload**:
```json
{
  "reason": "NCS_BREAK_IN"
}
```

---

## 5. Voice Streaming

### Event: `audio_chunk` (Client <-> Server)
Contains a binary audio fragment.

- **Payload**: Binary WebSocket frame containing `[4 bytes: Transmission ID]` + `[Remaining bytes: Raw PCM/compressed audio data]`.
- **Flow**: Transmitting client emits `audio_chunk` -> Server broadcasts `audio_chunk` -> Receiving clients play buffer. If a client's `signalQuality` is `DIFFICULT`, the receiving clients or the server will apply static degradation to this stream.

---

## 6. Log Synchronization

### Event: `sync_log_entry` (Client -> Server)
Sent by clients in real time to save log entries to the backend database.

**Payload**:
```json
{
  "netId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "ownerCallSign": "R11",
  "entry": {
    "entryId": "b47c87de-b1e1-4c74-8848-034870f074d2",
    "dtg": "280915Z JUL 26",
    "fromCallSign": "CONTROL",
    "toCallSign": "R11",
    "precedence": "ROUTINE",
    "eventText": "SITREP DE R11 INSTRUCTED TO RPT",
    "operatorInitials": "JD"
  }
}
```

---

## 7. Session Termination

### Event: `end_session` (Instructor -> Server)
Sent by the instructor client to close down the net.

**Payload**:
```json
{
  "netId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
}
```

### Event: `session_ended` (Server -> Client Broadcast)
Sent by the server to all connected clients in the session. Triggering this event directs clients to close sockets, clear local session stores, and redirect to the landing page.

**Payload**:
```json
{
  "reason": "SESSION_CLOSED_BY_INSTRUCTOR"
}
```
