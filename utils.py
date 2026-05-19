import re
import csv
import datetime
import io
import json
import urllib.parse
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from collections import defaultdict

import polars as pl
from pykakasi import kakasi
from jinja2 import pass_context
from fastapi import Request
from fastapi.templating import Jinja2Templates
from starlette.routing import NoMatchFound
import anyio

# --- Constants & Settings ---
TABLE_CONFIGS = [
    {'name': 'product', 'file': str(Path('csv') / 'data.csv')},
    {'name': 'stopcode', 'file': str(Path('csv') / 'stopcode.csv')},
    {'name': 'shift', 'file': str(Path('shift') / 'shift.csv')},
    {'name': 'memo', 'file': str(Path('csv') / 'memo.csv')},
    {'name': 'dialogue', 'file': str(Path('csv') / 'dialogue.csv')},
    {'name': 'user_uuid', 'file': str(Path('csv') / 'user_uuid.csv')},
]

replace_dict = {
    ' ': ' ', '　': ' ', '-': ' ', '.': ' ', '/': ' ', '／': ' ',
    '#': 'syaapu', '＃': 'syaapu', 'シャープ': 'syaapu', 'φ': 'phi',
    '中蓋': 'nakafuta', '型': 'gata',
    'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o',
}

KAKASI_INST = kakasi()
sorted_keys = sorted(replace_dict.keys(), key=len, reverse=True)
pattern = re.compile('|'.join(re.escape(k) for k in sorted_keys))

CABINET_DIR = Path('./cabinet')

KKS_PATTERNS = [
    (re.compile(r'角樽', re.I), 'かくたる'),
    (re.compile(r'取っ手', re.I), 'とって'),
    (re.compile(r'取手', re.I), 'とって'),
    (re.compile(r'型', re.I), 'がた'),
    (re.compile(r'BOX', re.I), 'ぼっくす'),
    (re.compile(r'PET', re.I), 'ぺっと'),
    (re.compile(r'MF', re.I), 'えむえふ'),
    (re.compile(r'蓋', re.I), 'ふた'),
    (re.compile(r'中蓋', re.I), 'なかふた'),
    (re.compile(r'#', re.I), 'しゃーぷ'),
    (re.compile(r'長側', re.I), 'ちょうそく'),
    (re.compile(r'短側', re.I), 'たんそく'),
]

ZEN = "".join(chr(0xff01 + idx) for idx in range(94))
HAN = "".join(chr(0x21 + idx) for idx in range(94))
ZEN2HAN_TABLE = str.maketrans(ZEN, HAN)
CLEAN_TABLE = str.maketrans({'\n': '', ' ': '', '　': '', '-': '', '.': '', '•': '', '・': '', '/': '', '／': ''})

RE_CYCLE = re.compile(r'\d+(?:\.\d+)?')
RE_MFR_KEY = re.compile(r'^[A-Za-z]+-\d+$')
RE_CHART_FILE = re.compile(r'山積み.*\d{8}\.xlsx')
RE_CHART_DATE = re.compile(r'\d{8}')
RE_MFR_FILE = re.compile(r'MFR\.xlsx')
RE_NEWLINE = re.compile(r'[\r\n]+')

RE_BASE_WGT = re.compile(r'([0-9]+(?:\.[0-9]+)?)')
RE_COUNT = re.compile(r'[（\(].*?([0-9]+)[ヶ個].*?[）\)]')
RE_PAREN = re.compile(r'[（\(](.*?)[）\)]')

_ZEN2HAN_MAP: dict[int, str] = {0x3000: ' ', 0xFFE5: '\\'}
for i in range(0xFF01, 0xFF5F): _ZEN2HAN_MAP[i] = chr(i - 0xFEE0)
_KANA_MAP = {'ア': 'ｱ', 'イ': 'ｲ', 'ウ': 'ｳ', 'エ': 'ｴ', 'オ': 'ｵ', 'カ': 'ｶ', 'キ': 'ｷ', 'ク': 'ｸ', 'ケ': 'ｹ', 'コ': 'ｺ', 'サ': 'ｻ', 'シ': 'ｼ', 'ス': 'ｽ', 'セ': 'ｾ', 'ソ': 'ｿ', 'タ': 'ﾀ', 'チ': 'ﾁ', 'ツ': 'ﾂ', 'テ': 'ﾃ', 'ト': 'ﾄ', 'ナ': 'ﾅ', 'ニ': 'ﾆ', 'ヌ': 'ﾇ', 'ネ': 'ﾈ', 'ノ': 'ﾉ', 'ハ': 'ﾊ', 'ヒ': 'ﾋ', 'フ': 'ﾌ', 'ヘ': 'ﾍ', 'ホ': 'ﾎ', 'マ': 'ﾏ', 'ミ': 'ﾐ', 'ム': 'ﾑ', 'メ': 'ﾒ', 'モ': 'ﾓ', 'ヤ': 'ﾔ', 'ユ': 'ﾕ', 'ヨ': 'ﾖ', 'ラ': 'ﾗ', 'リ': 'ﾘ', 'ル': 'ﾙ', 'レ': 'ﾚ', 'ロ': 'ﾛ', 'ワ': 'ﾜ', 'ヲ': 'ｦ', 'ン': 'ﾝ', 'ァ': 'ｧ', 'ィ': 'ｨ', 'ゥ': 'ｩ', 'ェ': 'ｪ', 'ォ': 'ｫ', 'ッ': 'ｯ', 'ャ': 'ｬ', 'ュ': 'ｭ', 'ョ': 'ｮ', 'ー': 'ｰ', '、': '､', '。': '｡', '・': '･', '「': '｢', '」': '｣', '゛': 'ﾞ', '゜': 'ﾟ'}
_KANA_DAKUTEN_MAP = {'ガ': 'ｶﾞ', 'ギ': 'ｷﾞ', 'グ': 'ｸﾞ', 'ゲ': 'ｹﾞ', 'ゴ': 'ｺﾞ', 'ザ': 'ｻﾞ', 'ジ': 'ｼﾞ', 'ズ': 'ｽﾞ', 'ゼ': 'ｾﾞ', 'ゾ': 'ｿﾞ', 'ダ': 'ﾀﾞ', 'ヂ': 'ﾁﾞ', 'ヅ': 'ﾂﾞ', 'デ': 'ﾃﾞ', 'ド': 'ﾄﾞ', 'バ': 'ﾊﾞ', 'ビ': 'ﾋﾞ', 'ブ': 'ﾌﾞ', 'ベ': 'ﾍﾞ', 'ボ': 'ﾎﾞ', 'パ': 'ﾊﾟ', 'ピ': 'ﾋﾟ', 'プ': 'ﾌﾟ', 'ペ': 'ﾍﾟ', 'ポ': 'ﾎﾟ', 'ヴ': 'ｳﾞ'}
for k, v in _KANA_MAP.items(): _ZEN2HAN_MAP[ord(k)] = v
for k, v in _KANA_DAKUTEN_MAP.items(): _ZEN2HAN_MAP[ord(k)] = v


# --- Templates & url_for ---
templates = Jinja2Templates(directory='templates')

@pass_context
def custom_url_for(context: dict, name: str, **path_params: any) -> str:
    request = context.get("request")
    if not request:
        return "/"
        
    if name == "static":
        return f"/static/{path_params.get('path')}"
        
    path_only = {k: v for k, v in path_params.items() if k != "q"}
    query = {k: v for k, v in path_params.items() if k == "q"}
    try:
        url = request.url_for(name, **path_only)
    except NoMatchFound:
        try:
            url = request.url_for(name)
        except NoMatchFound:
            return "/"
    if query:
        url = url.include_query_params(**query)
    return str(url)

templates.env.globals["url_for"] = custom_url_for


# --- DB Dependency ---
async def get_db(request: Request):
    yield request.app.state.db


# --- Functions ---
@lru_cache(maxsize=None)
def normalize_text(text: str) -> str:
    if not text:
        return ""
    normalized = pattern.sub(lambda m: replace_dict[m.group()], text)
    converted = KAKASI_INST.convert(normalized)
    return ''.join([c['hepburn'] for c in converted])

def process_csv_and_schema(csv_path: str, table_name: str):
    if not Path(csv_path).is_file():
        return None, None, None
    df = pl.read_csv(str(csv_path), infer_schema_length=0)
    if "index" in df.columns:
        df = df.with_columns(pl.col("index").str.replace_all(r"\.", "", literal=True))
    pk_col = df.columns[0]
    df = df.unique(subset=[pk_col], keep='last', maintain_order=True)
    if "index" in df.columns:
        df = df.sort("index")
    is_memo_target = table_name == 'memo' and "slug" in df.columns and "memo" in df.columns
    if is_memo_target:
        today_str = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
        if (df["slug"] == "file_timestamp").any():
            df = df.with_columns(
                pl.when(pl.col("slug") == "file_timestamp")
                .then(pl.lit(today_str))
                .otherwise(pl.col("memo"))
                .alias("memo")
            )
        else:
            new_row_data = {col: "" for col in df.columns}
            new_row_data["slug"] = "file_timestamp"
            new_row_data["memo"] = today_str
            new_row_df = pl.DataFrame([new_row_data], schema=df.schema)
            df = pl.concat([new_row_df, df])
    cols_def = [f"{pk_col} TEXT PRIMARY KEY"]
    cols_def.extend([f"{col} TEXT" for col in df.columns if col != pk_col])
    create_sql = f"CREATE TABLE {table_name} ({', '.join(cols_def)})"
    return create_sql, df.columns, df.rows()

async def get_file_timestamp(file_path: str) -> str:
    try:
        stat = Path(file_path).stat()
        return datetime.datetime.fromtimestamp(stat.st_mtime).strftime('%Y%m%d%H%M%S')
    except OSError:
        return '0'

def write_csv_sync(filepath: str, headers: list, rows: list):
    filepath_obj = Path(filepath)
    filepath_obj.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath_obj, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

# ------------------------------------

def get_val(item_dict: dict, key: str) -> str:
    val = item_dict.get(key)
    return str(val) if val is not None else ""

def _normalize_param(val: str | None) -> str | None:
    if val is None: return None
    val = val.strip()
    return None if val in ("", "0") else val

def _safe_float(val, default: float = 0.0) -> float:
    return float(val) if is_numeric(val) else default

def _strip_dot_zero(val: str) -> str:
    if val.endswith('.0') and val[:-2].lstrip('-').isdigit():
        return val[:-2]
    return val

def generate_mobile_html_block(item: dict) -> str:
    parts = []
    if sk   := item.get("sk"):   parts.append(f"■■{sk}■■")
    if code := item.get("code"): parts.append(code)
    if name := item.get("name"): parts.append(name)
    parts += [
        f"【仕上時間】{get_val(item, 'time_val')}",  f"【仕上単位】{get_val(item, 'unit')}",
        f"【人工】{get_val(item, 'skill')}",          f"【異常作業】{get_val(item, 'abnormal')}",
        f"【総重量】{get_val(item, 'grossWeight')}",  f"【重量公差】{get_val(item, 'wgt')}",
        f"【取数】{get_val(item, 'spawn')}",          f"【実ｻｲｸﾙ】{get_val(item, 'cycle_val')}",
        f"【標準ｻｲｸﾙ】{get_val(item, 'standard')}", f"【材質】{get_val(item, 'material')}",
        f"【原料】{get_val(item, 'raw')}",            f"【MFR】{get_val(item, 'raw_mfr')}",
        f"【梱包】{get_val(item, 'one_box')}",        f"【積載】{get_val(item, 'pallet')}",
        f"【テープ】{get_val(item, 'tape')}",         f"【ﾀﾞﾝﾎﾞｰﾙ】{get_val(item, 'box')}",
        f"【袋】{get_val(item, 'bag')}",
    ]
    if etc_val := get_val(item, 'etc'): parts.append(f"【備考】{etc_val}")
    parts.append("____________________")
    return "\n".join(parts) + "\n"


def generate_keyword(goods, resource, sk, i_2, i_4):
    trans = goods
    for pattern_re, replacement in KKS_PATTERNS:
        trans = pattern_re.sub(replacement, trans)
    romaji = KAKASI_INST.convert(trans)
    hira, kana, hepburn, kunrei, passport = (
        ''.join(item[k] for item in romaji)
        for k in ('hira', 'kana', 'hepburn', 'kunrei', 'passport')
    )
    keyword = f'{sk},{i_2},{i_4},{hira},{kana},{hepburn},{kunrei},{passport}'
    keyword = keyword.translate(CLEAN_TABLE).translate(ZEN2HAN_TABLE)
    if resource == '未登録':
        keyword += ',未登録'
    return keyword


def is_numeric(value):
    try:
        float(value)
        return True
    except (ValueError, TypeError):
        return False


def format_number(num):
    return f"{round(num, 2):.2f}".rstrip('0').rstrip('.')


def resources(stack_chart, cycle, tori, s_cycle):
    if not isinstance(stack_chart, dict):
        return {'finish': '未登録', 'unit': '未登録', 'resource': '未登録', 'abnormal': '未登録'}
    c = RE_CYCLE.search(str(s_cycle))
    s_cycle_val = c.group() if c else 0
    try:
        cycle_val = float(cycle) if is_numeric(cycle) else float(s_cycle_val)
        finish   = _safe_float(stack_chart.get(5))
        unit     = _safe_float(stack_chart.get(6))
        abnormal = _safe_float(stack_chart.get(9))
        result = round((3600 / cycle_val) * float(tori) / unit * finish / 3600, 2)
        return {
            'finish':   format_number(finish),
            'unit':     format_number(unit),
            'resource': format_number(result),
            'abnormal': format_number(abnormal),
        }
    except Exception:
        return {'finish': '不詳', 'unit': '不詳', 'resource': '不詳', 'abnormal': '不詳'}


def read_excel_to_dict_list(filepath, sheet_name=None):
    if not filepath.exists():
        return []
    df = (pl.read_excel(filepath, sheet_name=sheet_name, has_header=False, engine="calamine")
          if sheet_name else
          pl.read_excel(filepath, has_header=False, engine="calamine"))
    df = df.cast(pl.String).fill_null("")
    dict_list = []
    for row in df.iter_rows():
        d = {j: "" for j in range(1, 25)}
        for j, val in enumerate(row[1:], start=1):
            d[j] = _strip_dot_zero(val).strip()
        dict_list.append(d)
    return dict_list


def process_data_sync(latest_file):
    file_path = CABINET_DIR / 'data.xlsx'
    data      = read_excel_to_dict_list(file_path, sheet_name='データ')[1:]
    chart     = read_excel_to_dict_list(latest_file) if latest_file else []
    chart_dict = {f"{d.get(2)}-{d.get(3)}": d for d in chart if 2 in d}

    mfr_files = [f for f in CABINET_DIR.iterdir() if f.is_file() and RE_MFR_FILE.search(f.name)]
    mfr       = read_excel_to_dict_list(mfr_files[0]) if mfr_files else []
    mfr_dict  = {}
    for d in mfr:
        key_col = next((j for j in range(1, 6) if RE_MFR_KEY.match(str(d.get(j, '')).strip())), None)
        if key_col:
            shift = key_col - 2
            d['raw_val']     = d.get(5 + shift, "")
            d['raw_mfr_val'] = d.get(6 + shift, "")
            mfr_dict[str(d.get(key_col)).replace('-', '').strip()] = d

    products = []
    for i in data:
        tori = 1 if i.get(13) == '' else int(i.get(13))
        keys         = [item if '-' in item else f"{item}-00" for item in str(i.get(2, '')).split()]
        chart_result = next((chart_dict[k] for k in keys if k in chart_dict), None)
        stack        = resources(chart_result, i.get(12, ''), tori, i.get(6, ''))

        sk_n = str(i.get(1, '')).replace('.', '')
        sk   = f'SK{sk_n}' if i.get(7) == '' else f'{str(i.get(7)).upper()}{sk_n}'
        code = str(i.get(2, '')).replace('\n', ' ')
        name = str(i.get(4, '')).replace('\n', '・')
        gw   = i.get(18, '')
        grossWeight = f'{gw}ｇ' if gw else ''
        wgt  = str(i.get(17, '')).replace('±', ' ±')

        mfr_entry = mfr_dict.get(sk, {})
        raw     = RE_NEWLINE.sub(' / ', str(mfr_entry.get('raw_val', "")))
        raw_mfr = RE_NEWLINE.sub(' / ', str(mfr_entry.get('raw_mfr_val', "")))
        _etc    = [str(i.get(k, "")).strip() for k in (19, 20) if i.get(k)]
        keyword = generate_keyword(name, stack["resource"], sk, str(i.get(2, '')), str(i.get(4, '')))

        products.append([
            sk_n, sk, code, name,
            stack["finish"], stack["unit"], stack["resource"], stack["abnormal"],
            grossWeight, wgt,
            str(i.get(13, '')), str(i.get(12, '')),
            i.get(6) if i.get(6) != "" else "",
            str(i.get(11, '')), raw, raw_mfr,
            str(i.get(14, '')), str(i.get(15, '')),
            str(i.get(21, '')), str(i.get(22, '')), str(i.get(23, '')),
            "\n".join(_etc), keyword,
        ])

    products = [p for p in products if p[0] != ""]
    products.sort(key=lambda x: int(x[0].replace("SK", "").replace("ZZ", "")))
    for idx, row in enumerate(products, start=1):
        row.insert(0, idx)

    columns = ['num', 'slug', 'sk', 'code', 'name', 'time_val', 'unit', 'skill', 'abnormal',
               'grossWeight', 'wgt', 'spawn', 'cycle_val', 'standard', 'material', 'raw', 'raw_mfr',
               'one_box', 'pallet', 'tape', 'box', 'bag', 'etc', 'keyword']
    output_dir = Path('./csv')
    output_dir.mkdir(exist_ok=True)
    pl.DataFrame(products, schema=columns, orient="row").write_csv(output_dir / 'data.csv')

# ------------------------------------

def parse_wgt(wgt_str: str) -> str:
    if not wgt_str: return ""
    total_wgt = 0.0
    parts = str(wgt_str).split('/')
    has_valid_val = False
    for part in parts:
        part = part.strip()
        if not part: continue
        base_wgt = 0.0
        paren_match = RE_PAREN.search(part)
        if paren_match:
            inner_text = paren_match.group(1)
            if '、' in inner_text or ',' in inner_text or '，' in inner_text:
                first_item = inner_text.replace(',', '、').replace('，', '、').split('、')[0]
                match = RE_BASE_WGT.search(first_item)
                if match:
                    base_wgt = float(match.group(1))
                    has_valid_val = True
                total_wgt += base_wgt
                continue
        base_match = RE_BASE_WGT.search(part)
        if not base_match: continue
        base_wgt = float(base_match.group(1))
        has_valid_val = True
        count_match = RE_COUNT.search(part)
        if count_match:
            count = int(count_match.group(1))
            if count > 0: base_wgt /= count
        total_wgt += base_wgt
    if not has_valid_val: return ""
    d_val = Decimal(str(total_wgt))
    rounded = d_val.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return str(rounded).rstrip('0').rstrip('.') if '.' in str(rounded) else str(rounded)

def zen_to_han_fast_single(text: str) -> str:
    return text.translate(_ZEN2HAN_MAP)

# ------------------------------------

def normalize_name(raw: str) -> str:
    return re.sub(r'　{2,}', '　', raw.strip().replace(' ', '　'))

def name_set(name: str, ope: dict) -> str:
    val = ope.get(name, 0)
    if val == 0:
        return name
    ope[name] = max(0, val - 1)
    return f'{name} ({val:+})'

def write_and_process(sheets_data: dict, decision_csv_path: str):
    data_list = [
        [str(sheet_name)] + [str(cell) for cell in row]
        for sheet_name, sheet_values in sheets_data.items()
        for row in sheet_values
    ]
    work_process(data_list, decision_csv_path)

def work_process(data_list: list, decision_csv_path: str):
    if len(data_list) < 3:
        return

    sheets_dict: dict[str, list] = defaultdict(list)
    for row in data_list:
        sheets_dict[row[0]].append(row)

    result_dict = {}
    exclude_shifts = {'☓', 'X', 'x', '×', '停'}
    base_date = datetime.date(2001, 1, 1)

    for sheet_name, sheet_data in sheets_dict.items():
        if len(sheet_data) < 3:
            continue

        first_row, second_row = sheet_data[0], sheet_data[1]
        parts = sheet_name.split('-')
        if len(parts) < 2:
            continue

        start_year  = 2000 + int(parts[0])
        start_month = int(parts[1])

        b1_value = first_row[2].strip() if len(first_row) > 2 else ""
        target_work_days = int(b1_value) if b1_value.isdigit() else None

        ope = {}
        if target_work_days is not None:
            for row in sheet_data[2:]:
                if len(row) > 1:
                    name = normalize_name(row[1])
                    work_count = sum(
                        1 for col_idx in range(3, len(first_row))
                        if len(row) > col_idx
                        and (s := row[col_idx].strip())
                        and s not in exclude_shifts
                    )
                    ope[name] = work_count - target_work_days

        current_year, current_month, prev_day = start_year, start_month, 0
        sheet_days_keys = []

        for col_idx in range(3, len(first_row)):
            day_str = first_row[col_idx].strip()
            if not day_str.isdigit():
                continue

            day = int(day_str)
            if day < prev_day:
                current_month += 1
                if current_month > 12:
                    current_month, current_year = 1, current_year + 1
            prev_day = day

            try:
                current_date = datetime.date(current_year, current_month, day)
            except ValueError:
                continue

            index_day   = int(f"{current_year}{current_month:02d}{day:02d}")
            weekday_str = second_row[col_idx].strip() if len(second_row) > col_idx else ""
            delta       = current_date - base_date

            days_str = f'<span class="blur">{current_year}年</span><br>{current_month}月 {day}日（{weekday_str}）'
            color    = '　<span id="b_hakui">【青】</span>' if delta.days % 14 > 6 else '　<span id="w_hakui">【白】</span>'

            member_dict_raw: dict[str, list] = defaultdict(list)
            for row in sheet_data[2:]:
                if len(row) > col_idx:
                    name  = normalize_name(row[1])
                    shift = row[col_idx].strip()
                    if name and shift and shift not in exclude_shifts:
                        member_dict_raw[shift].append(name)

            result_dict[index_day] = [index_day, days_str, color, dict(member_dict_raw)]
            sheet_days_keys.append(index_day)

        for idx_day in sorted(sheet_days_keys, reverse=True):
            daily = result_dict[idx_day][3]
            result_dict[idx_day][3] = json.dumps(
                {shift: [name_set(name, ope) for name in names] for shift, names in daily.items()},
                ensure_ascii=False
            )

    result_data = sorted(result_dict.values(), key=lambda x: x[0])
    result_data.insert(0, ["index_day", "days", "color", "member"])

    with open(decision_csv_path, mode='w', newline='', encoding='utf-8') as f:
        csv.writer(f).writerows(result_data)

# ------------------------------------