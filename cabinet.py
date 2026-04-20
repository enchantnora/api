import shutil
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
    "wzz": "2",
}

# mainディレクトリを基準に絶対パスを生成
BASE_DIR = Path(__file__).parent.resolve()
CABINET_DIR = (BASE_DIR / "cabinet").resolve()
CABINET_DIR.mkdir(exist_ok=True)
DB_PATH = BASE_DIR / "filer.db"

# 最大容量設定
MAX_CAPACITY_BYTES = 8 * 1024 * 1024 * 1024

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

def get_admin_level(request: Request) -> int:
    try:
        return int(request.cookies.get("cabinet_admin", 0))
    except ValueError:
        return 0

async def init_cabinet_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS file_links (
                uuid TEXT PRIMARY KEY,
                relative_path TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                tags TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()

async def get_cabinet_size(directory: Path) -> int:
    def _calculate():
        total_size = 0
        for f in directory.rglob('*'):
            if f.is_file():
                total_size += f.stat().st_size
        return total_size
    return await asyncio.to_thread(_calculate)

def get_secure_path(path: str) -> Path:
    clean_path = path.lstrip("/\\")
    target_path = (CABINET_DIR / clean_path).resolve()
    if not str(target_path).startswith(str(CABINET_DIR)):
        raise HTTPException(status_code=403, detail="Access denied")
    return target_path

async def _get_file_target(uuid: str) -> tuple[Path, str]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT relative_path, filename FROM file_links WHERE uuid = ?", (uuid,)) as cursor:
            row = await cursor.fetchone()
            
    if not row:
        raise HTTPException(status_code=404, detail="File link not found")
        
    rel_path, filename = row
    target = CABINET_DIR / rel_path
    
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found on disk")
        
    return target, filename

def extract_tags_from_file(file_path: Path, filename: str) -> str:
    tags = set()
    ext = filename.split('.')[-1].lower() if '.' in filename else ''

    if ext in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
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

    elif ext in ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg']:
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
    elif ext in ['stl', 'obj', 'glb', 'gltf']:
        try:
            tags.add('3D')
        except Exception:
            pass

    return json.dumps(list(tags), ensure_ascii=False)

@router.get("/", name="cc")
async def list_files(request: Request, path: str = "", query: str = ""):
    target_dir = get_secure_path(path)
    
    if not target_dir.exists() or not target_dir.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    items = []
    file_info = {}
    
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT uuid, relative_path, created_at, tags FROM file_links") as cursor:
            async for row in cursor:
                file_info[row[1]] = {"uuid": row[0], "created_at": row[2], "tags": row[3]}

    missing_db_entries = []
    
    # 共通化するアイテム処理関数
    def process_item(item, rel_path, is_dir):
        item_tags = []
        if not is_dir and rel_path in file_info:
            tags_json_str = file_info[rel_path].get("tags") or '[]'
            try:
                item_tags = json.loads(tags_json_str)
            except:
                pass
        
        item_data = {
            "name": item.name,
            "is_dir": is_dir,
            "size": item.stat().st_size if item.is_file() else 0,
            "path": rel_path,
            "is_protected": is_protected_item(item.name, is_dir),
            "tags": item_tags
        }
        
        if not is_dir:
            if rel_path in file_info:
                item_data["uuid"] = file_info[rel_path]["uuid"]
                dt_str = file_info[rel_path]["created_at"]
                item_data["created_at"] = dt_str[:19] if dt_str else ""
            else:
                new_uuid = shortuuid.uuid()
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                item_data["uuid"] = new_uuid
                item_data["created_at"] = now_str
                missing_db_entries.append((new_uuid, rel_path, item.name, now_str, '[]'))
        else:
            item_data["uuid"] = None
            item_data["created_at"] = ""
            try:
                item_data["item_count"] = len(list(item.iterdir()))
            except PermissionError:
                item_data["item_count"] = 0
                
        return item_data

    if query:
        query_parts = query.lower().split()
        search_target = CABINET_DIR.rglob('*')
        
        for item in search_target:
            item_name_lower = item.name.lower()
            rel_path = str(item.resolve().relative_to(CABINET_DIR)).replace("\\", "/")
            is_dir = item.is_dir()
            
            tags_str_lower = ""
            if not is_dir and rel_path in file_info:
                tags_json_str = file_info[rel_path].get("tags") or '[]'
                try:
                    tags_str_lower = " ".join(json.loads(tags_json_str)).lower()
                except:
                    pass
            
            match = True
            for part in query_parts:
                if part not in item_name_lower and part not in tags_str_lower:
                    match = False
                    break
                    
            if match:
                items.append(process_item(item, rel_path, is_dir))
    else:
        for item in target_dir.iterdir():
            rel_path = str(item.resolve().relative_to(CABINET_DIR)).replace("\\", "/")
            is_dir = item.is_dir()
            items.append(process_item(item, rel_path, is_dir))
        
    if missing_db_entries:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.executemany("""
                INSERT OR IGNORE INTO file_links (uuid, relative_path, filename, created_at, tags)
                VALUES (?, ?, ?, ?, ?)
            """, missing_db_entries)
            await db.commit()
    
    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
    
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
        }
    )

@router.post("/upload/")
async def upload_file(request: Request, path: str = Form(""), file: UploadFile = File(...)):
    target_dir = get_secure_path(path)
    await asyncio.to_thread(target_dir.mkdir, parents=True, exist_ok=True)
    target_file = target_dir / file.filename
    
    if await asyncio.to_thread(target_file.exists) and is_protected_item(file.filename, False):
        if get_admin_level(request) != 1:
            raise HTTPException(status_code=403, detail="保護されたファイルの上書きは禁止されています")
            
    used_capacity = await get_cabinet_size(CABINET_DIR)
    
    def get_old_size():
        return target_file.stat().st_size if target_file.exists() else 0
        
    old_file_size = await asyncio.to_thread(get_old_size)
    
    if file.size is not None and (used_capacity - old_file_size + file.size) > MAX_CAPACITY_BYTES:
        raise HTTPException(status_code=400, detail="Capacity limit exceeded (Pre-check)")
        
    temp_file = target_dir / f"{file.filename}.{shortuuid.uuid()}.tmp"
    written_size = 0
    chunk_size = 1024 * 1024
    
    try:
        def write_chunk(chunk_data):
            with open(temp_file, "ab") as f:
                f.write(chunk_data)

        while chunk := await file.read(chunk_size):
            written_size += len(chunk)
            if (used_capacity - old_file_size + written_size) > MAX_CAPACITY_BYTES:
                raise HTTPException(status_code=400, detail="Capacity limit exceeded during upload")
            await asyncio.to_thread(write_chunk, chunk)

        await asyncio.to_thread(temp_file.replace, target_file)
        
    except Exception as e:
        await asyncio.to_thread(temp_file.unlink, missing_ok=True)
        raise e
        
    rel_path = str(target_file.resolve().relative_to(CABINET_DIR)).replace("\\", "/")
    file_uuid = shortuuid.uuid()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    tags_json = await asyncio.to_thread(extract_tags_from_file, target_file, file.filename)
    
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM file_links WHERE relative_path = ?", (rel_path,))
        await db.execute("""
            INSERT INTO file_links (uuid, relative_path, filename, created_at, tags)
            VALUES (?, ?, ?, ?, ?)
        """, (file_uuid, rel_path, file.filename, now_str, tags_json))
        await db.commit()
        
    return {"status": "success", "filename": file.filename}

@router.post("/mkdir/")
async def create_directory(request: Request, response: Response, path: str = Form(""), folder_name: str = Form(...)):
    folder_name = folder_name.lower()
    if folder_name in SPECIAL_NAMES:
        target_level = SPECIAL_NAMES[folder_name]
        if request.cookies.get("cabinet_admin") == target_level:
            response.delete_cookie(key="cabinet_admin")
        else:
            response.set_cookie(key="cabinet_admin", value=target_level, httponly=True)
        return {"status": "success"}

    target_dir = get_secure_path(path)
    new_dir = target_dir / folder_name
    new_dir.mkdir(exist_ok=True)
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

    if is_protected_item(db_filename, False):
        if get_admin_level(request) != 1:
            raise HTTPException(status_code=403, detail="このファイルは保護されているため移動できません")
    
    target_dir = get_secure_path(target_path)
    if not await asyncio.to_thread(target_dir.exists) or not await asyncio.to_thread(target_dir.is_dir):
        raise HTTPException(status_code=404, detail="Target directory not found")
        
    destination_path = target_dir / filename
    
    if await asyncio.to_thread(destination_path.exists):
        raise HTTPException(status_code=400, detail="同名のファイルが移動先に既に存在します")
        
    try:
        await asyncio.to_thread(shutil.move, str(source_path), str(destination_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to move file: {str(e)}")
        
    new_rel_path = str(destination_path.resolve().relative_to(CABINET_DIR)).replace("\\", "/")
    
    async with aiosqlite.connect(DB_PATH) as db:
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
    target = get_secure_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Item not found")

    admin_level = get_admin_level(request)
    is_dir = target.is_dir()

    if is_protected_item(target.name, is_dir) and admin_level != 1:
        raise HTTPException(status_code=403, detail="このアイテムは保護されています")

    new_target = target.parent / new_name
    old_rel_path = str(target.resolve().relative_to(CABINET_DIR)).replace("\\", "/")
    new_rel_path = str(new_target.resolve().relative_to(CABINET_DIR)).replace("\\", "/")

    if target.name != new_name:
        if new_target.exists():
            raise HTTPException(status_code=400, detail="同名のアイテムが既に存在します")
        try:
            target.rename(new_target)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to rename: {str(e)}")

    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    tags_json = json.dumps(tag_list, ensure_ascii=False)

    async with aiosqlite.connect(DB_PATH) as db:
        if is_dir:
            # ディレクトリ内の全ファイルのパスを更新
            async with db.execute("SELECT uuid, relative_path FROM file_links WHERE relative_path LIKE ?", (f"{old_rel_path}/%",)) as cursor:
                rows = await cursor.fetchall()
            for uuid, rel_path in rows:
                updated_rel_path = rel_path.replace(old_rel_path, new_rel_path, 1)
                await db.execute("UPDATE file_links SET relative_path = ? WHERE uuid = ?", (updated_rel_path, uuid))
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

    if admin_level != 1:
        def check_protected_children():
            for f in target.rglob('*'):
                if is_protected_item(f.name, f.is_dir()):
                    return True
            return False
        if await asyncio.to_thread(check_protected_children):
            raise HTTPException(status_code=403, detail="保護されたアイテムが含まれているため削除できません")
        
    rel_path = str(target.resolve().relative_to(CABINET_DIR)).replace("\\", "/")
        
    if is_dir:
        await asyncio.to_thread(shutil.rmtree, target)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM file_links WHERE relative_path LIKE ?", (f"{rel_path}/%",))
            await db.commit()
    else:
        await asyncio.to_thread(target.unlink)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM file_links WHERE relative_path = ?", (rel_path,))
            await db.commit()
            
    return {"status": "success"}

@router.get("/f/{uuid}")
async def download_file_by_uuid(request: Request, uuid: str, inline: bool = False):
    target, filename = await _get_file_target(uuid)

    if not inline and is_protected_item(filename, False):
        if get_admin_level(request) < 1:
            raise HTTPException(status_code=403, detail="ダウンロード権限がありません")

    media_type = None
    if filename.lower().endswith('.svg'):
        media_type = "image/svg+xml"
    elif filename.lower().endswith('.stl'):
        media_type = "model/stl"
    elif filename.lower().endswith('.obj'):
        media_type = "model/obj"
    elif filename.lower().endswith('.mtl'):
        media_type = "model/mtl"
    elif filename.lower().endswith('.glb'):
        media_type = "model/gltf-binary"
    elif filename.lower().endswith('.gltf'):
        media_type = "model/gltf+json"

    if inline:
        headers = {
            "Content-Disposition": f"inline; filename*=utf-8''{urllib.parse.quote(filename)}"
        }
        return FileResponse(target, headers=headers, media_type=media_type)

    return FileResponse(target, filename=filename, media_type=media_type)

@router.get("/f_rel/{uuid}/{filename}")
async def download_relative_file(request: Request, uuid: str, filename: str):
    base_file_path, _ = await _get_file_target(uuid)
    
    safe_filename = Path(filename).name
    target = base_file_path.parent / safe_filename

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Relative file not found")

    media_type = None
    if safe_filename.lower().endswith('.mtl'):
        media_type = "model/mtl"
    elif safe_filename.lower().endswith('.png'):
        media_type = "image/png"
    elif safe_filename.lower().endswith('.jpg') or safe_filename.lower().endswith('.jpeg'):
        media_type = "image/jpeg"

    return FileResponse(target, filename=safe_filename, media_type=media_type)

@router.get("/excel/info/{uuid}")
async def get_excel_info(uuid: str):
    target, _ = await _get_file_target(uuid)
    try:
        excel = fastexcel.read_excel(str(target))
        return {"sheets": excel.sheet_names}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read Excel info: {str(e)}")

@router.get("/excel/arrow/{uuid}")
async def get_excel_arrow(uuid: str, sheet: str):
    target, _ = await _get_file_target(uuid)
    try:
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
            
        return Response(content=sink.getvalue().to_pybytes(), media_type="application/vnd.apache.arrow.file")
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
        audio = mutagen.File(target)
        if audio is None:
            return default_meta
            
        def get_tag(tags, keys):
            if not tags: return None
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
    except Exception:
        return default_meta

@router.get("/audio/cover/{uuid}")
async def get_audio_cover(uuid: str):
    target, _ = await _get_file_target(uuid)
    try:
        audio = mutagen.File(target)
        if audio is None:
            raise HTTPException(status_code=404, detail="No audio file")
        
        if hasattr(audio, 'tags') and audio.tags:
            for key, tag in audio.tags.items():
                if key.startswith('APIC'):
                    return Response(content=tag.data, media_type=tag.mime)
            if 'covr' in audio.tags:
                covr = audio.tags['covr'][0]
                mime = 'image/jpeg' if covr.startswith(b'\xff\xd8') else 'image/png'
                return Response(content=bytes(covr), media_type=mime)
                
        if hasattr(audio, 'pictures') and audio.pictures:
            pic = audio.pictures[0]
            return Response(content=pic.data, media_type=pic.mime)
            
        raise HTTPException(status_code=404, detail="No cover art")
    except Exception:
        raise HTTPException(status_code=404, detail="Error extracting cover")