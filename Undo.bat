@echo off
cd /d P:\API
set /p yn_check="Which do you like (y/n)"
IF /I "%yn_check%"=="Y" (
    git reset --hard HEAD
    
    git push -f api main
    git push -f origin main
) ELSE (
    echo you selected " n "
)