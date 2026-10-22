"""Windows workaround for dlt's state files.

dlt saves small JSON state files by writing a temp file and calling os.replace().
On Windows, os.replace() fails with "[WinError 5] Access is denied" when the
destination file is still open somewhere (another dlt thread reading it,
Windows Defender scanning it, the search indexer). The lock is momentary, so
we retry briefly and, if it persists, write the destination in place.
Only applied on Windows; Linux/macOS (and GitHub Actions) are untouched.
"""
from __future__ import annotations

import os
import time

_patched = False


def apply() -> None:
    global _patched
    if _patched or (os.name != "nt" and not os.getenv("POC_FORCE_WIN_COMPAT")):
        return
    from dlt.common.storages import file_storage as fs

    original = fs.FileStorage.save_atomic

    def save_atomic(storage_path: str, relative_path: str, data, file_type: str = "t") -> str:
        for attempt in range(8):
            try:
                return original(storage_path, relative_path, data, file_type)
            except PermissionError:
                time.sleep(0.05 * (attempt + 1))
        # still locked: write in place (the file is open for reading, not exclusively)
        dest = os.path.join(storage_path, relative_path)
        mode = "w" + file_type
        with open(dest, mode, encoding=None if "b" in mode else "utf-8") as f:
            f.write(data)
        return dest

    fs.FileStorage.save_atomic = staticmethod(save_atomic)

    original_rename = os.rename

    def rename_with_retry(src, dst, *args, **kwargs):
        for attempt in range(8):
            try:
                return original_rename(src, dst, *args, **kwargs)
            except PermissionError:
                if attempt == 7:
                    raise
                time.sleep(0.05 * (attempt + 1))

    fs.os = _OsProxy(rename_with_retry)
    _patched = True


class _OsProxy:
    """os module stand-in for dlt.file_storage whose rename() retries on Windows locks."""

    def __init__(self, rename):
        self._rename = rename

    def rename(self, *a, **k):
        return self._rename(*a, **k)

    def __getattr__(self, name):
        return getattr(os, name)