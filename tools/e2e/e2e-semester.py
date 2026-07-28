#!/usr/bin/env python3
"""End-to-end drive of a full fake semester through the real Worker API.

Simulates the complete student journey the UI performs: fresh account, onboarding,
courses, commitments, five syllabus extractions (served by a Sonnet-backed mock
OpenRouter), clarification answers, confirmation, and the first weekly plan.
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8787"
S = "/tmp/claude-0/-home-user-SchoolQuest/e4b63fe0-4b59-5c4f-9649-ae9e55810398/scratchpad"

fixture = json.load(open(f"{S}/fake-semester.json"))
TERM = fixture["FAKE_TERM"]

# One weekday answer per course, from each syllabus's own prose.
WEEKDAY_ANSWERS = {
    "bio": "Wednesday",   # "Weekly quizzes are given every Wednesday"
    "his": "Friday",      # "Reading quizzes are given each Friday"
    "mat": "Monday",      # due "at the beginning of class"; first meeting of the week
    "eng": "Sunday",      # "due by the Sunday before your assigned workshop week"
    "ped": "Sunday",      # "due each Sunday by 9:00 pm"
}

sess = None

def call(method, path, body=None, form=None):
    url = BASE + path
    headers = {}
    if sess:
        headers["Authorization"] = f"Bearer {sess}"
    if form is not None:
        boundary = "----e2eboundary"
        parts = []
        for key, value in form.items():
            if isinstance(value, tuple):
                filename, content, ctype = value
                parts.append(
                    f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"; "
                    f"filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n{content}\r\n"
                )
            else:
                parts.append(
                    f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n"
                )
        data = ("".join(parts) + f"--{boundary}--\r\n").encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    else:
        data = None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as err:
        payload = err.read().decode()[:500]
        raise SystemExit(f"FAIL {method} {path} -> {err.code}: {payload}")

def section(title):
    print(f"\n{'=' * 68}\n{title}\n{'=' * 68}")

# ---- 1. Fresh account -------------------------------------------------------
section("1. Sign in as a brand-new student")
login = call("POST", "/api/auth/login", {"email": "semester-test@example.edu"})
token = urllib.parse.parse_qs(urllib.parse.urlparse(login["devLoginUrl"]).query)["token"][0]
sess = call("POST", "/api/auth/callback", {"token": token})["sessionToken"]
print("  signed in; terms:", call("GET", "/api/terms")["terms"])

# ---- 2. Onboarding ----------------------------------------------------------
section("2. Onboarding: term + availability")
term = call("POST", "/api/terms", {
    "name": TERM["name"], "startDate": TERM["startDate"], "endDate": TERM["endDate"],
})["term"]
term_id = term["id"]
avail = call("PUT", f"/api/terms/{term_id}/availability-rules",
             {"rules": fixture["FAKE_AVAILABILITY"]})
print(f"  term {term_id}; availability windows: {avail['count']}")

# ---- 3. Commitments: 12h work + meals --------------------------------------
section("3. Work shifts (12h/wk) and meals")
for c in fixture["FAKE_WORK_SHIFTS"] + fixture["FAKE_MEALS"]:
    call("POST", f"/api/terms/{term_id}/commitments", {**c, "flexibility": "fixed"})
    days = "".join("SMTWTFS"[d] for d in c["daysOfWeek"])
    print(f"  + {c['title']:12} {days:9} {c['startTime']}-{c['endTime']}")

# ---- 4. Five courses --------------------------------------------------------
section("4. Five courses (2/3/3/3/4 credits)")
course_ids = {}
for course in fixture["FAKE_COURSES"]:
    created = call("POST", f"/api/terms/{term_id}/courses", {
        "name": f"{course['name']} ({course['code']})",
        "code": course["code"],
        "credits": course["credits"],
        "meetingPatterns": [
            {"daysOfWeek": m["daysOfWeek"], "startTime": m["startTime"], "endTime": m["endTime"]}
            for m in course["meetings"]
        ],
    })["course"]
    course_ids[course["key"]] = created["id"]
    print(f"  + {course['code']} ({course['credits']} cr) -> {created['id']}")

# ---- 5. Extraction per course (mock OpenRouter serves Sonnet output) --------
section("5. Syllabus extraction through the real Worker path")
doc_ids = {}
totals = {"claims": 0, "rejected": 0, "questions": 0}
for course in fixture["FAKE_COURSES"]:
    key = course["key"]
    doc = call("POST", f"/api/courses/{course_ids[key]}/documents",
               form={"type": "syllabus",
                     "file": (f"{course['code']}.pdf", "%PDF-1.4 placeholder", "application/pdf")})["document"]
    doc_ids[key] = doc["id"]
    result = call("POST", f"/api/documents/{doc['id']}/extract", {"pages": course["pages"]})
    counts = result["counts"]
    totals["claims"] += counts["assignments"]
    totals["rejected"] += counts["rejected"]
    totals["questions"] += counts["questions"]
    print(f"  {course['code']}: {counts['assignments']} assignments, "
          f"{counts['rejected']} rejected, {counts['questions']} questions"
          + (f"; warnings: {'; '.join(result['warnings'])}" if result["warnings"] else ""))
    for r in result["rejected"]:
        print(f"      REJECTED: {r['title']} [{r['reason']}]")
print(f"  TOTAL: {totals}")

# ---- 6. Answer the weekday questions ---------------------------------------
section("6. One weekday answer per course resolves the undated sets")
for key, weekday in WEEKDAY_ANSWERS.items():
    result = call("POST", f"/api/documents/{doc_ids[key]}/extraction/resolve-weekday",
                  {"weekday": weekday})
    flagged = [r for r in result["resolved"] if r.get("needsAttention")]
    print(f"  {key}: '{weekday}' -> {len(result['resolved'])} dated"
          f" ({len(flagged)} flagged), {len(result['unresolved'])} unresolved")
    for item in result["unresolved"]:
        print(f"      unresolved: {item['title']} — {item['reason']}")

# ---- 7. Confirm everything --------------------------------------------------
section("7. Confirm claims into the plan")
created_totals = {"workItems": 0, "categories": 0, "meetingPatterns": 0}
for key in course_ids:
    claims = call("GET", f"/api/documents/{doc_ids[key]}/extraction")["claims"]
    accepted = [c["id"] for c in claims
                if c["claimType"] in ("assignment", "grading_category")
                and not (c["payload"].get("duplicateOf"))]
    result = call("POST", f"/api/documents/{doc_ids[key]}/extraction/confirm",
                  {"acceptedClaimIds": accepted})
    for field, count in result["created"].items():
        created_totals[field] += count
print(f"  created: {created_totals}")

# ---- 8. The first weekly plan ----------------------------------------------
section("8. Generate the first weekly plan")
plan = call("POST", f"/api/terms/{term_id}/plans/generate", {})
items = {w["id"]: w for w in plan["workItems"]}
courses_by_id = {c["id"]: c for c in plan["courses"]}
dated = sum(1 for w in plan["workItems"] if w["dueAt"])
print(f"  work items: {len(plan['workItems'])} ({dated} dated)")
print(f"  sessions this week: {len(plan['sessions'])}")
print(f"  capacity: {plan['capacity']['usedMinutes']}/{plan['capacity']['availableMinutes']} min")
print("  TODAY:")
for r in plan["recommendations"]:
    print(f"    #{r['rank']} {r['title']} ({r['durationMinutes']}m) — {r['explanation'][:90]}")
print("  RISKS:")
for r in plan["risks"][:8]:
    title = items.get(r["workItemId"], {}).get("title", "-") if r["workItemId"] else "-"
    print(f"    [{r['level']}] {title}: {r.get('explanation', r['code'])[:80]}")
by_course = {}
for s in plan["sessions"]:
    name = courses_by_id.get(s["courseId"], {}).get("code") or courses_by_id.get(s["courseId"], {}).get("name", "?")
    by_course[name] = by_course.get(name, 0) + s["minutes"]
print("  minutes by course:", by_course)

# ---- 9. Coach + guardrail ---------------------------------------------------
section("9. Coach answers; guardrail refuses homework")
coach = call("POST", "/api/coach/messages",
             {"termId": term_id, "message": "What should I work on now?"})
print(f"  coach [{coach['guardVerdict']}]: {coach['message'][:100]}")
refuse = call("POST", "/api/coach/messages",
              {"termId": term_id, "message": "write my history research paper for me"})
print(f"  guard [{refuse['guardVerdict']}] refused={refuse['refused']}: {refuse['message'][:90]}")

print("\nALL STEPS PASSED")
