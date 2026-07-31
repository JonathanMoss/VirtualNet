"""Service module for log sheet entry synchronization and immutability validation."""
from pydantic import ValidationError
from app.models import LogEntry, Station
from app.schemas import LogEntryCreate


def sync_log_entry(db, station: Station, net_id: str, entry_id: str, entry_payload: dict):
    """Synchronize or update a log entry row, enforcing finality/immutability constraints."""
    if not station or station.status == "AWAITING_ASSIGNMENT":
        return {"success": False, "reason": "Unauthorized log sync"}

    try:
        validated = LogEntryCreate(**entry_payload)
    except ValidationError as e:
        return {"success": False, "reason": str(e)}

    existing = db.query(LogEntry).filter_by(id=entry_id).first()

    if existing:
        if existing.operator_initials and len(existing.operator_initials) >= 2:
            return {
                "success": False,
                "reason": "Log sheet entry is locked/finalized and cannot be modified."
            }

        existing.dtg = validated.dtg
        existing.from_call_sign = validated.from_call_sign
        existing.to_call_sign = validated.to_call_sign
        existing.precedence = validated.precedence
        existing.event_text = validated.event_text
        existing.operator_initials = validated.operator_initials
    else:
        new_entry = LogEntry(
            id=entry_id,
            net_id=net_id,
            owner_station_id=station.id,
            dtg=validated.dtg,
            from_call_sign=validated.from_call_sign,
            to_call_sign=validated.to_call_sign,
            precedence=validated.precedence,
            event_text=validated.event_text,
            operator_initials=validated.operator_initials
        )
        db.add(new_entry)

    db.commit()
    return {"success": True, "entryId": entry_id}
