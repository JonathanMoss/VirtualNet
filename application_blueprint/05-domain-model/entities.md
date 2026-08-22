# Domain Model - Entities: VirtualNet

This document defines the database schemas (SQLAlchemy models) and validation schemas (Pydantic v2 models) for VirtualNet's backend, specifying field types, constraints, and validation rules.

---

## 1. NetSession

Represents an active virtual radio network frequency.

### Pydantic Schema: `NetSessionSchema`
- `net_id`: `uuid.UUID`
- `net_name`: `str` (Constraint: 1-20 characters, alphanumeric, spaces, hyphens, periods, slashes, and parentheses)
- `pin`: `str` (Constraint: 4-character uppercase alphanumeric string)
- `port`: `int` (Constraint: 1024-65535, default 5000)
- `status`: `str` (Allowed values: `"OPEN"`, `"SUSPENDED"`, `"CLOSED"`)
- `net_state`: `str` (Allowed values: `"FREE"`, `"DIRECTED"`, default `"DIRECTED"`)
- `start_time`: `datetime.datetime`

### Database Columns: `net_sessions` Table
- `id`: `String(36)`, Primary Key (UUID)
- `name`: `String(20)`, Not Null
- `pin`: `String(4)`, Unique, Not Null, Index
- `port`: `Integer`, Not Null
- `status`: `String(15)`, Not Null (default `"OPEN"`)
- `net_state`: `String(15)`, Not Null (default `"DIRECTED"`)
- `callsign_indicator`: `String(1)`, Not Null (default `"R"`)
- `start_time`: `DateTime`, Not Null

---

## 2. Station

Represents an active connection in a NetSession. Holds no personal information.

### Pydantic Schema: `StationSchema`
- `station_id`: `uuid.UUID`
- `nickname`: `str` (Constraint: 1-20 characters, alphanumeric/spaces)
- `call_sign`: `Optional[str]` (Constraint: alphanumeric plus hyphen, capitalized, 1-15 chars. Nullable until assigned by instructor)
- `role`: `str` (Allowed values: `"CONTROL"`, `"SUB_STATION"`, `"INSTRUCTOR"`)
- `ip_address`: `str` (IPv4 validation)
- `connection_status`: `str` (Allowed: `"AWAITING_ASSIGNMENT"`, `"CONNECTED"`, `"MUTED"`, `"DISCONNECTED"`)
- `transmission_status`: `str` (Allowed: `"IDLE"`, `"TRANSMITTING"`, `"BLOCKED"`)
- `connected_at`: `datetime.datetime`

### Database Columns: `stations` Table
- `id`: `String(36)`, Primary Key (UUID)
- `net_id`: `String(36)`, Foreign Key (`net_sessions.id`), Not Null
- `nickname`: `String(20)`, Not Null
- `call_sign`: `String(15)`, Nullable, Index (assigned post-connect)
- `role`: `String(15)`, Not Null (default `"SUB_STATION"`)
- `ip_address`: `String(45)`
- `status`: `String(20)`, Not Null (default `"AWAITING_ASSIGNMENT"`)
- `transmission_status`: `String(20)`, Not Null (default `"IDLE"`)
- `signal_quality`: `String(15)`, Not Null (default `"OK"`)
- `connected_at`: `DateTime`, Not Null
- `last_seen`: `DateTime`, Not Null

---

## 3. Transmission

Represents a voice transmission segment.

### Pydantic Schema: `TransmissionSchema`
- `transmission_id`: `uuid.UUID`
- `sender_call_sign`: `str`
- `start_time`: `datetime.datetime`
- `end_time`: `Optional[datetime.datetime]`
- `audio_file_path`: `Optional[str]`
- `termination_reason`: `Optional[str]` (Allowed: `"PTT_RELEASED"`, `"OVERRIDDEN"`, `"TIMEOUT"`, `"DISCONNECTED"`)

### Database Columns: `transmissions` Table
- `id`: `String(36)`, Primary Key (UUID)
- `net_id`: `String(36)`, Foreign Key (`net_sessions.id`), Not Null
- `sender_call_sign`: `String(15)`, Not Null
- `start_time`: `DateTime`, Not Null
- `end_time`: `DateTime`, Nullable
- `audio_file_path`: `String(255)`, Nullable
- `termination_reason`: `String(30)`, Nullable

---

## 4. Logging Reference Card

Operators maintain physical paper logsheets during net operations. The application provides an in-app Logging Reference Card (`/static/images/LOGGING/LOGGING.png`) with pan and zoom capabilities displaying standard radio logging format, precedence rules, and DTG guidelines.

---

## 5. InstructorInject

Represents scenario events loaded to drive training.

### Pydantic Schema: `InstructorInjectSchema`
- `inject_id`: `uuid.UUID`
- `time_offset_seconds`: `int` (seconds since net start, >= 0)
- `title`: `str` (1-100 chars)
- `description`: `str` (1-1000 chars)
- `target_call_sign`: `Optional[str]` (nullable)
- `status`: `str` (Allowed: `"PENDING"`, `"DISPATCHED"`, `"COMPLETED"`)

### Database Columns: `instructor_injects` Table
- `id`: `String(36)`, Primary Key (UUID)
- `net_id`: `String(36)`, Foreign Key (`net_sessions.id`), Not Null
- `time_offset_seconds`: `Integer`, Not Null
- `title`: `String(100)`, Not Null
- `description`: `Text`, Not Null
- `target_call_sign`: `String(15)`, Nullable
- `status`: `String(15)`, Not Null (default `"PENDING"`)

---

## 6. Secret Key Security Specification

- **Environment Variable**: `SECRET_KEY`
- **Production Fallback**: If `SECRET_KEY` is omitted in non-testing environments, the server automatically generates a cryptographically secure 256-bit random key at startup using Python's `secrets.token_hex(32)`.
