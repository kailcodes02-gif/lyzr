#!/usr/bin/env python3
# =============================================================================
# sync_from_sheets.py — pull the pipeline Google Sheet and regenerate data.json
# =============================================================================
# Option B (service account) live sync. Reads the pipeline rows from a private
# Google Sheet using a service account, then reuses pipeline/generate_data.py
# (the verified normaliser) to produce pipeline/data.json. The SHEET is the
# source of truth for the synced columns; this script preserves per-row
# created_by / created_at / edit_history from the existing data.json so
# dashboard-side metadata survives a sync.
#
# Environment:
#   GOOGLE_SERVICE_ACCOUNT_JSON  Service account key. Either the raw JSON string
#                                or a path to the .json file. The sheet must be
#                                shared (read-only) with this account's email.
#   GOOGLE_SHEET_ID              Spreadsheet id (the long id in the sheet URL).
#   SHEET_RANGE                  Tab + range, e.g. "Pipeline!A1:L". Default below.
#
# Dependencies (see requirements.txt):
#   google-api-python-client, google-auth, openpyxl
#
# Usage:
#   python3 scripts/sheet-sync/sync_from_sheets.py [output.json]
#   (output defaults to pipeline/data.json relative to the repo root)
#
# This script CANNOT run without a real service account + sheet; it is wired and
# ready, pending those secrets. See docs/google-sheets-sync.md.
# =============================================================================

import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GENERATOR = os.path.join(REPO_ROOT, "pipeline", "generate_data.py")
DEFAULT_OUT = os.path.join(REPO_ROOT, "pipeline", "data.json")
DEFAULT_RANGE = "Pipeline!A1:L"


def load_credentials():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        sys.exit("ERROR: GOOGLE_SERVICE_ACCOUNT_JSON is not set.")
    try:
        from google.oauth2 import service_account
    except ImportError:
        sys.exit("ERROR: google-auth not installed. pip install -r scripts/sheet-sync/requirements.txt")

    # Accept either a path to the key file or the raw JSON content.
    if os.path.exists(raw):
        info = json.load(open(raw, encoding="utf-8"))
    else:
        info = json.loads(raw)
    return service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )


def fetch_sheet_values():
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        sys.exit("ERROR: GOOGLE_SHEET_ID is not set.")
    rng = os.environ.get("SHEET_RANGE", DEFAULT_RANGE)
    try:
        from googleapiclient.discovery import build
    except ImportError:
        sys.exit("ERROR: google-api-python-client not installed. pip install -r scripts/sheet-sync/requirements.txt")

    creds = load_credentials()
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=rng)
        .execute()
    )
    values = resp.get("values", [])
    if len(values) < 2:
        sys.exit(f"ERROR: sheet range {rng} returned fewer than 2 rows (need header + data).")
    return values


def values_to_xlsx(values, path):
    try:
        from openpyxl import Workbook
    except ImportError:
        sys.exit("ERROR: openpyxl not installed. pip install -r scripts/sheet-sync/requirements.txt")
    wb = Workbook()
    ws = wb.active
    ws.title = "Pipeline"
    for row in values:
        ws.append(list(row))
    wb.save(path)


def row_key(r):
    # Best-effort stable key to carry metadata across syncs. Sheet ids are not
    # stable, so we match on the business identity of a row.
    return (
        r.get("segment") or "",
        (r.get("company") or "").strip().lower(),
        (r.get("project") or "").strip().lower(),
    )


def merge_metadata(new_path, old_data):
    """Carry created_by / created_at / edit_history from the previous data.json
    into the freshly generated rows, matched by business key. New rows get a
    fresh created_* stamp so every row matches the live schema."""
    new_data = json.load(open(new_path, encoding="utf-8"))
    old_by_key = {}
    for r in (old_data or {}).get("rows", []):
        old_by_key.setdefault(row_key(r), r)

    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    for r in new_data.get("rows", []):
        prev = old_by_key.get(row_key(r))
        if prev:
            r["created_by"] = prev.get("created_by", "google-sheet-sync")
            r["created_at"] = prev.get("created_at", now)
            r["edit_history"] = prev.get("edit_history", []) or []
        else:
            r["created_by"] = "google-sheet-sync"
            r["created_at"] = now
            r.setdefault("edit_history", [])
    new_data["source_file"] = "google-sheet"
    with open(new_path, "w", encoding="utf-8") as f:
        json.dump(new_data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return new_data


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    if not os.path.exists(GENERATOR):
        sys.exit(f"ERROR: generator not found at {GENERATOR}")

    # Snapshot the current data.json BEFORE overwriting, to preserve metadata.
    old_data = json.load(open(out_path, encoding="utf-8")) if os.path.exists(out_path) else None

    values = fetch_sheet_values()
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        xlsx_path = tmp.name
    try:
        values_to_xlsx(values, xlsx_path)
        subprocess.run(
            [sys.executable, GENERATOR, xlsx_path, out_path, "--source-label", "google-sheet"],
            check=True,
        )
    finally:
        try:
            os.unlink(xlsx_path)
        except OSError:
            pass

    merged = merge_metadata(out_path, old_data)
    agg = merged.get("aggregates", {})
    print(
        f"Synced from Google Sheet -> {out_path}  |  "
        f"rows: {agg.get('total_rows')}  |  total ACV: ${agg.get('total_acv', 0):,}"
    )


if __name__ == "__main__":
    main()
