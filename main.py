import aiosqlite
import re
import csv
import datetime
import shortuuid
import polars as pl
import io
import urllib.parse
import json
import time
import anyio
from anyio import Path as AsyncPath
from functools import lru_cache
from fastapi import FastAPI, Request, Depends, UploadFile, File, HTTPException, Header, Response
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from pathlib import Path
from contextlib import asynccontextmanager
from pydantic import BaseModel

# 分割したファイルからのインポート
from utils import (
    TABLE_CONFIGS, get_db, normalize_text, process_csv_and_schema,
    get_file_timestamp, write_csv_sync, write_and_process,
    get_val, _normalize_param, generate_mobile_html_block,
    process_data_sync, parse_wgt, zen_to_han_fast_single,
    templates, CABINET_DIR, RE_CHART_FILE, RE_CHART_DATE
)
from cabinet import router as cabinet_router, init_cabinet_db

dbfile = 'dbfile.db'

@asynccontextmanager
async def lifespan(app: FastAPI):
    # メインDBの初期化
    conn = await aiosqlite.connect(dbfile)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA synchronous=NORMAL")
    await conn.execute("PRAGMA wal_autocheckpoint=100;")
    await conn.execute("PRAGMA busy_timeout=5000;")
    await conn.commit()
    app.state.db = conn
    
    # ファイラー(cabinet)用のDB初期化
    await init_cabinet_db()
    
    yield
    
    await conn.close()

app = FastAPI(debug=False, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

# ファイラールーター
app.include_router(cabinet_router)

app.mount(path="/static", app=StaticFiles(directory='static'), name="static")

@app.exception_handler(StarletteHTTPException)
async def custom_exception_handler(request: Request, exc: StarletteHTTPException):
    return templates.TemplateResponse(request, "error.html", {"status_code": exc.status_code, "detail": exc.detail}, status_code=exc.status_code)

# ------------------------------------

icon_files = [
    "favicon.ico",
    "apple-touch-icon.png",
    "web-app-manifest-192x192.png",
    "web-app-manifest-512x512.png",
    "icon_ms.png",
    "icon_shift.png"
]

def create_icon_route(filename: str):
    async def get_icon():
        return FileResponse(f"static/image/{filename}")
    return get_icon

for file in icon_files:
    app.add_api_route(f"/{file}", create_icon_route(file), methods=["GET"])

# ------------------------------------

def generate_manifest(name: str, start_url: str, icon_path: str, bg_color: str, icon_sizes: str):
    return {
        "name": name,
        "start_url": start_url,
        "icons": [
            {
                "src": icon_path,
                "sizes": icon_sizes,
                "type": "image/png"
            }
        ],
        "display": "standalone",
        "background_color": bg_color,
        "theme_color": bg_color
    }

@app.get('/data/manifest.json')
async def data_manifest():
    manifest_data = generate_manifest("製品検索", "/data", "/web-app-manifest-512x512.png", "#162141", "512x512")
    return manifest_data

@app.get('/ms/manifest.json')
async def data_ms_manifest():
    manifest_data = generate_manifest("SHIFT", "/ms", "/icon_ms.png", "#000000", "400x400")
    return manifest_data

# ------------------------------------

@app.get("/", name="first")
async def first(request: Request):
    return templates.TemplateResponse(request, '0index.html')

@app.get('/000')
async def update_data(request: Request):
    conn = request.app.state.db
    results = []
    
    for config in TABLE_CONFIGS:
        name = config['name']
        csvf = config['file']
        
        create_sql, cols, rows = await run_in_threadpool(process_csv_and_schema, csvf, name)
        
        if create_sql is None:
            results.append({'table': name, 'status': 'file_not_found'})
            continue
            
        await conn.execute(f"DROP TABLE IF EXISTS {name}")
        await conn.execute(create_sql)
        
        if rows:
            placeholders = ",".join(["?"] * len(cols))
            sql_insert = f"INSERT INTO {name} ({','.join(cols)}) VALUES ({placeholders})"
            await conn.executemany(sql_insert, rows)
            
        if name == 'product' and 'keyword' in cols:
            await conn.execute("DROP TABLE IF EXISTS product_fts")
            try:
                await conn.execute("CREATE VIRTUAL TABLE product_fts USING fts5(keyword, content='product', content_rowid='rowid', tokenize='trigram')")
                await conn.execute("INSERT INTO product_fts(product_fts) VALUES('rebuild')")
            except aiosqlite.Error:
                pass
                
        results.append({'table': name, 'processed_rows': len(rows)})
        
    await conn.commit()
    return {'status': 'success', 'tables': results}

@app.get('/data', name="index")
async def index(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    now_date = datetime.datetime.now().isoformat()
    user_uuid = request.cookies.get("user_uuid")
    if not user_uuid:
        user_uuid = shortuuid.uuid()

    try:
        async with db.execute("SELECT * FROM dialogue ORDER BY RANDOM() LIMIT 1") as cursor:
            row = await cursor.fetchone()
        dialogue_data = dict(row) if row else None
    except aiosqlite.Error:
        dialogue_data = None

    css_timestamp = await get_file_timestamp('./static/css/main.css')
    js_timestamp = await get_file_timestamp('./static/js/main.js')

    context = {
        "title": "製品検索",
        "css_timestamp": css_timestamp,
        "js_timestamp": js_timestamp,
        "now": now_date,
        "user_uuid": user_uuid,
        "dialogue": dialogue_data,
    }
    response = templates.TemplateResponse(request, 'index.html', context)
    response.set_cookie(key="user_uuid", value=user_uuid, max_age=180*24*3600)
    return response

def build_search_query(keys: list[str], base_query: str, q: str) -> tuple[str, list]:
    if not keys:
        return f"{base_query} WHERE keyword LIKE ?", [f"%{q}%"]
    
    conds_list = []
    params = []
    for k in keys:
        conds_list.append("(keyword LIKE ? OR name LIKE ? OR code LIKE ?)")
        params.extend([f"%{k}%", f"%{k}%", f"%{k}%"])
    conds = " AND ".join(conds_list)
    
    query = f"{base_query} WHERE ({conds}) OR keyword LIKE ?"
    params.append(f"%{q}%")
    return query, params

@app.get("/search/", name="search")
async def search_products(q: str = '', db: aiosqlite.Connection = Depends(get_db)):
    q = q.strip()
    if not q:
        return {"products": [], "count": 0}
        
    keys = normalize_text(q).split()
    use_fts = all(len(k) >= 3 for k in keys) if keys else False
    base_query = "SELECT slug, sk, code, name FROM product"
    
    try:
        if use_fts:
            fts_query = " AND ".join([f'"{k}"' for k in keys])
            
            conds_list = []
            params = [fts_query]
            for k in keys:
                conds_list.append("(name LIKE ? OR code LIKE ?)")
                params.extend([f"%{k}%", f"%{k}%"])
            name_code_cond = " AND ".join(conds_list) if conds_list else "0"
            
            query = f"""
                {base_query} 
                WHERE (rowid IN (
                    SELECT rowid FROM product_fts 
                    WHERE product_fts MATCH ?
                ))
                OR ({name_code_cond})
                OR keyword LIKE ?
            """
            params.append(f"%{q}%")
            
            async with db.execute(query, params) as cursor:
                rows = await cursor.fetchall()
        else:
            query, params = build_search_query(keys, base_query, q)
            async with db.execute(query, params) as cursor:
                rows = await cursor.fetchall()
                
        results = [dict(row) for row in rows]
        return {"products": results, "count": len(rows)}
        
    except aiosqlite.Error as e:
        if use_fts:
            try:
                query, params = build_search_query(keys, base_query, q)
                async with db.execute(query, params) as cursor:
                    rows = await cursor.fetchall()
                results = [dict(row) for row in rows]
                return {"products": results, "count": len(rows)}
            except aiosqlite.Error as e_like:
                raise HTTPException(status_code=500, detail=str(e_like))
        else:
            raise HTTPException(status_code=500, detail=str(e))

@app.get("/db/{slug}", name="read_data_slug")
async def read_data_slug(request: Request, slug: str, db: aiosqlite.Connection = Depends(get_db)):
    try:
        async with db.execute("SELECT * FROM product WHERE slug = ?", (slug,)) as cursor:
            rows = await cursor.fetchall()
            
        if not rows:
            raise HTTPException(status_code=404, detail="Product not found")
            
        results = [dict(row) for row in rows]
        
        names = list(dict.fromkeys([str(r.get("name", "")) for r in results if r.get("name")]))
        joined_names = " / ".join(names)
        
        product_data = {
            "slug": slug,
            "name": joined_names,
            "count": len(results),
            "items": results
        }
            
        return {"product": product_data}
    except aiosqlite.Error as e:
        raise HTTPException(status_code=500, detail=str(e))

class MemoData(BaseModel):
    memo: str

@app.get("/memo/{slug}", name="read_memo")
async def read_memo(slug: str, db: aiosqlite.Connection = Depends(get_db)):
    try:
        async with db.execute("SELECT memo FROM memo WHERE slug = ?", (slug,)) as cursor:
            r = await cursor.fetchone()
            
        return {"slug": slug, "memo": r["memo"] if r else ""}
    except aiosqlite.Error as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/memo/{slug}", name="write_memo")
async def write_memo(slug: str, data: MemoData, db: aiosqlite.Connection = Depends(get_db)):
    try:
        if not data.memo:
            await db.execute("DELETE FROM memo WHERE slug = ?", (slug,))
        else:
            await db.execute(
                "INSERT INTO memo (slug, memo) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET memo = ?",
                (slug, data.memo, data.memo)
            )
        await db.commit()
        return {"message": "メモが保存されました。"}
    except aiosqlite.Error as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/table/{table_name}", name="output_table")
async def output_table(table_name: str, page: int = 1, db: aiosqlite.Connection = Depends(get_db)):
    allowed_tables = [config['name'] for config in TABLE_CONFIGS]
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")

    limit = 50
    offset = (page - 1) * limit

    try:
        async with db.execute(f"SELECT COUNT(*) FROM {table_name}") as cursor:
            total_count = (await cursor.fetchone())[0]

        async with db.execute(f"SELECT * FROM {table_name} LIMIT ? OFFSET ?", (limit, offset)) as cursor:
            rows = await cursor.fetchall()
            
        results = [dict(row) for row in rows]
        total_pages = (total_count + limit - 1) // limit

        return {
            table_name: results,
            "page": page,
            "total_pages": total_pages,
            "total_count": total_count,
            "limit": limit
        }
        
    except aiosqlite.Error as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/shift/{index_day}", name="shift")
async def read_shift(index_day: str, db: aiosqlite.Connection = Depends(get_db)):
    try:
        async with db.execute("SELECT * FROM shift WHERE index_day = ?", (index_day,)) as cursor:
            row = await cursor.fetchone()
            
        if row is None:
            return {"shift": None}
            
        return {"shift": dict(row)}
    except aiosqlite.Error as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/ms", name="shift_page")
async def shift_page(request: Request, slug: str = None):
    return templates.TemplateResponse(request, 'shift.html', {"title": "シフト表", "slug": slug})

class UuidData(BaseModel):
    value: str

@app.get("/uuid/{user_uuid}/{req_type}", name="read_uuid_data")
async def read_uuid_data(user_uuid: str, req_type: str, db: aiosqlite.Connection = Depends(get_db)):
    if req_type not in ("f", "h"):
        raise HTTPException(status_code=400, detail="Invalid type")
    
    col = "favorite" if req_type == "f" else "history"
    try:
        async with db.execute(f"SELECT {col} FROM user_uuid WHERE uuid = ?", (user_uuid,)) as cursor:
            row = await cursor.fetchone()
            
        if row:
            return {col: row[col] if row[col] else ""}
        else:
            return {col: ""}
    except aiosqlite.Error as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/uuid/{user_uuid}/{req_type}", name="write_uuid_data")
async def write_uuid_data(user_uuid: str, req_type: str, data: UuidData, db: aiosqlite.Connection = Depends(get_db)):
    if req_type not in ("f", "h"):
        raise HTTPException(status_code=400, detail="Invalid type")
        
    col = "favorite" if req_type == "f" else "history"
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    fav_val = data.value if req_type == "f" else ""
    hist_val = data.value if req_type == "h" else ""
    
    try:
        await db.execute(f"""
            INSERT INTO user_uuid (uuid, favorite, history, days) 
            VALUES (?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET 
                {col} = excluded.{col},
                days = excluded.days
        """, (user_uuid, fav_val, hist_val, now_str))
        await db.commit()
        return {"status": "success"}
    except aiosqlite.Error as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.api_route("/id/{selection}", name="id", methods=["GET", "POST"])
async def user_id(request: Request, selection: str, db: aiosqlite.Connection = Depends(get_db)):
    if request.method != "POST":
        return {"result": False, "msg": "POSTリクエスト専用"}
    
    try:
        data = await request.json()
    except Exception:
        return {"result": False, "msg": "無効なデータです"}
        
    value = data.get("value", "")
    
    if selection == 'c':
        user_uuid = request.cookies.get("user_uuid")
        
        value = ''.join(chr(ord(c)-65248) if 65281<=ord(c)<=65374 else chr(32) if ord(c)==12288 else c for c in value)
        
        if not re.fullmatch(r'[A-Za-z0-9]+', value):
            return {"result": False, "msg": "ｱﾙﾌｧﾍﾞｯﾄと数字のみです"}
        if not (4 <= len(value) <= 22):
            return {"result": False, "msg": "4文字以上22文字以内にしてください"}
            
        async with db.execute("SELECT 1 FROM user_uuid WHERE uuid = ? COLLATE BINARY LIMIT 1", (value,)) as cursor:
            exists = await cursor.fetchone()
        if exists:
            return {"result": False, "msg": "既に存在しているID"}
            
        async with db.execute("SELECT 1 FROM user_uuid WHERE uuid = ? COLLATE BINARY LIMIT 1", (user_uuid,)) as cursor:
            orig = await cursor.fetchone()
            
        if orig:
            await db.execute("UPDATE user_uuid SET uuid = ? WHERE uuid = ? COLLATE BINARY", (value, user_uuid))
            await db.commit()
            return {"result": True, "msg": value}
        else:
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            await db.execute(
                "INSERT INTO user_uuid (uuid, favorite, history, days) VALUES (?, ?, ?, ?)",
                (value, "", "", now_str)
            )
            await db.commit()
            return {"result": True, "msg": value}
            
    if selection == 'l':
        async with db.execute("SELECT 1 FROM user_uuid WHERE uuid = ? COLLATE BINARY LIMIT 1", (value,)) as cursor:
            exists = await cursor.fetchone()
        return {"result": bool(exists), "msg": value if exists else "存在しないID"}
        
    return {"result": False, "msg": "c or l"}

@app.get("/backup/{table_name}", name="backup_table")
async def backup_table(table_name: str, db: aiosqlite.Connection = Depends(get_db)):
    allowed_tables = [config['name'] for config in TABLE_CONFIGS]
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")

    csv_path = Path(f"./csv/{table_name}.csv")

    try:
        async with db.execute(f"SELECT * FROM {table_name}") as cursor:
            rows = await cursor.fetchall()
            
        if not rows:
            return {"result": False, "msg": "テーブルにデータが存在しません"}
            
        headers = list(rows[0].keys())
        data = [tuple(row) for row in rows]
        
        await run_in_threadpool(write_csv_sync, str(csv_path), headers, data)
        
        return {"result": True, "msg": f"{table_name}.csv のバックアップが完了しました"}
        
    except aiosqlite.Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/save_table", name="save_table")
async def save_table(db: aiosqlite.Connection = Depends(get_db)):
    try:
        async with db.execute("SELECT * FROM product") as cursor:
            rows = await cursor.fetchall()
            
        if not rows:
            raise HTTPException(status_code=404, detail="No data found")
            
        data = [dict(row) for row in rows]
        df = pl.DataFrame(data)

        if "num" in df.columns:
            df = df.with_columns(
                pl.col("num").cast(pl.Int64, strict=False)
            )

        if "etc" in df.columns:
            df = df.with_columns(
                pl.col("etc").str.replace_all("\n", " / ", literal=True)
            )
        
        drop_cols = [col for col in ["slug", "keyword"] if col in df.columns]
        if drop_cols:
            df = df.drop(drop_cols)
            
        new_headers = [
            '連番', '金型番号', '商品コード', '製品名', '仕上時間', '仕上単位', 
            '人工', '異常作業', '総重量', '重量公差', '取数', '実サイクル', 
            '標準サイクル', '材質', '原料', 'MFR', '梱包', '積載', 'テープ', 
            'ﾀﾞﾝﾎﾞｰﾙ', '袋', '備考'
        ]
        
        if len(df.columns) == len(new_headers):
            df.columns = new_headers
        else:
            raise ValueError(f"列数が一致しません。現在の列数: {len(df.columns)}, 期待される列数: {len(new_headers)}")
            
        def write_to_excel(dataframe: pl.DataFrame):
            excel_buffer = io.BytesIO()
            dataframe.write_excel(excel_buffer)
            excel_buffer.seek(0)
            return excel_buffer
            
        excel_buffer = await run_in_threadpool(write_to_excel, df)
        
        date_str = datetime.datetime.now().strftime("%Y%m%d")
        filename = f"product_{date_str}.xlsx"
        filename_encoded = urllib.parse.quote(filename)
        
        headers = {
            'Content-Disposition': f'attachment; filename="{filename}"; filename*=utf-8\'\'{filename_encoded}'
        }
        
        return StreamingResponse(
            excel_buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------

@app.get("/docs", name="docs", response_class=RedirectResponse, status_code=307)
async def redirect_spreadsheets():
    return "https://docs.google.com/spreadsheets/d/11z0QmFR3t7cPUWK9moXK8GqlqPpffJOu5RH2PeLhUdc/edit"

@asynccontextmanager
async def process_safe_lock(lock_path: AsyncPath, timeout: float = 10.0):
    start_time = time.monotonic()
    while True:
        try:
            await lock_path.mkdir(exist_ok=False)
            break
        except FileExistsError:
            if time.monotonic() - start_time > timeout:
                raise TimeoutError("Lock acquisition timed out")
            await anyio.sleep(0.1)
    try:
        yield
    finally:
        try:
            await lock_path.rmdir()
        except FileNotFoundError:
            pass

@app.api_route("/rec", name="reception", methods=["GET", "POST"])
async def reception(request: Request, response: Response, db: aiosqlite.Connection = Depends(get_db)):
    try:
        if request.method == "GET":
            return {"result": False, "msg": "POSTリクエスト専用"}

        data = await request.json()
        if "time" not in data:
            response.status_code = 400
            return {"result": False, "msg": "内容が必要です。"}

        await backup_table('user_uuid', db)
        await backup_table('memo', db)
        
        sheets_data = data.get("sheets", {})
        work_dir = AsyncPath("shift")
        decision_csv_path = work_dir / "shift.csv"
        lock_dir = AsyncPath("shift.lock")
        
        try:
            async with process_safe_lock(lock_dir, timeout=10.0):
                if not await work_dir.exists():
                    await work_dir.mkdir()

                await anyio.to_thread.run_sync(write_and_process, sheets_data, str(decision_csv_path))
                
        except TimeoutError:
            response.status_code = 503
            return {"result": False, "msg": "処理が混み合っています。少し待ってから再試行してください。"}

        try:
            await update_data(request)
        except Exception as e:
            print(f"Process Error: {e}")
            
        return {"result": True, "msg": "受信・保存完了"}

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"【エラー】{error_msg}")
        response.status_code = 500
        return {"result": False, "msg": error_msg}

# ------------------------------------

@app.get("/item")
@app.get("/item/")
@app.get("/item/{slug}")
async def read_item_combined(slug: str | None = None, q: str | None = None, db: aiosqlite.Connection = Depends(get_db)):
    slug = _normalize_param(slug)
    q = _normalize_param(q)
    status = 2 if q else (1 if slug else 0)
    
    result = {}

    if status == 1:
        if len(slug) > 5:
            if "." in slug:
                search_slug = slug.replace(".", "_")
                async with db.execute("SELECT * FROM product WHERE code LIKE ? ORDER BY rowid DESC LIMIT 1", (f"%{search_slug}%",)) as cursor:
                    rows = await cursor.fetchall()
            else:
                async with db.execute("SELECT * FROM product WHERE code LIKE ? ORDER BY rowid DESC LIMIT 1", (f"%{slug}%",)) as cursor:
                    rows = await cursor.fetchall()
        else:
            async with db.execute("SELECT * FROM product WHERE slug = ? ORDER BY rowid DESC", (slug,)) as cursor:
                rows = await cursor.fetchall()

        if not rows:
            return {
                "slug": slug or "0",
                "q": q,
                "status": status,
                "result": "見つかりませんでした。"
            }

        mobile_parts = [generate_mobile_html_block(dict(row)) for row in rows]
        result = "".join(mobile_parts)
        if len(rows) > 1:
            result = f'{len(rows)}種類Hit\n\n' + result

    elif status == 2:
        keys = normalize_text(q).split()
        try:
            base_query = "SELECT sk, name, code, slug FROM product"
            query, params = build_search_query(keys, base_query, q)
            query += " ORDER BY rowid DESC LIMIT 50"
            
            async with db.execute(query, params) as cursor:
                rows = await cursor.fetchall()
                
            if not rows:
                result = {}
            else:
                result = {
                    f"{row['sk'] or ''} {row['name'] or ''}".strip(): (urllib.parse.quote(row['code']) or row['slug'] or "")
                    for row in rows
                }
                
        except aiosqlite.Error as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {
        "slug": slug or "0",
        "q": q,
        "status": status,
        "result": result
    }

# ------------------------------------

formatting_lock = anyio.Lock()

@app.get("/data_formatting", name="data_formatting")
async def data_formatting(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    chart_files = [f for f in CABINET_DIR.iterdir() if f.is_file() and RE_CHART_FILE.search(f.name)]
    latest_file = max(chart_files, key=lambda x: RE_CHART_DATE.search(x.name).group(), default=None)

    if latest_file:
        memo_date = RE_CHART_DATE.search(latest_file.name).group()
    else:
        memo_date = ''

    await write_memo('register', MemoData(memo=memo_date), db)

    try:
        async with formatting_lock:
            await anyio.to_thread.run_sync(process_data_sync, latest_file)
        return {'status': 'success'}
    except Exception as e:
        return {'status': str(e)}

@app.get("/apply", name="apply")
async def apply(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    try:
        await backup_table('user_uuid', db)
        await backup_table('memo', db)
    except Exception as e:
        return {'status': '01' + str(e)}
    try:
        return await update_data(request)
    except Exception as e:
        return {'status': '02' + str(e)}

@app.get("/wgtcsv", name="wgtcsv")
async def export_wgt_csv(db: aiosqlite.Connection = Depends(get_db)):
    async def iter_csv():
        yield "sk,code,name,wgt\n".encode('cp932', errors='replace')
        
        try:
            async with db.execute("SELECT sk, code, name, wgt FROM product") as cursor:
                async for row in cursor:
                    sk = str(row["sk"] or "").replace(",", " ").replace('"', '')
                    code = str(row["code"] or "").replace(",", " ").replace('"', '')
                    
                    raw_name = str(row["name"] or "").replace(",", " ").replace('"', '')
                    name = zen_to_han_fast_single(raw_name)
                    
                    wgt_str = row["wgt"] or ""
                    
                    calculated_wgt = parse_wgt(wgt_str)
                    
                    line = f"{sk},{code},{name},{calculated_wgt}\n"
                    
                    line = line.replace("•", "・")
                    
                    yield line.encode('cp932', errors='replace')
        except Exception:
            pass

    return StreamingResponse(
        iter_csv(),
        media_type="text/csv; charset=Shift_JIS",
        headers={"Content-Disposition": "attachment; filename=wgt.csv"}
    )

# ------------------------------------

@app.get('/test', name="test")
async def test(request: Request):
    user_uuid = request.cookies.get("user_uuid")
    context = {
        'title': '真・テスト',
        "com": 'com',
        "user_uuid": user_uuid,
    }
    response = templates.TemplateResponse(request, 'test.html', context)
    return response