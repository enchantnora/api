import logging
from datetime import datetime
from fastapi import Request, Response

# --- カスタムアクセスロガーのセットアップ ---
log_format = logging.Formatter('%(message)s')
file_handler = logging.FileHandler("./@access.log", encoding="utf-8")
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

async def block_malicious_requests(request: Request, call_next):
    client_ip = request.headers.get("cf-connecting-ip")
    if not client_ip and request.client:
        client_ip = request.client.host
    elif not client_ip:
        client_ip = "Unknown"

    path = request.url.path
    method = request.method
    user_agent = request.headers.get("user-agent", "-")

    if client_ip in BLOCKED_IPS:
        response = Response(status_code=403)
        status = 403
    elif any(keyword in path for keyword in BLOCKED_KEYWORDS):
        response = Response(status_code=404)
        status = 404
    else:
        # 正常なリクエストの実行
        response = await call_next(request)
        status = response.status_code

    # --- アクセスログの出力  ---
    if client_ip not in ADMIN_IPS:
        now = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
        log_message = f'[{now}] {client_ip} "{method} {path}" {status} "{user_agent}"'
        access_logger.info(log_message)

    return response