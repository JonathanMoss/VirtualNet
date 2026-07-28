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

## 2. Transmission Events

### `TransmissionStartedEvent`
Triggered when a station initiates PTT and acquires the channel lock.
- **Payload**:
  - `timestamp`: DateTime
  - `transmissionId`: UUID
  - `senderCallSign`: String

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

---

## 3. Log sheet & Sync Events

### `LogEntrySyncedEvent`
Triggered when a client pushes a new or updated log entry to the server.
- **Payload**:
  - `timestamp`: DateTime
  - `stationCallSign`: String
  - `entryId`: UUID
  - `dtg`: String
  - `fromCallSign`: String
  - `toCallSign`: String
  - `precedence`: String
  - `eventText`: String
  - `operatorInitials`: String

---

## 4. Net Admin & Scenario Events

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
