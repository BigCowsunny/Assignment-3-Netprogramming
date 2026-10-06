"""Classify common network platforms before ambiguous CDP capability flags."""
import re


def classify_device(description: str, capabilities: int = 0) -> str:
    value = description.lower()
    switch_markers = ("switch", "catalyst", "nexus", "iol l2", "vios_l2", "iosvl2",
                      "c2960", "c3560", "c3750", "c3850", "c1000", "cat9k", "cat3k", "cat4k")
    if any(marker in value for marker in switch_markers):
        return "switch"
    # Cisco routers can also set the switch capability bit (e.g. 2901 = 0x29).
    if any(marker in value for marker in ("router", "isr", "asr", "csr1000")) or re.search(r"(?:cisco|c)(?:18|19|28|29|39)\d{2}", value):
        return "router"
    return "switch" if capabilities & 8 else "router"
