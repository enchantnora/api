import os
import time
import shutil
import mimetypes
import aiosqlite
import shortuuid
import polars as pl
import fastexcel
import mutagen
from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException, Response
from fastapi.responses import FileResponse
from pathlib import Path
import pyarrow as pa
import urllib.parse
from datetime import datetime
import json
from PIL import Image, ExifTags
import asyncio

# 分割したファイルからのインポート
from utils import (
    get_file_timestamp, templates
)

# URLのプレフィックスを変数として定義
CABINET_PREFIX = "/cc"

# APIRouterとして定義し、プレフィックスとタグを設定
router = APIRouter(prefix=CABINET_PREFIX, tags=["cabinet"])

# 特別な名前
SPECIAL_NAMES = {
    "cxc": "1",
    "qwer": "2",
}

# mainディレクトリを基準に絶対パスを生成
BASE_DIR = Path(__file__).parent.resolve()
CABINET_DIR = (BASE_DIR / "cabinet").resolve()
CABINET_DIR.mkdir(exist_ok=True)
DB_PATH = BASE_DIR / "filer.db"

# 最大容量設定
MAX_CAPACITY_BYTES = 8 * 1024 * 1024 * 1024
MAX_CHUNK_BYTES = 80 * 1024 * 1024
TEMP_FILE_EXPIRE_SECONDS = 1800

EXT_CATEGORIES = {
    "image": ("png", "jpg", "jpeg", "gif", "bmp", "webp"),
    "svg": ("svg",),
    "video": ("mp4", "webm", "mov"),
    "audio": ("mp3", "wav", "m4a", "aac", "flac", "ogg"),
    "pdf": ("pdf",),
    "csv": ("csv",),
    "excel": ("xlsx", "xls", "xlsm"),
    "word": ("docx",),
    "markdown": ("md",),
    "3d": ("stl", "obj", "glb", "gltf"),
    "text": ("py", "html", "css", "js", "json", "log"),
    "edit": ("txt",),
}
PREVIEW_EXTS = {ext for k, exts in EXT_CATEGORIES.items() if k != "edit" for ext in exts}
EDIT_EXTS = set(EXT_CATEGORIES["edit"])

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("model/stl", ".stl")
mimetypes.add_type("model/obj", ".obj")
mimetypes.add_type("model/mtl", ".mtl")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")

_db_initialized = False
_last_cleanup_time = 0.0

# プロテクト設定
def is_protected_item(name: str, is_dir: bool) -> bool:
    if is_dir:
        return name == 'いろいろ'
    return (
        name == 'data.xlsx'
        or ('CYBER CABINET' in name)
        or ('MFR' in name and name.endswith('.xlsx'))
        or ('マスタデータ' in name and name.endswith('.xlsx'))
    )

def is_temp_file(name: str) -> bool:
    return name.endswith(".tmp") and len(name.split(".")) >= 3

def sanitize_name(name: str) -> str:
    cleaned = Path(name.strip()).name
    if not cleaned or cleaned in {".", ".."}:
        raise HTTPException(status_code=400, detail="無効な名前です")
    return cleaned

def get_admin_level(request: Request) -> int:
    try:
        return int(request.cookies.get("cabinet_admin", 0))
    except ValueError:
        return 0

def cleanup_stale_temp_files(max_age_seconds: int = TEMP_FILE_EXPIRE_SECONDS):
    now = time.time()
    stack = [CABINET_DIR]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(Path(entry.path))
                    elif entry.is_file(follow_symlinks=False) and is_temp_file(entry.name):
                        try:
                            if max_age_seconds <= 0 or (now - entry.stat(follow_symlinks=False).st_mtime) >= max_age_seconds:
                                Path(entry.path).unlink(missing_ok=True)
                        except OSError:
                            pass
        except OSError:
            pass

async def maybe_cleanup_temp_files():
    global _last_cleanup_time
    now = time.time()
    if now - _last_cleanup_time > 60:
        _last_cleanup_time = now
        await asyncio.to_thread(cleanup_stale_temp_files, TEMP_FILE_EXPIRE_SECONDS)

async def init_cabinet_db():
    global _db_initialized, _last_cleanup_time
    await asyncio.to_thread(cleanup_stale_temp_files, 0)
    _last_cleanup_time = time.time()

    async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS file_links (
                uuid TEXT PRIMARY KEY,
                relative_path TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                size INTEGER DEFAULT 0,
                tags TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        async with db.execute("PRAGMA table_info(file_links)") as cursor:
            columns = [row[1] for row in await cursor.fetchall()]
        if "size" not in columns:
            await db.execute("ALTER TABLE file_links ADD COLUMN size INTEGER DEFAULT 0")
        await db.commit()

        existing_rows = {}
        async with db.execute("SELECT relative_path, uuid, size FROM file_links") as cursor:
            async for rel_path, uuid_val, size_val in cursor:
                existing_rows[rel_path] = (uuid_val, size_val)

        def _scan_all_files():
            disk_files = {}
            stack = [CABINET_DIR]
            while stack:
                current = stack.pop()
                try:
                    with os.scandir(current) as it:
                        for entry in it:
                            if entry.is_dir(follow_symlinks=False):
                                stack.append(Path(entry.path))
                            elif entry.is_file(follow_symlinks=False) and not is_temp_file(entry.name):
                                full_path = Path(entry.path).resolve()
                                rel = full_path.relative_to(CABINET_DIR).as_posix()
                                stat = entry.stat(follow_symlinks=False)
                                dt_str = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                                disk_files[rel] = (full_path, entry.name, stat.st_size, dt_str)
                except OSError:
                    pass
            return disk_files

        disk_files = await asyncio.to_thread(_scan_all_files)

        obsolete_paths = [(p,) for p in existing_rows if p not in disk_files]
        if obsolete_paths:
            await db.executemany("DELETE FROM file_links WHERE relative_path = ?", obsolete_paths)

        new_entries = []
        size_updates = []
        for rel_path, (full_path, fname, fsize, dt_str) in disk_files.items():
            if rel_path not in existing_rows:
                tags_json = await asyncio.to_thread(extract_tags_from_file, full_path, fname)
                new_entries.append((shortuuid.uuid(), rel_path, fname, fsize, dt_str, tags_json))
            elif existing_rows[rel_path][1] != fsize:
                size_updates.append((fsize, existing_rows[rel_path][0]))

        if new_entries:
            await db.executemany("""
                INSERT OR IGNORE INTO file_links (uuid, relative_path, filename, size, created_at, tags)
                VALUES (?, ?, ?, ?, ?, ?)
            """, new_entries)
        if size_updates:
            await db.executemany("UPDATE file_links SET size = ? WHERE uuid = ?", size_updates)

        await db.commit()

    _db_initialized = True

async def ensure_db():
    if not _db_initialized or not DB_PATH.exists():
        await init_cabinet_db()

async def get_cabinet_size(directory: Path = CABINET_DIR) -> int:
    await ensure_db()
    async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
        async with db.execute("SELECT COALESCE(SUM(size), 0) FROM file_links") as cursor:
            row = await cursor.fetchone()
            return int(row[0]) if row else 0

def get_secure_path(path: str) -> Path:
    clean_path = path.lstrip("/\\")
    target_path = (CABINET_DIR / clean_path).resolve()
    if not target_path.is_relative_to(CABINET_DIR):
        raise HTTPException(status_code=403, detail="Access denied")
    return target_path

async def _get_file_target(uuid: str) -> tuple[Path, str]:
    await ensure_db()
    async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
        async with db.execute("SELECT relative_path, filename FROM file_links WHERE uuid = ?", (uuid,)) as cursor:
            row = await cursor.fetchone()
            
    if not row:
        raise HTTPException(status_code=404, detail="File link not found")
        
    rel_path, filename = row
    target = CABINET_DIR / rel_path
    
    exists_and_file = await asyncio.to_thread(lambda: target.exists() and target.is_file())
    if not exists_and_file:
        raise HTTPException(status_code=404, detail="File not found on disk")
        
    return target, filename

def extract_tags_from_file(file_path: Path, filename: str) -> str:
    tags = set()
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

    if ext in EXT_CATEGORIES["image"]:
        try:
            with Image.open(file_path) as img:
                tags.add(f"{img.width}x{img.height}")
                if hasattr(img, '_getexif') and img._getexif():
                    exif = img._getexif()
                    if exif:
                        for k, v in exif.items():
                            tag_name = ExifTags.TAGS.get(k)
                            if tag_name == 'Model' and isinstance(v, str):
                                model_name = v.strip('\x00').strip()
                                if model_name:
                                    tags.add(model_name)
        except Exception:
            pass

    elif ext in EXT_CATEGORIES["audio"]:
        try:
            audio = mutagen.File(file_path)
            if audio is not None:
                artist = None
                album = None
                if audio.tags:
                    artist_keys = ['TPE1', '\xa9ART', 'artist', 'Artist', 'ARTIST']
                    for k in artist_keys:
                        if k in audio.tags:
                            val = audio.tags[k]
                            artist = str(val[0]) if isinstance(val, list) else str(val)
                            break
                    
                    album_keys = ['TALB', '\xa9alb', 'album', 'Album', 'ALBUM']
                    for k in album_keys:
                        if k in audio.tags:
                            val = audio.tags[k]
                            album = str(val[0]) if isinstance(val, list) else str(val)
                            break
                
                if artist and artist.lower() != 'unknown':
                    tags.add(artist)

                if album and album.lower() != 'unknown':
                    tags.add(album)

                if hasattr(audio, 'info') and hasattr(audio.info, 'bitrate') and audio.info.bitrate:
                    tags.add(f"{int(audio.info.bitrate) // 1000}kbps")
        except Exception:
            pass
    elif ext in EXT_CATEGORIES["3d"]:
        try:
            tags.add('3D')
        except Exception:
            pass

    return json.dumps(list(tags), ensure_ascii=False)

@router.get("/", name="cc")
async def list_files(request: Request, path: str = "", query: str = ""):
    await ensure_db()
    await maybe_cleanup_temp_files()
    target_dir = get_secure_path(path)
    
    is_valid_dir = await asyncio.to_thread(lambda: target_dir.exists() and target_dir.is_dir())
    if not is_valid_dir:
        raise HTTPException(status_code=404, detail="Directory not found")

    file_info = {}
    async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
        if query:
            sql = "SELECT uuid, relative_path, created_at, tags, size FROM file_links"
            params = ()
        elif target_dir == CABINET_DIR:
            sql = "SELECT uuid, relative_path, created_at, tags, size FROM file_links WHERE relative_path NOT LIKE '%/%'"
            params = ()
        else:
            rel_dir = target_dir.relative_to(CABINET_DIR).as_posix()
            prefix = f"{rel_dir}/"
            sql = """
                SELECT uuid, relative_path, created_at, tags, size
                FROM file_links
                WHERE SUBSTR(relative_path, 1, ?) = ?
                  AND SUBSTR(relative_path, ?) NOT LIKE '%/%'
            """
            params = (len(prefix), prefix, len(prefix) + 1)

        async with db.execute(sql, params) as cursor:
            async for row in cursor:
                file_info[row[1]] = {
                    "uuid": row[0],
                    "created_at": row[2],
                    "tags": row[3],
                    "size": row[4],
                }

    missing_db_entries = []
    size_update_entries = []
    
    # 共通化するアイテム処理関数
    def process_item(entry_name: str, entry_path: Path, rel_path: str, is_dir: bool, file_size: int):
        item_tags = []
        if not is_dir and rel_path in file_info:
            tags_json_str = file_info[rel_path].get("tags") or '[]'
            try:
                item_tags = json.loads(tags_json_str)
            except Exception:
                pass
        
        ext = entry_name.rsplit('.', 1)[-1].lower() if (not is_dir and '.' in entry_name) else ''
        action_type = "edit" if ext in EDIT_EXTS else ("preview" if ext in PREVIEW_EXTS else None)

        item_data = {
            "name": entry_name,
            "is_dir": is_dir,
            "size": file_size,
            "path": rel_path,
            "is_protected": is_protected_item(entry_name, is_dir),
            "tags": item_tags,
            "ext": ext,
            "action_type": action_type,
        }
        
        if not is_dir:
            if rel_path in file_info:
                item_data["uuid"] = file_info[rel_path]["uuid"]
                dt_str = file_info[rel_path]["created_at"]
                item_data["created_at"] = dt_str[:19] if dt_str else ""
                if file_info[rel_path].get("size") != file_size:
                    size_update_entries.append((file_size, item_data["uuid"]))
            else:
                new_uuid = shortuuid.uuid()
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                item_data["uuid"] = new_uuid
                item_data["created_at"] = now_str
                missing_db_entries.append((new_uuid, rel_path, entry_name, file_size, now_str, '[]'))
        else:
            item_data["uuid"] = None
            item_data["created_at"] = ""
            try:
                with os.scandir(entry_path) as sub_it:
                    item_data["item_count"] = sum(1 for e in sub_it if not is_temp_file(e.name))
            except OSError:
                item_data["item_count"] = 0
                
        return item_data

    def _scan_items():
        scanned_items = []
        if query:
            query_parts = query.lower().split()
            stack = [CABINET_DIR]
            while stack:
                current = stack.pop()
                try:
                    with os.scandir(current) as it:
                        for entry in it:
                            if is_temp_file(entry.name):
                                continue
                            is_dir = entry.is_dir(follow_symlinks=False)
                            full_path = Path(entry.path).resolve()
                            if is_dir:
                                stack.append(full_path)
                            rel_path = full_path.relative_to(CABINET_DIR).as_posix()
                            item_name_lower = entry.name.lower()
                            tags_str_lower = ""
                            if not is_dir and rel_path in file_info:
                                tags_json_str = file_info[rel_path].get("tags") or '[]'
                                try:
                                    tags_str_lower = " ".join(json.loads(tags_json_str)).lower()
                                except Exception:
                                    pass
                            if all(part in item_name_lower or part in tags_str_lower for part in query_parts):
                                fsize = entry.stat(follow_symlinks=False).st_size if not is_dir else 0
                                scanned_items.append(process_item(entry.name, full_path, rel_path, is_dir, fsize))
                except OSError:
                    pass
        else:
            try:
                with os.scandir(target_dir) as it:
                    for entry in it:
                        if is_temp_file(entry.name):
                            continue
                        is_dir = entry.is_dir(follow_symlinks=False)
                        full_path = Path(entry.path).resolve()
                        rel_path = full_path.relative_to(CABINET_DIR).as_posix()
                        fsize = entry.stat(follow_symlinks=False).st_size if not is_dir else 0
                        scanned_items.append(process_item(entry.name, full_path, rel_path, is_dir, fsize))
            except OSError:
                pass
        scanned_items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        return scanned_items

    items = await asyncio.to_thread(_scan_items)
        
    if missing_db_entries or size_update_entries:
        async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
            if missing_db_entries:
                await db.executemany("""
                    INSERT OR IGNORE INTO file_links (uuid, relative_path, filename, size, created_at, tags)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, missing_db_entries)
            if size_update_entries:
                await db.executemany("""
                    UPDATE file_links SET size = ? WHERE uuid = ?
                """, size_update_entries)
            await db.commit()
    
    parent_path = ""
    if path:
        parent_path = str(Path(path).parent).replace("\\", "/")
        if parent_path == ".":
            parent_path = ""

    used_capacity = await get_cabinet_size(CABINET_DIR)
    admin = get_admin_level(request)

    formatted_current_path = path if path.endswith("/") else path + "/"

    css_timestamp = await get_file_timestamp('./static/css/cabinet.css')
    js_timestamp = await get_file_timestamp('./static/js/cabinet.js')

    return templates.TemplateResponse(
        request=request,
        name="cabinet.html",
        context={
            "css_timestamp": css_timestamp,
            "js_timestamp": js_timestamp,
            "items": items,
            "current_path": formatted_current_path,
            "parent_path": parent_path,
            "used_capacity": used_capacity,
            "max_capacity": MAX_CAPACITY_BYTES,
            "prefix": CABINET_PREFIX,
            "admin": admin,
            "query": query,
            "preview_exts": list(PREVIEW_EXTS),
            "edit_exts": list(EDIT_EXTS),
            "ext_categories": {k: list(v) for k, v in EXT_CATEGORIES.items()},
        }
    )

@router.post("/upload/")
async def upload_file(
    request: Request,
    path: str = Form(""),
    filename: str = Form(...),
    total_size: int = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    upload_id: str = Form(...),
    file: UploadFile = File(None)
):
    await ensure_db()
    filename = sanitize_name(filename)
    safe_upload_id = sanitize_name(upload_id)
    target_dir = get_secure_path(path)
    await asyncio.to_thread(target_dir.mkdir, parents=True, exist_ok=True)
    target_file = target_dir / filename
    
    if chunk_index == 0:
        await maybe_cleanup_temp_files()
        if await asyncio.to_thread(target_file.exists) and is_protected_item(filename, False):
            if get_admin_level(request) != 1:
                raise HTTPException(status_code=403, detail="保護されたファイルの上書きは禁止されています")
                
        used_capacity = await get_cabinet_size(CABINET_DIR)
        
        def get_old_size():
            return target_file.stat().st_size if target_file.exists() else 0
            
        old_file_size = await asyncio.to_thread(get_old_size)
        
        if (used_capacity - old_file_size + total_size) > MAX_CAPACITY_BYTES:
            raise HTTPException(status_code=400, detail="Capacity limit exceeded (Pre-check)")
            
    temp_file = target_dir / f"{filename}.{safe_upload_id}.tmp"
    
    try:
        if file is not None:
            chunk_data = await file.read()
            if len(chunk_data) > MAX_CHUNK_BYTES:
                raise HTTPException(status_code=413, detail="Chunk size exceeds 80MB limit")
            def write_chunk():
                with open(temp_file, "ab") as f:
                    f.write(chunk_data)
            await asyncio.to_thread(write_chunk)
            
        if chunk_index == total_chunks - 1:
            await asyncio.to_thread(temp_file.replace, target_file)
            actual_size = await asyncio.to_thread(lambda: target_file.stat().st_size)
            
            rel_path = target_file.resolve().relative_to(CABINET_DIR).as_posix()
            file_uuid = shortuuid.uuid()
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            tags_json = await asyncio.to_thread(extract_tags_from_file, target_file, filename)
            
            async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
                await db.execute("DELETE FROM file_links WHERE relative_path = ?", (rel_path,))
                await db.execute("""
                    INSERT INTO file_links (uuid, relative_path, filename, size, created_at, tags)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (file_uuid, rel_path, filename, actual_size, now_str, tags_json))
                await db.commit()
                
            # 変更点: "uuid": file_uuid をレスポンスに追加
            return {"status": "success", "filename": filename, "completed": True, "uuid": file_uuid}
            
        return {"status": "success", "chunk_index": chunk_index, "completed": False}
        
    except HTTPException:
        await asyncio.to_thread(temp_file.unlink, missing_ok=True)
        raise
    except Exception as e:
        await asyncio.to_thread(temp_file.unlink, missing_ok=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload/cancel/")
async def cancel_upload(
    path: str = Form(""),
    filename: str = Form(...),
    upload_id: str = Form(...)
):
    filename = sanitize_name(filename)
    safe_upload_id = sanitize_name(upload_id)
    target_dir = get_secure_path(path)
    temp_file = target_dir / f"{filename}.{safe_upload_id}.tmp"
    await asyncio.to_thread(temp_file.unlink, missing_ok=True)
    return {"status": "success"}

@router.post("/update_file/")
async def update_file(request: Request, uuid: str = Form(...), file: UploadFile = File(...)):
    target_file, filename = await _get_file_target(uuid)
    
    if is_protected_item(filename, False):
        if get_admin_level(request) != 1:
            raise HTTPException(status_code=403, detail="保護されたファイルの上書きは禁止されています")
            
    if not filename.lower().endswith('.txt'):
        raise HTTPException(status_code=400, detail="テキストファイルのみ更新可能です")
        
    try:
        content = await file.read()
        new_size = len(content)
        old_size = await asyncio.to_thread(lambda: target_file.stat().st_size if target_file.exists() else 0)
        used_capacity = await get_cabinet_size(CABINET_DIR)
        if (used_capacity - old_size + new_size) > MAX_CAPACITY_BYTES:
            raise HTTPException(status_code=400, detail="Capacity limit exceeded")

        def write_file():
            with open(target_file, "wb") as f:
                f.write(content)
        await asyncio.to_thread(write_file)

        async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
            await db.execute("UPDATE file_links SET size = ? WHERE uuid = ?", (new_size, uuid))
            await db.commit()

        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/mkdir/")
async def create_directory(request: Request, response: Response, path: str = Form(""), folder_name: str = Form(...)):
    lower_name = folder_name.strip().lower()
    if lower_name in SPECIAL_NAMES:
        target_level = SPECIAL_NAMES[lower_name]
        if request.cookies.get("cabinet_admin") == target_level:
            response.delete_cookie(key="cabinet_admin")
        else:
            response.set_cookie(key="cabinet_admin", value=target_level, httponly=True)
        return {"status": "success"}

    safe_folder_name = sanitize_name(folder_name)
    target_dir = get_secure_path(path)
    new_dir = target_dir / safe_folder_name
    await asyncio.to_thread(new_dir.mkdir, exist_ok=True)
    return {"status": "success"}

@router.post("/move/")
async def move_file(
    request: Request,
    uuid: str = Form(...),
    filename: str = Form(...),
    current_path: str = Form(""),
    target_path: str = Form("")
):
    source_path, db_filename = await _get_file_target(uuid)
    filename = sanitize_name(filename)

    if is_protected_item(db_filename, False):
        if get_admin_level(request) != 1:
            raise HTTPException(status_code=403, detail="このファイルは保護されているため移動できません")
    
    target_dir = get_secure_path(target_path)
    is_valid_dir = await asyncio.to_thread(lambda: target_dir.exists() and target_dir.is_dir())
    if not is_valid_dir:
        raise HTTPException(status_code=404, detail="Target directory not found")
        
    destination_path = target_dir / filename
    
    if await asyncio.to_thread(destination_path.exists):
        raise HTTPException(status_code=400, detail="同名のファイルが移動先に既に存在します")
        
    try:
        await asyncio.to_thread(shutil.move, str(source_path), str(destination_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to move file: {str(e)}")
        
    new_rel_path = destination_path.resolve().relative_to(CABINET_DIR).as_posix()
    
    async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
        await db.execute("""
            UPDATE file_links
            SET relative_path = ?
            WHERE uuid = ?
        """, (new_rel_path, uuid))
        await db.commit()
        
    return {"status": "success"}

@router.post("/update_metadata/")
async def update_metadata(
    request: Request,
    path: str = Form(...),
    new_name: str = Form(...),
    tags: str = Form("")
):
    await ensure_db()
    target = get_secure_path(path)
    if not await asyncio.to_thread(target.exists):
        raise HTTPException(status_code=404, detail="Item not found")

    new_name = sanitize_name(new_name)
    admin_level = get_admin_level(request)
    is_dir = await asyncio.to_thread(target.is_dir)

    if is_protected_item(target.name, is_dir) and admin_level != 1:
        raise HTTPException(status_code=403, detail="このアイテムは保護されています")

    new_target = target.parent / new_name
    old_rel_path = target.resolve().relative_to(CABINET_DIR).as_posix()
    new_rel_path = new_target.resolve().relative_to(CABINET_DIR).as_posix()

    if target.name != new_name:
        if await asyncio.to_thread(new_target.exists):
            raise HTTPException(status_code=400, detail="同名のアイテムが既に存在します")
        try:
            await asyncio.to_thread(target.rename, new_target)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to rename: {str(e)}")

    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    tags_json = json.dumps(tag_list, ensure_ascii=False)

    async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
        if is_dir:
            # ディレクトリ内の全ファイルのパスを更新
            if old_rel_path != new_rel_path:
                old_prefix = f"{old_rel_path}/"
                new_prefix = f"{new_rel_path}/"
                await db.execute("""
                    UPDATE file_links
                    SET relative_path = ? || SUBSTR(relative_path, ?)
                    WHERE SUBSTR(relative_path, 1, ?) = ?
                """, (new_prefix, len(old_prefix) + 1, len(old_prefix), old_prefix))
        else:
            # 単一ファイルのパス、ファイル名、タグを更新
            await db.execute("""
                UPDATE file_links 
                SET relative_path = ?, filename = ?, tags = ? 
                WHERE relative_path = ?
            """, (new_rel_path, new_name, tags_json, old_rel_path))
        await db.commit()

    return {"status": "success"}

@router.delete("/delete/")
async def delete_item(request: Request, path: str):
    await ensure_db()
    target = get_secure_path(path)
    
    if target == CABINET_DIR:
        raise HTTPException(status_code=403, detail="Cannot delete root directory")
    
    if not await asyncio.to_thread(target.exists):
        raise HTTPException(status_code=404, detail="Item not found")

    admin_level = get_admin_level(request)
    is_dir = await asyncio.to_thread(target.is_dir)

    if is_protected_item(target.name, is_dir) and admin_level != 1:
        type_str = "フォルダ" if is_dir else "ファイル"
        raise HTTPException(status_code=403, detail=f"この{type_str}は保護されています")

    if is_dir and admin_level != 1:
        def check_protected_children():
            stack = [target]
            while stack:
                current = stack.pop()
                try:
                    with os.scandir(current) as it:
                        for entry in it:
                            entry_is_dir = entry.is_dir(follow_symlinks=False)
                            if is_protected_item(entry.name, entry_is_dir):
                                return True
                            if entry_is_dir:
                                stack.append(Path(entry.path))
                except OSError:
                    pass
            return False
        if await asyncio.to_thread(check_protected_children):
            raise HTTPException(status_code=403, detail="保護されたアイテムが含まれているため削除できません")
        
    rel_path = target.resolve().relative_to(CABINET_DIR).as_posix()
        
    if is_dir:
        await asyncio.to_thread(shutil.rmtree, target)
        prefix = f"{rel_path}/"
        async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
            await db.execute(
                "DELETE FROM file_links WHERE SUBSTR(relative_path, 1, ?) = ?",
                (len(prefix), prefix)
            )
            await db.commit()
    else:
        await asyncio.to_thread(target.unlink)
        async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
            await db.execute("DELETE FROM file_links WHERE relative_path = ?", (rel_path,))
            await db.commit()
            
    return {"status": "success"}

@router.get("/f/{uuid}")
async def download_file_by_uuid(request: Request, uuid: str, inline: bool = False):
    target, filename = await _get_file_target(uuid)

    if not inline and is_protected_item(filename, False):
        if get_admin_level(request) < 1:
            raise HTTPException(status_code=403, detail="ダウンロード権限がありません")

    media_type, _ = mimetypes.guess_type(filename)

    if inline:
        headers = {
            "Content-Disposition": f"inline; filename*=utf-8''{urllib.parse.quote(filename)}"
        }
        return FileResponse(target, headers=headers, media_type=media_type)

    return FileResponse(target, filename=filename, media_type=media_type)

@router.get("/f_rel/{uuid}/{filename}")
async def download_relative_file(request: Request, uuid: str, filename: str):
    base_file_path, _ = await _get_file_target(uuid)
    
    safe_filename = sanitize_name(filename)
    target = base_file_path.parent / safe_filename

    exists_and_file = await asyncio.to_thread(lambda: target.exists() and target.is_file())
    if not exists_and_file:
        raise HTTPException(status_code=404, detail="Relative file not found")

    media_type, _ = mimetypes.guess_type(safe_filename)

    return FileResponse(target, filename=safe_filename, media_type=media_type)

@router.get("/excel/info/{uuid}")
async def get_excel_info(uuid: str):
    target, _ = await _get_file_target(uuid)
    try:
        def _read_sheets():
            excel = fastexcel.read_excel(str(target))
            return excel.sheet_names
        sheets = await asyncio.to_thread(_read_sheets)
        return {"sheets": sheets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read Excel info: {str(e)}")

@router.get("/excel/arrow/{uuid}")
async def get_excel_arrow(uuid: str, sheet: str):
    target, _ = await _get_file_target(uuid)
    try:
        def _build_arrow_bytes():
            df = pl.read_excel(target, sheet_name=sheet, engine="calamine")
            arrow_table = df.to_arrow()
            new_fields = []
            for field in arrow_table.schema:
                if pa.types.is_large_string(field.type):
                    new_fields.append(pa.field(field.name, pa.string(), nullable=field.nullable))
                else:
                    new_fields.append(field)
            arrow_table = arrow_table.cast(pa.schema(new_fields))
            sink = pa.BufferOutputStream()
            with pa.ipc.new_stream(sink, arrow_table.schema) as writer:
                writer.write_table(arrow_table)
            return sink.getvalue().to_pybytes()

        arrow_bytes = await asyncio.to_thread(_build_arrow_bytes)
        return Response(content=arrow_bytes, media_type="application/vnd.apache.arrow.file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read Excel sheet: {str(e)}")

@router.get("/audio/meta/{uuid}")
async def get_audio_meta(uuid: str):
    target, filename = await _get_file_target(uuid)
    
    default_meta = {
        "title": filename,
        "artist": "Unknown",
        "album": "Unknown",
        "duration": "00:00",
        "bitrate": "Unknown",
        "has_cover": False
    }
    
    try:
        def _extract_meta():
            audio = mutagen.File(target)
            if audio is None:
                return default_meta
                
            def get_tag(tags, keys):
                if not tags:
                    return None
                for k in keys:
                    if k in tags:
                        val = tags[k]
                        if isinstance(val, list):
                            return str(val[0])
                        return str(val)
                return None
                
            title = get_tag(audio.tags, ['TIT2', '\xa9nam', 'title', 'Title', 'TITLE']) or filename
            artist = get_tag(audio.tags, ['TPE1', '\xa9ART', 'artist', 'Artist', 'ARTIST']) or "Unknown"
            album = get_tag(audio.tags, ['TALB', '\xa9alb', 'album', 'Album', 'ALBUM']) or "Unknown"
            
            duration_str = "00:00"
            bitrate_str = "Unknown"
            if hasattr(audio, 'info'):
                if hasattr(audio.info, 'length') and audio.info.length:
                    duration = int(audio.info.length)
                    minutes = duration // 60
                    seconds = duration % 60
                    duration_str = f"{minutes:02d}:{seconds:02d}"
                
                if hasattr(audio.info, 'bitrate') and audio.info.bitrate:
                    bitrate_str = f"{int(audio.info.bitrate) // 1000} kbps"

            has_cover = False
            if hasattr(audio, 'tags') and audio.tags:
                if any(k.startswith('APIC') for k in audio.tags.keys()):
                    has_cover = True
                elif 'covr' in audio.tags:
                    has_cover = True
            if not has_cover and hasattr(audio, 'pictures') and audio.pictures:
                has_cover = True
                
            return {
                "title": title,
                "artist": artist,
                "album": album,
                "duration": duration_str,
                "bitrate": bitrate_str,
                "has_cover": has_cover
            }

        return await asyncio.to_thread(_extract_meta)
    except Exception:
        return default_meta

@router.get("/audio/cover/{uuid}")
async def get_audio_cover(uuid: str):
    target, _ = await _get_file_target(uuid)
    try:
        def _extract_cover():
            audio = mutagen.File(target)
            if audio is None:
                return None
            
            if hasattr(audio, 'tags') and audio.tags:
                for key, tag in audio.tags.items():
                    if key.startswith('APIC'):
                        return tag.data, tag.mime
                if 'covr' in audio.tags:
                    covr = audio.tags['covr'][0]
                    mime = 'image/jpeg' if covr.startswith(b'\xff\xd8') else 'image/png'
                    return bytes(covr), mime
                    
            if hasattr(audio, 'pictures') and audio.pictures:
                pic = audio.pictures[0]
                return pic.data, pic.mime
                
            return None

        result = await asyncio.to_thread(_extract_cover)
        if result is None:
            raise HTTPException(status_code=404, detail="No cover art")
        return Response(content=result[0], media_type=result[1])
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="Error extracting cover")