import logging
from datetime import datetime
from pathlib import Path
from fastapi import Request, Response
import anyio

class MonthlyFileHandler(logging.FileHandler):
    def __init__(self, base_dir: str, file_prefix: str, ext: str = ".log"):
        self.base_dir = Path(base_dir)
        self.file_prefix = file_prefix
        self.ext = ext
        self.base_dir.mkdir(parents=True, exist_ok=True)
        super().__init__(str(self._get_current_filename()), encoding="utf-8")

    def _get_current_filename(self):
        current_month = datetime.now().strftime("%Y%m")
        return self.base_dir / f"{self.file_prefix}_{current_month}{self.ext}"

    def emit(self, record):
        new_filename = str(self._get_current_filename().resolve())
        if self.baseFilename != new_filename:
            self.close()
            self.baseFilename = new_filename
            self.stream = self._open()
        super().emit(record)

log_format = logging.Formatter('%(message)s')
file_handler = MonthlyFileHandler("./log", "@access")
file_handler.setFormatter(log_format)

access_logger = logging.getLogger("fastapi_access_logger")
access_logger.setLevel(logging.INFO)
access_logger.addHandler(file_handler)
access_logger.propagate = False # Uvicorn標準ログOFF

# 管理者IP(ログ無し)
ADMIN_IPS = {
    "120.50.246.183",
    "127.0.0.1"
}

BLOCKED_IPS = {
    "104.199.178.69",
    "34.28.216.15"
}

BLOCKED_KEYWORDS = (
    "wp-includes",
    "xmlrpc.php",
    "wp-admin",
    "wp-login",
    "wlwmanifest.xml"
)

def write_log(message: str):
    access_logger.info(message)

async def requests_control(request: Request, call_next):
    client_ip = request.headers.get("cf-connecting-ip")
    if not client_ip and request.client:
        client_ip = request.client.host
    elif not client_ip:
        client_ip = "Unknown"

    path = request.url.path
    method = request.method
    user_agent = request.headers.get("user-agent", "-")

    if client_ip in BLOCKED_IPS:
        return Response(status_code=403)
    elif any(keyword in path for keyword in BLOCKED_KEYWORDS):
        return Response(status_code=404)

    response = await call_next(request)
    status = response.status_code

    if client_ip not in ADMIN_IPS:
        now = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
        log_message = f'[{now}] {client_ip} "{method} {path}" {status} "{user_agent}"'
        await anyio.to_thread.run_sync(write_log, log_message)

    return response