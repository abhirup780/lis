"""Minimal HL7 v2 support for analyzer interfaces: parse ORU^R01 results and build ACKs."""

from dataclasses import dataclass, field

from app.db import utcnow


@dataclass
class HL7Observation:
    accession: str
    test_code: str
    value: str
    units: str | None = None


@dataclass
class HL7Message:
    control_id: str
    sending_application: str
    message_type: str
    observations: list[HL7Observation] = field(default_factory=list)


class HL7Error(ValueError):
    pass


def _component(field_value: str, index: int = 0) -> str:
    parts = field_value.split("^")
    return parts[index] if index < len(parts) else ""


def parse_oru(raw: str) -> HL7Message:
    segments = [s for s in raw.replace("\r\n", "\r").replace("\n", "\r").split("\r") if s.strip()]
    if not segments or not segments[0].startswith("MSH"):
        raise HL7Error("Message must start with an MSH segment")

    msh = segments[0]
    sep = msh[3]
    # MSH-1 is the separator itself, so MSH fields are offset by one when split.
    msh_fields = msh.split(sep)
    message_type = msh_fields[8] if len(msh_fields) > 8 else ""
    if not message_type.startswith("ORU"):
        raise HL7Error(f"Unsupported message type '{message_type}', expected ORU^R01")
    message = HL7Message(
        control_id=msh_fields[9] if len(msh_fields) > 9 else "",
        sending_application=_component(msh_fields[2]) if len(msh_fields) > 2 else "",
        message_type=message_type,
    )

    accession = ""
    for segment in segments[1:]:
        fields = segment.split(sep)
        kind = fields[0]
        if kind == "OBR":
            # OBR-3 filler order number carries the specimen accession; fall back to OBR-2.
            accession = _component(fields[3]) if len(fields) > 3 and fields[3] else _component(fields[2])
        elif kind == "SPM" and len(fields) > 2 and fields[2]:
            accession = _component(fields[2])
        elif kind == "OBX":
            if not accession:
                raise HL7Error("OBX segment appears before any OBR/SPM with an accession number")
            if len(fields) < 6:
                raise HL7Error("OBX segment is missing fields")
            message.observations.append(
                HL7Observation(
                    accession=accession,
                    test_code=_component(fields[3]),
                    value=_component(fields[5]),
                    units=_component(fields[6]) if len(fields) > 6 else None,
                )
            )
    return message


def build_ack(message: HL7Message | None, code: str, text: str = "") -> str:
    """Build an ACK. code is AA (accept), AE (error) or AR (reject)."""
    timestamp = utcnow().strftime("%Y%m%d%H%M%S")
    receiver = message.sending_application if message else ""
    control_id = message.control_id if message else ""
    return "\r".join(
        [
            f"MSH|^~\\&|LIS|LAB|{receiver}||{timestamp}||ACK^R01|ACK{control_id}|P|2.5.1",
            f"MSA|{code}|{control_id}|{text}",
        ]
    )
