"""Atomic admission/selection and exclusive worker ownership on shared storage.

The flock is held until the actual worker exits, including slow inference during
shutdown. Never unlink lock files: doing so would let two owners lock different inodes.
"""
import fcntl
from pathlib import Path

from redis import Redis

SUBMIT = """
if redis.call('LLEN', KEYS[1]) + redis.call('LLEN', KEYS[2]) + redis.call('LLEN', KEYS[3]) >= tonumber(ARGV[1]) then
    return 0
end
for i = 5, #ARGV, 2 do redis.call('HSET', KEYS[4], ARGV[i], ARGV[i+1]) end
redis.call('EXPIRE', KEYS[4], ARGV[2])
redis.call('LPUSH', KEYS[tonumber(ARGV[4])], ARGV[3])
return 1
"""
POP = """
local first, second = KEYS[1], KEYS[2]
if ARGV[1] == 'normal' then first, second = second, first end
local id = redis.call('RPOPLPUSH', first, KEYS[3])
if id then return {id, first} end
id = redis.call('RPOPLPUSH', second, KEYS[3])
if id then return {id, second} end
return nil
"""
RECOVER = """
local id = redis.call('LINDEX', KEYS[1], 0)
if not id then return nil end
local key = ARGV[1] .. id
local status = redis.call('HGET', key, 'status')
local queued = 0
if status and status ~= 'done' and status ~= 'failed' then
    local target = KEYS[2]
    if redis.call('HGET', key, 'priority') == 'True' then target = KEYS[3] end
    redis.call('HSET', key, 'status', 'queued')
    if ARGV[2] == '1' then redis.call('DEL', key .. ':events') end
    redis.call('RPUSH', target, id)
    queued = 1
end
redis.call('LPOP', KEYS[1])
return {id, queued}
"""


def recover(redis: Redis, normal: str, processing: str, job_prefix: str,
            reset_events: bool = False) -> tuple[str, bool] | None:
    """Atomically recover one job, including priority routing and event reset.

    A lost connection before execution leaves it in processing; a lost response
    after execution leaves it queued. Retrying never strands or duplicates it.
    """
    result = redis.eval(RECOVER, 3, processing, normal, normal + ":priority", job_prefix, int(reset_events))
    return (result[0], bool(result[1])) if result else None


def submit(redis: Redis, normal: str, processing: str, key: str,
           fields: dict, max_pending: int, ttl_s: int, priority: bool) -> bool:
    flat = [v for pair in fields.items() for v in pair]
    return bool(redis.eval(SUBMIT, 4, normal, normal + ":priority", processing, key,
                           max_pending, ttl_s, fields["id"], 2 if priority else 1, *flat))


def pending(redis: Redis, normal: str, processing: str) -> int:
    return sum(redis.llen(k) for k in (normal, normal + ":priority", processing))


def position(redis: Redis, normal: str, processing: str, job) -> int | None:
    if job.status != "queued":
        return None
    key = normal + ":priority" if job.priority else normal
    index = redis.lpos(key, job.id)
    if index is None:
        return None
    # Estimated position: the scheduler gives normal jobs a turn after 3 priority jobs.
    ahead = redis.llen(key) - index - 1
    other = redis.llen(normal if job.priority else normal + ":priority")
    return ahead + min(other, ahead // 3 if job.priority else 3 * (ahead + 1)) + redis.llen(processing) + 1


class WorkerLock:
    def __init__(self, jobs_root: Path):
        jobs_root.mkdir(parents=True, exist_ok=True)
        self._file = (jobs_root.parent / f".{jobs_root.name}.worker.lock").open("a")
        try:
            fcntl.flock(self._file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self._file.close()
            raise RuntimeError(f"A worker already owns {jobs_root}; disable embedded workers on API replicas.") from None

    def release(self):
        self._file.close()
