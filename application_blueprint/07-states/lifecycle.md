# State Transitions & Lifecycle: VirtualNet

This document outlines the states and transitions for the key lifecycles in VirtualNet: the Net Session, the Operator Station, and the Voice Transmission.

---

## 1. Net Session Lifecycle

The `NetSession` represents the global state of the simulated frequency channel managed by the server.

```
       [Created/Idle]
             │
             ▼ (Instructor hosts net, PIN generated)
    ┌─────────────────┐
    │     HOSTED      │ ◄──────────┐
    └────────┬────────┘            │
             │                     │ (Resume)
             │ (Control &          │
             │  Students join)     │
             ▼                     │
    ┌─────────────────┐            │
    │   NET_ACTIVE    │            │
    │  (Directed/Free)│            │
    └────────┬────────┘            │
             │                     │
             ├─────────────────────┼─────────┐
             │ (Suspend exercise)  │         │ (Close/End session)
             ▼                     │         ▼
    ┌─────────────────┐            │    ┌──────────┐
    │  NET_SUSPENDED  ├────────────┘    │  CLOSED  │
    └─────────────────┘                 └──────────┘
```

### State Definitions
- **HOSTED**: The session is created on the server and a 4-character PIN is assigned. It is waiting for student connections. Roster and logs are not yet active for students.
- **NET_ACTIVE (DIRECTED)**: The net is live. Sub-stations can only communicate after requesting permission from Control.
- **NET_ACTIVE (FREE)**: The net is live. Sub-stations are allowed to call each other directly.
- **NET_SUSPENDED**: The net is paused by the instructor. All audio transmission is disabled, but connection states and logs remain active and visible.
- **CLOSED**: The instructor terminates the session. All client sockets are forcibly disconnected, temporary files are wiped, and students are kicked back to the login screen.

---

## 2. Station Lifecycle

The `Station` lifecycle governs the individual client's state and UI presentation.

```
           [Disconnected]
                 │
                 ▼ (Join Request: PIN & Nickname)
           ┌──────────────┐
           │  CONNECTING  │
           └──────┬───────┘
                  │ (Valid PIN)
                  ▼
      ┌───────────────────────┐
      │  AWAITING_ASSIGNMENT  │  (UI locked, showing loading indicator)
      └──────────┬────────────┘
                  │ (Instructor assigns Callsign)
                  ▼
           ┌──────────┐
           │   IDLE   │ ◄─────────────────────────┐
           └─┬──────┬─┘                           │
             │      │                             │
    (Hold PTT│      │(Incoming                    │(Release PTT /
     Channel │      │ Transmission)               │ End of Incoming)
     Free)   │      │                             │
             ▼      ▼                             │
    ┌──────────┐  ┌──────────┐                    │
    │TRANSMIT  │  │ RECEIVE  ├────────────────────┘
    └────┬─────┘  └──────────┘
         │
         │ (CONTROL Override)
         ▼
    ┌──────────┐
    │ OVERRIDD │
    └────┬─────┘
         │ (Auto-release after 2s delay)
         ▼
       [IDLE]
```

### State Definitions & Transitions
- **CONNECTING**: Client is validating the 4-char PIN with the server.
- **AWAITING_ASSIGNMENT**: The student has successfully joined the net session using the PIN but has not yet been assigned a call sign. The client UI is locked, showing a placeholder loading screen.
- **IDLE**: The station is assigned a call sign and is active on the frequency, listening. Microphone is disabled, speaker is ready.
- **TRANSMITTING**: The user is holding PTT and successfully streaming voice audio to the server.
- **RECEIVING**: Another station is transmitting; audio is playing back on the client, and PTT activation is blocked.
- **OVERRIDDEN**: The station was cut off by CONTROL. Client plays an alert tone and disables mic capture.
- **OFFLINE**: Triggered when a student station closes their browser tab or temporarily loses socket connection. The station is kept in SUNRAY's roster as `OFFLINE` for a 60-second grace period. Re-opening the browser within 60s rebinds the station to `CONNECTED` / `IDLE`, preserving their callsign (`R11`). If expired, status transitions to `LEFT`.
- **DISCONNECTED**: Triggered if the student leaves, 60s offline grace period expires, or the instructor clicks "End Net Session" (which resets their client to the landing page).
