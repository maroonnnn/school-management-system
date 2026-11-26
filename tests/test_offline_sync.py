"""
Offline attendance (ATT-21): sync, replay protection, clock drift, scope and the principal's review queue.
38 checks against the running backend + database. There is no camera in a test, so the face service is replaced by
tests/fake_face_service.py (it answers from a label inside the frame text).

Run (backend on :5000, database loaded with database/rebuild.ps1, nothing else on :8001):
    python tests/fake_face_service.py &          # the stand-in face service
    python tests/test_offline_sync.py
Re-run after rebuilding the database (the review queue counts assume a clean start).
"""
import json, urllib.request, subprocess, os, time, uuid, base64, hmac, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
from datetime import datetime, timedelta, timezone
B = "http://localhost:5000/api"
PSQL = os.environ.get("PSQL", r"C:/Program Files/PostgreSQL/18/bin/psql")
os.environ["PGPASSWORD"] = "postgres"
os.environ["PGCLIENTENCODING"] = "UTF8"


def sql(q):
    return subprocess.run([PSQL, "-U", "postgres", "-d", "school_pilot", "-tAc", q], capture_output=True, text=True, encoding="utf-8").stdout.strip()


def call(m, p, tok=None, body=None):
    r = urllib.request.Request(B + p, method=m, data=json.dumps(body).encode() if body is not None else None,
                               headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + tok} if tok else {})})
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def login(u):
    return call("POST", "/auth/login", body={"username": u, "password": "Test@1234"})[1]["data"]["token"]


ok = bad = 0


def check(n, c, x=""):
    global ok, bad
    if c:
        ok += 1
        print("PASS", n)
    else:
        bad += 1
        print("FAIL", n, x)


iso = lambda d: d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
now = datetime.now(timezone.utc)
P = login("principal1"); P2 = login("principal2"); D = login("deputy1"); T = login("t1006")
frames = lambda label: [label] * 11
secret = [l.split("=", 1)[1].strip() for l in open(ROOT / "backend" / ".env", encoding="utf-8") if l.startswith("JWT_SECRET=")][0]


def make_token(school, iat_ago_h, ttl_h=72, uid=1):
    """A signed challenge issued iat_ago_h hours ago (a pool fetched before the outage)."""
    e = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=").decode()
    t = int(time.time())
    h = e({"alg": "HS256", "typ": "JWT"}); b = e({"purpose": "face", "challenge": ["RIGHT", "LEFT"], "uid": uid, "schoolId": school, "n": str(uuid.uuid4()), "iat": t - int(iat_ago_h * 3600), "exp": t - int(iat_ago_h * 3600) + ttl_h * 3600})
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{h}.{b}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return {"token": f"{h}.{b}.{sig}"}

eas = [l.split("|") for l in sql("select ea.id, e.full_name from employee_assignments ea join employees e on e.id=ea.employee_id where ea.school_id=1 and ea.is_active and ea.position_type='TEACHER' order by ea.id limit 2").splitlines()]
EA_A, EA_B = eas[0][0], eas[1][0]
sql(f"delete from face_embeddings where employee_id in (select employee_id from employee_assignments where id in ({EA_A},{EA_B}))")

s, r = call("GET", "/face/challenge", P); ch = r["data"]
check("challenge is a 2-step opposite sequence", len(ch["challenge"]) == 2 and ch["challenge"][0] != ch["challenge"][1] and ch["layout"] == [3, 4, 4], ch)
for ea, label in ((EA_A, "EMP:A"), (EA_B, "EMP:B")):
    s, r = call("GET", "/face/challenge", P)
    s, r2 = call("POST", "/face/enroll", P, {"employeeAssignmentId": int(ea), "frames": frames(label), "challengeToken": r["data"]["token"]})
    check(f"enrol {label}", s == 200, r2)
s, r = call("POST", "/face/enroll", P, {"employeeAssignmentId": int(EA_A), "frames": ["EMP:A"] * 5, "challengeToken": call("GET", "/face/challenge", P)[1]["data"]["token"]})
check("wrong frame count rejected", s == 400, r)

s, r = call("GET", "/face/challenges?count=12", P); pool = r["data"]
check("pool of signed challenges", s == 200 and len(pool) == 12 and len({c["token"] for c in pool}) == 12)
s, _ = call("GET", "/face/challenges", T); check("teacher cannot fetch the pool", s == 403)


def cap(label, when, tok, cid=None):
    return {"clientEventId": cid or str(uuid.uuid4()), "capturedAt": iso(when), "challengeToken": tok["token"], "frames": frames(label)}


def sync(user, caps, device_now=None):
    return call("POST", "/face/sync", user, {"deviceNow": iso(device_now or datetime.now(timezone.utc)), "captures": caps})


old = lambda: make_token(1, 6)
c1 = cap("EMP:A", now - timedelta(hours=3), pool[0]); s, r = sync(P, [c1]); check("capture BEFORE its challenge was issued is flagged", r["data"]["results"][0]["reason"] == "CHALLENGE_WINDOW", r)
c1 = cap("EMP:A", now - timedelta(hours=3), old()); s, r = sync(P, [c1]); res = r["data"]["results"][0]
check("matching capture accepted as IN", s == 200 and res["status"] == "ACCEPTED" and res["eventType"] == "IN", r)
row = sql(f"select event_type, verification_method, device_label, round(extract(epoch from (now()-event_time))/3600) from attendance_events where client_event_id='{c1['clientEventId']}'")
check("event keeps the ORIGINAL capture time (3 h ago)", row.startswith("IN|FACE|kiosk-offline:user") and row.endswith("|3"), row)
s, r = sync(P, [c1])
check("same capture again = duplicate, no new event", r["data"]["results"][0].get("duplicate") and sql(f"select count(*) from attendance_events where client_event_id='{c1['clientEventId']}'") == "1", r)
c2 = cap("EMP:A", now - timedelta(hours=2), {"token": c1["challengeToken"]}); s, r = sync(P, [c2])
check("challenge reuse rejected", r["data"]["results"][0]["reason"] == "CHALLENGE_REUSED", r)
ca = cap("EMP:B", now - timedelta(hours=5), old()); cb = cap("EMP:B", now - timedelta(hours=4), old())
s, r = sync(P, [cb, ca]); types = [x["eventType"] for x in r["data"]["results"]]
check("batch ordered by capture time: IN then OUT", types == ["IN", "OUT"], r)
s, rr = call("GET", "/face/challenges?count=1", P2); other = rr["data"][0]
s, r = sync(P, [cap("EMP:A", now - timedelta(hours=1), other)])
check("token of another school rejected", r["data"]["results"][0]["reason"] == "BAD_CHALLENGE", r)
bad_tok = {"token": old()["token"][:-3] + "abc"}
s, r = sync(P, [cap("EMP:A", now - timedelta(hours=1), bad_tok)])
check("tampered token rejected", r["data"]["results"][0]["reason"] == "BAD_CHALLENGE", r)
cn = cap("NOFACE", now - timedelta(hours=1), old()); s, r = sync(P, [cn])
check("no face -> needs review", r["data"]["results"][0]["status"] == "NEEDS_REVIEW" and r["data"]["results"][0]["reason"] == "NO_FACE", r)
cu = cap("EMP:ZZZ", now - timedelta(hours=1), old()); s, r = sync(P, [cu])
check("unknown face -> needs review (NO_MATCH)", r["data"]["results"][0]["reason"] == "NO_MATCH", r)
cw = cap("WRONGDIR", now - timedelta(hours=1), old()); s, r = sync(P, [cw])
check("wrong direction -> needs review", r["data"]["results"][0]["reason"] == "WRONG_DIRECTION", r)
cd = cap("EMP:A", now - timedelta(hours=1), old()); s, r = sync(P, [cd], device_now=now - timedelta(hours=1)); res = r["data"]["results"][0]
check("device clock 1 h off -> needs review (CLOCK_DRIFT)", res["status"] == "NEEDS_REVIEW" and res["reason"] == "CLOCK_DRIFT", r)
cold = cap("EMP:A", now - timedelta(days=10), make_token(1, 11 * 24, ttl_h=72)); s, r = sync(P, [cold])
check("10-day-old capture is not auto-accepted (TOO_OLD)", r["data"]["results"][0]["status"] == "NEEDS_REVIEW", r)
s, r = call("GET", "/face/offline/review", P); q = r["data"]
check("review queue lists 6 captures", s == 200 and len(q) == 6, [x["reason"] for x in q])
drift = [x for x in q if x["reason"] == "CLOCK_DRIFT"][0]
check("drift capture carries the suggested employee", drift["suggested_name"] is not None, drift)
s, _ = call("GET", "/face/offline/review", D); check("deputy cannot see the queue", s == 403)
s, r2 = call("GET", "/face/offline/review", P2); check("principal of another school sees nothing of ours", s == 200 and r2["data"] == [])
s, r = call("GET", f"/face/offline/{drift['id']}/preview", P); check("principal previews the frontal frame", s == 200 and r["data"]["image"] == "EMP:A", r)
check("preview is audited", sql("select count(*) from audit_logs where action='FACE_CAPTURE_VIEW'") != "0")
s, _ = call("GET", f"/face/offline/{drift['id']}/preview", P2); check("other school cannot preview", s == 404)
s, _ = call("POST", f"/face/offline/{drift['id']}/resolve", P2, {"action": "REJECT", "reason": "x"}); check("other school cannot resolve", s == 404)
s, _ = call("POST", f"/face/offline/{drift['id']}/resolve", P, {"action": "ACCEPT", "employeeAssignmentId": int(EA_A)}); check("resolve needs a reason", s == 400)
s, r = call("POST", f"/face/offline/{drift['id']}/resolve", P, {"action": "ACCEPT", "employeeAssignmentId": int(EA_A), "reason": "late clock"})
check("accept -> manual event", s == 200 and r["data"]["status"] == "RESOLVED", r)
ev = sql(f"select verification_method, recorded_by is not null, manual_reason from attendance_events where employee_assignment_id={EA_A} and device_label='offline-review'")
check("event recorded as MANUAL with the reason", ev.startswith("MANUAL|t|") and "late clock" in ev, ev)
check("frames deleted after the decision", sql(f"select frames_enc is null from offline_captures where id={drift['id']}") == "t")
oth = [x for x in q if x["reason"] == "NO_MATCH"][0]
s, r = call("POST", f"/face/offline/{oth['id']}/resolve", P, {"action": "REJECT", "reason": "stranger"})
check("reject deletes the capture", s == 200 and sql(f"select status from offline_captures where id={oth['id']}") == "REJECTED" and sql(f"select frames_enc is null from offline_captures where id={oth['id']}") == "t", r)
check("queue shrank to 4", len(call("GET", "/face/offline/review", P)[1]["data"]) == 4)
s, _ = sync(T, [c1]); check("teacher cannot sync", s == 403)
s, r = call("POST", "/face/sync", P, {"deviceNow": "bad", "captures": [c1]}); check("bad device time rejected", s == 400)
s, r = call("POST", "/face/sync", P, {"deviceNow": iso(now), "captures": []}); check("empty batch rejected", s == 400)
s, r = sync(P, [{"clientEventId": "not-a-uuid", "capturedAt": iso(now), "challengeToken": "x", "frames": []}])
check("invalid capture id rejected per item", r["data"]["results"][0]["reason"] == "BAD_REQUEST", r)
s, r = call("GET", "/dashboard/summary", P)
check("principal dashboard shows the review count", any(a["key"] == "offline_review" and a["count"] == 4 for a in r["data"]["attention"]), r["data"].get("attention"))
print(ok, "passed", bad, "failed")
