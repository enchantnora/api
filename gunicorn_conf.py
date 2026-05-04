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

# タイムアウト時間（秒）を追加。大容量アップロード用に1時間に設定。
timeout = 3600

# Gunicorn側のアクセスログは無効化
# access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'
# accesslog = "./@access.log"

# エラーログの出力先
errorlog = "./@error.log"