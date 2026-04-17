@echo off
cd /d P:\API
git add .
git commit -m "%date% %time%"
git push api main
pause