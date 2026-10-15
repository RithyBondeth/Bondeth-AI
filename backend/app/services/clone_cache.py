"""Bounded, process-local reuse of private cloning work; nothing is persisted.

Keys include the owner and content identity. TTL is checked on every operation;
an idle process may retain expired objects until its next operation or shutdown.
Never use this store as an authorization or reference-validation shortcut.
"""
import threading
import time
from collections import OrderedDict
from typing import Generic, TypeVar

T = TypeVar("T")


class CloneMemoryCache(Generic[T]):
    def __init__(self, max_entries: int, max_bytes: int, ttl_s: float):
        self._max_entries, self._max_bytes, self._ttl_s = max_entries, max_bytes, ttl_s
        self._items: OrderedDict[str, tuple[float, int, T]] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    def _remove(self, key: str):
        self._bytes -= self._items.pop(key)[1]

    def _expire(self):
        now = time.monotonic()
        for key, (deadline, _, _) in list(self._items.items()):
            if deadline <= now:
                self._remove(key)

    def get(self, key: str) -> T | None:
        with self._lock:
            self._expire()
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key][2]

    def put(self, key: str, value: T, size: int):
        with self._lock:
            self._expire()
            if key in self._items:
                self._remove(key)
            if self._max_entries <= 0 or self._ttl_s <= 0 or size > self._max_bytes:
                return
            while self._items and (len(self._items) >= self._max_entries or self._bytes + size > self._max_bytes):
                self._remove(next(iter(self._items)))
            self._items[key] = (time.monotonic() + self._ttl_s, size, value)
            self._bytes += size
