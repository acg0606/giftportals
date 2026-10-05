# GiftPortals 10.3.2 — creator reentry

After creating a gift, returning home and choosing **Make a gift** restored the
finished job's progress screen. A second **Start a different gift** action was
required before the photo wizard appeared.

The creator now checks the saved job reference and starts at the photo step when
the server confirms a delivered, terminal gift. It reports that gift to the
collection before removing only its creator recovery reference. Opening and
sharing the existing gift still use the collection's saved capability.

Unfinished generation, unfinished uploads, failed jobs without a usable gift,
uncertain submissions, and unconfirmed world retries retain their recovery
flow. A new job finishing in the current creator keeps its result visible until
the user opens it. An explicit world retry uses a separate return intent so its
result can still be inspected if the retry completes before the creator opens.

Verification includes restored completed and partial gifts, active world retries,
pending submissions, upload recovery, failed jobs, transient status failures,
explicit retry returns, and completion in the current session. Browser checks
use an injected local service and the actual creator component without creating
another provider generation.

All 1,005 tests passed, including eight new creator regressions. Frontend and
server TypeScript checks passed. In the mobile browser fixture, a completed gift
opened the photo wizard and remained in the real scoped collection; a processing
gift resumed its progress, completed in place, then opened a fresh wizard on the
next entry. The explicit retry return kept its completed result visible. All
these checks made zero generation or world-retry requests.
