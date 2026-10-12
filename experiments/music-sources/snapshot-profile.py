"""Snapshot Yinamp's own encrypted app session; never read cookie values."""
import os
import shutil
import sqlite3
import sys
from pathlib import Path

source, target = map(Path, sys.argv[1:3])
os.umask(0o077)
target.mkdir(parents=True, exist_ok=False)
for name in ("Local State", "Preferences"):
    if (source / name).is_file():
        shutil.copy2(source / name, target / name)
partition = Path("Partitions/yinamp-youtube")
(target / partition).mkdir(parents=True)
for name in ("Preferences",):
    if (source / partition / name).is_file():
        shutil.copy2(source / partition / name, target / partition / name)
cookie_file = source / partition / "Cookies"
if not cookie_file.is_file():
    raise RuntimeError("Yinamp's app session is not present at the selected profile.")
with sqlite3.connect(cookie_file.as_uri() + "?mode=ro", uri=True) as original:
    with sqlite3.connect(target / partition / "Cookies") as snapshot:
        original.backup(snapshot)
print("Encrypted app-session snapshot created; cookie values were not inspected.")
