from fastapi import Request, Response

BLOCKED_IPS = {
    "104.199.178.69"
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

    if client_ip in BLOCKED_IPS:
        return Response(status_code=403)

    path = request.url.path
    
    if any(keyword in path for keyword in BLOCKED_KEYWORDS):
        return Response(status_code=404)

    response = await call_next(request)
    return response