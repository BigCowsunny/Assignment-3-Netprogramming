"""
Backend launcher script for SNMP Network Monitor
Starts FastAPI server on http://0.0.0.0:8000 and SNMP Trap Receiver on UDP 0.0.0.0:162
"""

import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import uvicorn

if __name__ == "__main__":
    print("=" * 60)
    print("  SNMP Network Monitor - Backend Server & Trap Receiver")
    print("  REST API & WebSocket : http://localhost:8000")
    print("  SNMP Trap Listener    : UDP 0.0.0.0:162 (or 1162)")
    print("=" * 60)
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)
