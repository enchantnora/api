@echo off
cd /d P:\API
set /p yn_check="Which do you like (y/n)"
IF %yn_check:Y=Y%==Y (
    git reset --hard HEAD~1
    
    git push -f api main
    git push -f origin main
) ELSE (
    echo you selected " n "
)