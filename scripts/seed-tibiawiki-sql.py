"""Genera seed/items_physical.json (peso y si es apilable) desde una base de tibiawiki-sql.

tibiawiki-sql (https://github.com/Galarzaa90/tibiawiki-sql) construye un SQLite a partir de TibiaWiki.
Este script NO descarga nada: lee una base ya generada por ti.

    pip install tibiawikisql
    tibiawikisql generate            # crea tibiawiki.db (tarda: recorre la wiki respetando su API)
    python scripts/seed-tibiawiki-sql.py ruta/a/tibiawiki.db

El esquema cambia entre versiones, así que las columnas se detectan por nombre.
"""

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent / "seed" / "items_physical.json"


def pick(columns: list[str], *candidates: str) -> str | None:
    lower = {c.lower(): c for c in columns}
    for c in candidates:
        if c in lower:
            return lower[c]
    return None


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    table = next((t for t in ("item", "items") if t in tables), None)
    if table is None:
        sys.exit(f"No hay tabla item/items en la base. Tablas: {tables}")
    columns = [r[1] for r in db.execute(f"PRAGMA table_info({table})")]
    name_col = pick(columns, "title", "name")
    weight_col = pick(columns, "weight")
    stack_col = pick(columns, "stackable")
    if not name_col or not weight_col:
        sys.exit(f"Columnas inesperadas en {table}: {columns}")

    rows = db.execute(f"SELECT {name_col}, {weight_col}, {stack_col or 'NULL'} FROM {table}").fetchall()
    items = []
    for name, weight, stackable in rows:
        if name is None:
            continue
        items.append(
            {
                "name": str(name),
                "weightOz": float(weight) if weight not in (None, "") else None,
                "stackable": None if stackable is None else bool(stackable),
            }
        )
    SEED.write_text(
        json.dumps(
            {
                "source": "tibiawiki-sql (TibiaWiki)",
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "items": items,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{SEED}: {len(items)} items")


if __name__ == "__main__":
    main()
