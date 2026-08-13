import logging
import ipaddress
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote
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
access_logger.propagate = False

ADMIN_NETWORKS = [
    ipaddress.ip_network("120.50.246.183", strict=False),
    ipaddress.ip_network("172.20.10.3", strict=False),
    ipaddress.ip_network("192.168.0.157", strict=False),
    ipaddress.ip_network("127.0.0.1", strict=False),
    ipaddress.ip_network("240a:61:4162:a147::/64", strict=False)
]

BLOCKED_NETWORKS = [
    ipaddress.ip_network("104.199.178.69", strict=False),
    ipaddress.ip_network("195.178.110.199", strict=False),
    ipaddress.ip_network("34.28.216.15", strict=False)
]

BLOCKED_KEYWORDS = (
    "wp-includes",
    "xmlrpc.php",
    "wp-admin",
    "wp-login",
    "wlwmanifest.xml"
)

def write_log(message: str):
    access_logger.info(message)

def is_ip_in_networks(ip_str: str, networks: list) -> bool:
    if not ip_str or ip_str == "Unknown":
        return False
    real_ip = ip_str.split(",")[0].strip()
    try:
        ip_obj = ipaddress.ip_address(real_ip)
        return any(ip_obj in net for net in networks)
    except ValueError:
        return False

async def requests_control(request: Request, call_next):
    client_ip = request.headers.get("cf-connecting-ip")
    if not client_ip and request.client:
        client_ip = request.client.host
    elif not client_ip:
        client_ip = "Unknown"

    path = request.url.path
    query = unquote(request.url.query)
    full_path = f"{path}?{query}" if query else path
    
    method = request.method
    user_agent = request.headers.get("user-agent", "-")

    if is_ip_in_networks(client_ip, BLOCKED_NETWORKS):
        return Response(status_code=403)
    elif any(keyword in path for keyword in BLOCKED_KEYWORDS):
        return Response(status_code=404)

    response = await call_next(request)
    status = response.status_code

    if not is_ip_in_networks(client_ip, ADMIN_NETWORKS):
        now = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
        log_message = f'[{now}] {client_ip} "{method} {full_path}" {status} "{user_agent}"'
        await anyio.to_thread.run_sync(write_log, log_message)

    return response

# ------------------------------------

target_paths = {"/item", "/user"}

async def lowercase_specific_path(request: Request, call_next):
    path_lower = request.scope["path"].lower()
    
    if path_lower in target_paths:
        request.scope["path"] = path_lower
        
    response = await call_next(request)
    return response