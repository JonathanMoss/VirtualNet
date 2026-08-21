# System Events: VirtualNet

This document outlines the Domain/Pub-Sub events published by the VirtualNet server. These events are used for audit trails, real-time telemetry, live instructor dashboards, and post-exercise reviews.

---

## 1. Connection Events

### `StationConnectedEvent`
Triggered when a station successfully joins the net.
- **Payload**:
  - `timestamp`: DateTime
  - `stationId`: UUID
  - `callSign`: String
  - `role`: Enum (`CONTROL`, `SUB_STATION`, `INSTRUCTOR`)
  - `ipAddress`: String

### `StationDisconnectedEvent`
Triggered when a station leaves or is disconnected.
- **Payload**:
  - `timestamp`: DateTime
  - `stationId`: UUID
  - `callSign`: String
  - `reason`: Enum (`GRACEFUL_EXIT`, `TIMEOUT`, `KICKED_BY_ADMIN`)

---

## 2. Transmission & Audio Events

### `TransmissionStartedEvent`
Triggered when a station initiates PTT and acquires the channel lock.
- **Payload**:
  - `timestamp`: DateTime
  - `transmissionId`: UUID
  - `senderCallSign`: String

### `AudioChunkEvent` (`audio_chunk`)
Streaming binary WebSocket event routed via Zero-DB fast path (< 15ms broadcast latency target).
- **Binary Header & Payload**:
  - Bytes 0-3: `transmissionId` (32-bit uint)
  - Bytes 4+: Raw Audio Frame / Timestamped Payload
- **Routing**: Zero-Database $O(1)$ memory lookup via active `transmitting_sids` table.

### `TransmissionEndedEvent`
Triggered when a station releases PTT and the channel returns to idle.
- **Payload**:
  - `timestamp`: DateTime
  - `transmissionId`: UUID
  - `senderCallSign`: String
  - `durationMs`: Integer
  - `audioFileUri`: String (Optional path to recording)

### `TransmissionOverriddenEvent`
Triggered when Net Control cuts off an active sender.
- **Payload**:
  - `timestamp`: DateTime
  - `interruptedTransmissionId`: UUID
  - `interruptedCallSign`: String
  - `overrideCallSign`: String (Always `CONTROL`/`0`)

### `AudioRxPlaybackCompleteEvent` (`audio_rx_playback_complete`)
Triggered when a receiver client station finishes playback of audio chunks for a transmission ID.
- **Payload**:
  - `transmissionId`: String (UUID)
  - `stationId`: String (UUID)
  - `callSign`: String

### `SunrayTxLogUpdateEvent` (`sunray_tx_log_update`)
Emitted by server to SUNRAY stations with updated transmission status, duration, and receipt summary.
- **Payload**:
  - `transmissionId`: String (UUID)
  - `callSign`: String
  - `dtg`: String
  - `duration`: String (e.g. `4.2s`)
  - `status`: String (`TRANSMITTING`, `PTT RELEASED`, `COMPLETED`, `OVERRIDDEN`)
  - `rxSummary`: String (`ALL CALLSIGNS R/X` or `NOT R/X: R12, R15`)

---

---

## 3. Net Admin & Scenario Events

### `NetStateChangedEvent`
Triggered when the global net state is updated.
- **Payload**:
  - `timestamp`: DateTime
  - `triggeredByCallSign`: String
  - `previousState`: Enum (`FREE`, `DIRECTED`, `SUSPENDED`)
  - `newState`: Enum (`FREE`, `DIRECTED`, `SUSPENDED`)

### `InjectDispatchedEvent`
Triggered when an instructor scenario inject is dispatched to students.
- **Payload**:
  - `timestamp`: DateTime
  - `injectId`: UUID
  - `title`: String
  - `description`: String
  - `targetCallSign`: String (Empty if broadcast to all)
