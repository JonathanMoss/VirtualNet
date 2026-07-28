import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class NetSession(Base):
    __tablename__ = 'net_sessions'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(50), nullable=False)
    pin = Column(String(4), unique=True, nullable=False, index=True)
    port = Column(Integer, default=5000, nullable=False)
    status = Column(String(15), default="OPEN", nullable=False)  # OPEN, SUSPENDED, CLOSED
    net_state = Column(String(15), default="DIRECTED", nullable=False)  # FREE, DIRECTED
    callsign_indicator = Column(String(1), default="R", nullable=False)  # Daily prefix letter
    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)

    stations = relationship("Station", back_populates="net_session", cascade="all, delete-orphan")
    transmissions = relationship("Transmission", back_populates="net_session", cascade="all, delete-orphan")
    log_entries = relationship("LogEntry", back_populates="net_session", cascade="all, delete-orphan")
    injects = relationship("InstructorInject", back_populates="net_session", cascade="all, delete-orphan")


class Station(Base):
    __tablename__ = 'stations'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    net_id = Column(String(36), ForeignKey('net_sessions.id'), nullable=False)
    nickname = Column(String(20), nullable=False)
    call_sign = Column(String(15), nullable=True, index=True)
    role = Column(String(15), default="SUB_STATION", nullable=False)  # CONTROL, SUB_STATION, INSTRUCTOR
    ip_address = Column(String(45), nullable=True)
    status = Column(String(20), default="AWAITING_ASSIGNMENT", nullable=False)  # AWAITING_ASSIGNMENT, CONNECTED, MUTED, DISCONNECTED
    transmission_status = Column(String(20), default="IDLE", nullable=False)  # IDLE, TRANSMITTING, BLOCKED
    signal_quality = Column(String(15), default="OK", nullable=False)  # OK, DIFFICULT, UNWORKABLE
    connected_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    net_session = relationship("NetSession", back_populates="stations")
    log_entries = relationship("LogEntry", back_populates="station", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('net_id', 'call_sign', name='_net_callsign_uc'),
    )


class Transmission(Base):
    __tablename__ = 'transmissions'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    net_id = Column(String(36), ForeignKey('net_sessions.id'), nullable=False)
    sender_call_sign = Column(String(15), nullable=False)
    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    audio_file_path = Column(String(255), nullable=True)
    termination_reason = Column(String(30), nullable=True)  # PTT_RELEASED, OVERRIDDEN, TIMEOUT, DISCONNECTED

    net_session = relationship("NetSession", back_populates="transmissions")


class LogEntry(Base):
    __tablename__ = 'log_entries'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    net_id = Column(String(36), ForeignKey('net_sessions.id'), nullable=False)
    owner_station_id = Column(String(36), ForeignKey('stations.id'), nullable=False)
    dtg = Column(String(20), nullable=False)  # DDHHMMZ MON YY format
    from_call_sign = Column(String(15), nullable=False)
    to_call_sign = Column(String(15), nullable=False)
    precedence = Column(String(10), default="ROUTINE", nullable=False)  # ROUTINE, PRIORITY, IMMEDIATE, FLASH
    event_text = Column(String(255), nullable=False)
    operator_initials = Column(String(3), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    net_session = relationship("NetSession", back_populates="log_entries")
    station = relationship("Station", back_populates="log_entries")


class InstructorInject(Base):
    __tablename__ = 'instructor_injects'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    net_id = Column(String(36), ForeignKey('net_sessions.id'), nullable=False)
    time_offset_seconds = Column(Integer, nullable=False)
    title = Column(String(100), nullable=False)
    description = Column(Text, nullable=False)
    target_call_sign = Column(String(15), nullable=True)
    status = Column(String(15), default="PENDING", nullable=False)  # PENDING, DISPATCHED, COMPLETED

    net_session = relationship("NetSession", back_populates="injects")
