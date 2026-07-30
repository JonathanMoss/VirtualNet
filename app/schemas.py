"""Pydantic schemas and validation models for VirtualNet."""
import re
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator, ConfigDict

# Regular expression for DTG validation (e.g. 281015Z JUL 26 or 302120A JUL 26)
DTG_REGEX = re.compile(
    r"^(0[1-9]|[12][0-9]|3[01])(0[0-9]|1[0-9]|2[0-3])[0-5][0-9][A-Z] "
    r"(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) \d{2}$"
)


# Regular expression for 4-char PIN
PIN_REGEX = re.compile(r"^[A-Z0-9]{4}$")


class NetSessionCreate(BaseModel):
    """Validation schema for hosting a new net session."""
    # pylint: disable=too-few-public-methods
    name: str = Field(..., min_length=1, max_length=50)
    callsign_indicator: str = Field(default="R", min_length=1, max_length=1)
    instructor_pin: str = Field(..., min_length=6, max_length=6)

    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate net session name."""
        if not re.match(r"^[a-zA-Z0-9\s\-]+$", v):
            raise ValueError("Net name must be alphanumeric and spaces/hyphens only")
        return v

    @field_validator('callsign_indicator')
    @classmethod
    def validate_ci(cls, v: str) -> str:
        """Validate callsign indicator prefix."""
        v_upper = v.upper()
        if not v_upper.isalpha() or v_upper == 'Z':
            raise ValueError("Callsign indicator must be a single letter from A-Y")
        return v_upper

    @field_validator('instructor_pin')
    @classmethod
    def validate_pin(cls, v: str) -> str:
        """Validate 6-digit numeric instructor PIN format."""
        if not re.match(r"^\d{6}$", v):
            raise ValueError("Instructor PIN must be exactly 6 numeric digits")
        return v



class NetSessionSchema(BaseModel):
    """Response schema for a NetSession instance."""
    # pylint: disable=too-few-public-methods
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    pin: str
    port: int
    status: str
    net_state: str
    callsign_indicator: str
    start_time: datetime


class StationCreate(BaseModel):
    """Validation schema for a joining station."""
    # pylint: disable=too-few-public-methods
    nickname: str = Field(..., min_length=1, max_length=20)
    pin: str = Field(..., min_length=4, max_length=4)

    @field_validator('nickname')
    @classmethod
    def validate_nickname(cls, v: str) -> str:
        """Validate station nickname."""
        if not re.match(r"^[a-zA-Z0-9\s\-]+$", v):
            raise ValueError("Nickname must be alphanumeric and spaces/hyphens only")
        return v

    @field_validator('pin')
    @classmethod
    def validate_pin(cls, v: str) -> str:
        """Validate station PIN format."""
        v_upper = v.upper()
        if not PIN_REGEX.match(v_upper):
            raise ValueError("PIN must be exactly 4 alphanumeric characters")
        return v_upper


class StationSchema(BaseModel):
    """Response schema for a Station instance."""
    # pylint: disable=too-few-public-methods
    model_config = ConfigDict(from_attributes=True)

    id: str
    net_id: str
    nickname: str
    call_sign: Optional[str] = None
    role: str
    ip_address: Optional[str] = None
    status: str
    transmission_status: str
    signal_quality: str
    connected_at: datetime


class LogEntryCreate(BaseModel):
    """Validation schema for creating or updating a log sheet entry."""
    # pylint: disable=too-few-public-methods
    dtg: str
    from_call_sign: str = Field(..., min_length=1, max_length=15)
    to_call_sign: str = Field(..., min_length=1, max_length=15)
    precedence: str
    event_text: str = Field(..., min_length=1, max_length=255)
    operator_initials: str = Field(..., min_length=2, max_length=3)

    @field_validator('dtg')
    @classmethod
    def validate_dtg(cls, v: str) -> str:
        """Validate DTG string format."""
        v_upper = v.upper()
        if not DTG_REGEX.match(v_upper):
            raise ValueError("DTG must be in format DDHHMMZ MON YY (e.g. 281015Z JUL 26)")
        return v_upper

    @field_validator('precedence')
    @classmethod
    def validate_precedence(cls, v: str) -> str:
        """Validate message precedence category."""
        v_upper = v.upper()
        if v_upper not in ["ROUTINE", "PRIORITY", "IMMEDIATE", "FLASH"]:
            raise ValueError("Precedence must be one of ROUTINE, PRIORITY, IMMEDIATE, FLASH")
        return v_upper

    @field_validator('from_call_sign', 'to_call_sign')
    @classmethod
    def validate_callsigns(cls, v: str) -> str:
        """Validate message call sign format."""
        v_upper = v.upper()
        if not re.match(r"^[A-Z0-9\-]+$", v_upper):
            raise ValueError("Call sign must be alphanumeric/hyphens only")
        return v_upper

    @field_validator('operator_initials')
    @classmethod
    def validate_initials(cls, v: str) -> str:
        """Validate operator initials format."""
        v_upper = v.upper()
        if not v_upper.isalpha():
            raise ValueError("Operator initials must be alphabetic only")
        return v_upper


class LogEntrySchema(BaseModel):
    """Response schema for a LogEntry instance."""
    # pylint: disable=too-few-public-methods
    model_config = ConfigDict(from_attributes=True)

    id: str
    net_id: str
    owner_station_id: str
    dtg: str
    from_call_sign: str
    to_call_sign: str
    precedence: str
    event_text: str
    operator_initials: str
    created_at: datetime


class InstructorInjectSchema(BaseModel):
    """Response schema for an InstructorInject instance."""
    # pylint: disable=too-few-public-methods
    model_config = ConfigDict(from_attributes=True)

    id: str
    net_id: str
    time_offset_seconds: int
    title: str
    description: str
    target_call_sign: Optional[str] = None
    status: str
