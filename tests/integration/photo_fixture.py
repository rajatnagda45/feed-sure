"""Synthetic deterministic image bytes shared by photo HTTP tests and the live smoke."""

import hashlib
import struct
import zlib


def png(width: int = 64, height: int = 64) -> bytes:
    """Create RGB noise; this fixture is not a real waste photograph."""

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload))
        )

    pixels = b"".join(hashlib.sha256(str(i).encode()).digest() for i in range(width * height))
    rows = b"".join(b"\0" + pixels[y * width * 3 : (y + 1) * width * 3] for y in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )
