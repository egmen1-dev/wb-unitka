#!/usr/bin/env python3
"""Скачивает прайс поставщика из VK и сохраняет supplier-prices.json."""

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "supplier-prices.json"
VK_URL = (
    "https://vk.com/doc98349869_699441243?"
    "hash=Qwp6zmigdZzGikeng1unqDYOK5CRshU0tDYIcjsB63X&"
    "dl=LhqouAx9ZmfKsOBcOajJrmBqZk4JLz4Ze3fUoRS3wGo&from_module=vkmsg_desktop"
)


def digit_key(value):
    s = str(value).strip()
    if re.match(r"^\d+\.0$", s):
        s = s[:-2]
    return re.sub(r"\D", "", s)


def article_label(value):
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value).strip()


def fetch_file_url():
    req = urllib.request.Request(
        VK_URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; wb-unit-calc/1.0)"},
    )
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    html = html.replace("\\/", "/")
    match = re.search(r"https://psv[^\"']+?\.xls[x]?", html, re.I)
    if not match:
        raise RuntimeError("Ссылка на XLS не найдена в странице VK")
    return match.group(0)


def download_workbook(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; wb-unit-calc/1.0)",
            "Referer": "https://vk.com/",
        },
    )
    return urllib.request.urlopen(req, timeout=120).read()


def parse_workbook(data):
    try:
        import xlrd
    except ImportError as error:
        raise RuntimeError("Установите xlrd: pip install xlrd") from error

    book = xlrd.open_workbook(file_contents=data)
    sheet = book.sheet_by_name("TDSheet") if "TDSheet" in book.sheet_names() else book.sheet_by_index(0)
    by_digit_key = {}

    for row in range(2, sheet.nrows):
        article = sheet.cell_value(row, 0)
        price = sheet.cell_value(row, 3)
        if article == "" or price == "":
            continue
        try:
            price = float(price)
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue

        key = digit_key(article)
        if not key:
            continue

        by_digit_key[key] = {
            "price": round(price, 2),
            "article": article_label(article),
        }

    return by_digit_key


def main():
    file_url = fetch_file_url()
    print(f"Download: {file_url[:80]}…")
    workbook = download_workbook(file_url)
    by_digit_key = parse_workbook(workbook)

    payload = {
        "syncedAt": datetime.now(timezone.utc).isoformat(),
        "source": "vk:98349869_699441243",
        "total": len(by_digit_key),
        "byDigitKey": by_digit_key,
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(by_digit_key)} prices → {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
