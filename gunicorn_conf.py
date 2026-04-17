# Gunicorn設定ファイル

from pathlib import Path

def on_starting(server):
    lock_dir = Path("shift.lock")
    try:
        lock_dir.rmdir()
    except OSError:
        pass

# ログレベル
loglevel = "info"
capture_output = True

# アクセスログのフォーマット
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'

# アクセスログの出力先
accesslog = "./@access.log"

# エラーログの出力先
errorlog = "./@error.log"
