# Integration tests

| File | What it checks |
|---|---|
| `test_offline_sync.py` | Offline attendance: sync of stored captures, idempotency, one-time liveness challenges, clock drift, scope (other school, deputy, teacher), the principal's review queue (preview, accept, reject), deletion of frames. 38 checks. |
| `fake_face_service.py` | Stand-in for the Python face service so the tests need no camera. |

The 51 unit tests of the algorithms are separate: `cd backend && npm test`.
The liveness decision of the face service has its own 10 unit tests: `face-service/.venv/Scripts/python -m unittest face-service/test_liveness.py`.
