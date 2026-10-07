@echo off
REM ติดตั้ง pandoc จาก https://pandoc.org/installing.html
REM แล้วรันไฟล์นี้

pandoc Presentation_SNMP_Monitor.md -o presentation.pptx --slide-level=2

echo.
echo สร้าง presentation.pptx เรียบร้อย!
pause
