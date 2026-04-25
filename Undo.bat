@echo off
cd /d P:\API
git reset --hard HEAD~1

git push -f api main
git push -f origin main