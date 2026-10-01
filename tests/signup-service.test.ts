// @ts-nocheck -- test harness: needs node:sqlite (no @types/node installed) and a
// structurally-typed D1 shim. Excluded from the project type gate on purpose.
// End-to-end exercise of the REAL SignupService + admin action logic against a
// copy of the throwaway D1 database, using a minimal D1 shim over node:sqlite.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { SignupService, SignupError } from "../src/lib/services/signup.ts";

// Build a FRESH database from the project's real migration files so this test
// never depends on a miniflare WAL snapshot.
const MIGRATIONS = "/home/bozorg/projects/goldpos-admin/migrations";
const DST = "/home/bozorg/.hermes/cache/scratch/signup-verify/service-test.sqlite";
for (const suffix of ["", "-wal", "-shm"]) rmSync(DST + suffix, { force: true });

const db = new DatabaseSync(DST);
db.exec("PRAGMA foreign_keys = ON;");
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  db.exec(readFileSync(`${MIGRATIONS}/${file}`, "utf8"));
}

// Seed the one pre-existing customer the "already exists" case relies on.
db.exec(`INSERT INTO users (username, full_name, phone, password_hash, status, role)
         VALUES ('g09121111111', 'مشتری موجود', '09121111111', '', 'active', 'customer')`);

/** Minimal D1 shim: every method is available directly or after .bind(). */
function makeStmt(sql) {
  const stmt = db.prepare(sql);
  let args = [];
  const api = {
    bind(...a) { args = a.map((x) => (x === undefined ? null : x)); return api; },
    async run() {
      const info = stmt.run(...args);
      return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
    async all() { return { success: true, results: stmt.all(...args) }; },
    async first() { return stmt.get(...args) ?? null; },
  };
  return api;
}

const DB = { prepare: makeStmt };

const svc = new SignupService(DB);
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${extra ? " :: " + extra : ""}`);
};

const q = (sql, ...args) => db.prepare(sql).all(...args);

console.log("\n== A. public submit (create) ==");
const r1 = await svc.create({ contact: "09123334455", fullName: "کاربر تست", note: "پلن حرفه‌ای", ipAddress: "198.51.100.7" });
ok("create() returns id", r1.success && Number.isInteger(r1.id), `id=${r1.id}`);
const row1 = q("SELECT contact, contact_type, full_name, note, status, ip_address FROM signup_requests WHERE id = ?", r1.id)[0];
ok("stored contact is canonical +98 form", row1.contact === "+989123334455", row1.contact);
ok("contact_type inferred as phone", row1.contact_type === "phone");
ok("status defaults to pending", row1.status === "pending");
ok("ip_address stored", row1.ip_address === "198.51.100.7", row1.ip_address);

console.log("\n== B. duplicate guard (normalized spelling differs) ==");
let dupHit = false, dupMsg = "";
try { await svc.create({ contact: "+98 912 333 4455" }); } catch (e) { dupHit = e instanceof SignupError && e.code === "duplicate"; dupMsg = e.message; }
ok("second spelling rejected as duplicate", dupHit, dupMsg);
let dup2 = false;
try { await svc.create({ contact: "00989123334455" }); } catch (e) { dup2 = e.code === "duplicate"; }
ok("third spelling rejected as duplicate", dup2);

console.log("\n== C. validation errors are Persian + typed ==");
let c1 = { code: null };
try { await svc.create({ contact: "user@example" }); } catch (e) { c1 = { code: e.code, msg: e.message }; }
ok("bad email -> invalid_contact", c1.code === "invalid_contact", c1.msg);
ok("  message is Persian", /[؀-ۿ]/.test(c1.msg || ""));
let c2 = { code: null };
try { await svc.create({ contact: "0812345678" }); } catch (e) { c2 = { code: e.code, msg: e.message }; }
ok("landline -> invalid_contact", c2.code === "invalid_contact", c2.msg);
let c3 = { code: null };
try { await svc.create({ contact: "09121234567", note: "x".repeat(1001) }); } catch (e) { c3 = { code: e.code }; }
ok("over-long note -> rejected", c3.code === "note_too_long", c3.code);

console.log("\n== D. approve: phone applicant with NO existing user ==");
const before = q("SELECT COUNT(*) c FROM users")[0].c;
const licBefore = q("SELECT COUNT(*) c FROM licenses")[0].c;
const ap = await svc.approve({ id: r1.id, adminId: 1, planId: 1, userPhone: null });
ok("approve returns a license code", /^GPOS-/.test(ap.code), ap.code);
ok("created a users row", ap.userCreated === true);
ok("users row count +1", q("SELECT COUNT(*) c FROM users")[0].c === before + 1);
ok("license row created", q("SELECT COUNT(*) c FROM licenses")[0].c === licBefore + 1);
const signed = q("SELECT id, contact, contact_type, full_name, status, reviewed_at, reviewed_by, approved_license_id FROM signup_requests WHERE id = ?", r1.id)[0];
ok("status=approved", signed.status === "approved");
ok("reviewed_by populated", signed.reviewed_by === 1, String(signed.reviewed_by));
ok("reviewed_at populated", !!signed.reviewed_at, signed.reviewed_at);
ok("approved_license_id set", Number(signed.approved_license_id) > 0, String(signed.approved_license_id));
const newUserId = ap.userId;
const newUser = q("SELECT username, full_name, phone, email, password_hash, role, status FROM users WHERE id = ?", newUserId)[0];
ok("new user phone canonical national form", newUser.phone === "09123334455", newUser.phone);
ok("new user NOT NULL columns filled", newUser.username && newUser.full_name && newUser.phone);
ok("password_hash left empty (no invented password)", newUser.password_hash === "");
ok("role/status sane", newUser.role === "customer" && newUser.status === "active");
// ActivityService logging lives in the action route, exercised in section J.
const lic = q("SELECT code, user_id, plan_id, status, max_devices, expires_at FROM licenses WHERE id = ?", signed.approved_license_id)[0];
ok("license linked to the new user", lic.user_id === newUserId, `license.user_id=${lic.user_id}`);
ok("license code matches result", lic.code === ap.code);

console.log("\n== E. re-approve is refused ==");
let re = { code: null };
try { await svc.approve({ id: r1.id, adminId: 1, planId: 1 }); } catch (e) { re = { code: e.code, msg: e.message }; }
ok("already_reviewed", re.code === "already_reviewed", re.msg);
ok("no extra license issued", q("SELECT COUNT(*) c FROM licenses")[0].c === licBefore + 1);

console.log("\n== F. approve: email-only applicant with NO user -> must demand a phone ==");
const r2 = await svc.create({ contact: "nobody@example.com", fullName: "مشتری فقط ایمیل", planId: 2 });
let need = { code: null };
try { await svc.approve({ id: r2.id, adminId: 1, planId: 2, userPhone: null }); } catch (e) { need = { code: e.code, msg: e.message }; }
ok("refuses without a phone (never invents one)", need.code === "needs_phone", need.msg);
ok("  message is Persian", /[؀-ۿ]/.test(need.msg || ""));
ok("still pending after refusal", q("SELECT status FROM signup_requests WHERE id=?", r2.id)[0].status === "pending");
let badphone = { code: null };
try { await svc.approve({ id: r2.id, adminId: 1, planId: 2, userPhone: "0812345678" }); } catch (e) { badphone = { code: e.code, msg: e.message }; }
ok("invalid supplied phone refused", badphone.code === "phone_invalid", badphone.msg);

console.log("\n== G. approve: email-only applicant WITH a valid phone ==");
const usersBefore = q("SELECT COUNT(*) c FROM users")[0].c;
const ap2 = await svc.approve({ id: r2.id, adminId: 1, planId: 2, userPhone: "+98 912 555 6677" });
ok("approved", !!ap2.code, ap2.code);
ok("created exactly one user", ap2.userCreated === true && q("SELECT COUNT(*) c FROM users")[0].c === usersBefore + 1);
const u2 = q("SELECT phone, email FROM users WHERE id = ?", ap2.userId)[0];
ok("email stored on the created user", u2.email === "nobody@example.com", u2.email);
ok("phone normalized to national form", u2.phone === "09125556677", u2.phone);

console.log("\n== H. approve: applicant whose user ALREADY exists ==");
const r3 = await svc.create({ contact: "+989121111111", fullName: "کاربر موجود" });
const preCount = q("SELECT COUNT(*) c FROM users")[0].c;
const ap3 = await svc.approve({ id: r3.id, adminId: 1, planId: 1 });
ok("reused existing user (no new row)", ap3.userCreated === false && q("SELECT COUNT(*) c FROM users")[0].c === preCount);
ok("matched user is the seeded phone user", ap3.userId === 1, `userId=${ap3.userId}`);

console.log("\n== I. reject ==");
const r4 = await svc.create({ contact: "09127778899", fullName: "برای رد" });
await svc.reject(r4.id, 1);
const rr = q("SELECT status, reviewed_by, reviewed_at, approved_license_id FROM signup_requests WHERE id=?", r4.id)[0];
ok("rejected", rr.status === "rejected");
ok("reviewed_by set", rr.reviewed_by === 1);
ok("reviewed_at set", !!rr.reviewed_at, rr.reviewed_at);
ok("no license attached", rr.approved_license_id == null);
let rr2 = { code: null };
try { await svc.reject(r4.id, 1); } catch (e) { rr2 = { code: e.code }; }
ok("re-reject refused", rr2.code === "already_reviewed", rr2.code);
// logging of reviews is asserted via the real action route in section K

console.log("\n== J. pending-first ordering + filters ==");
const r5 = await svc.create({ contact: "09120001122", fullName: "در انتظار" });
const r6 = await svc.create({ contact: "09120003344", fullName: "نیز در انتظار" });
const list = await svc.getAll(null, null);
const firstNonPending = list.findIndex((x) => x.status !== "pending");
const lastPending = list.map((x) => x.status).lastIndexOf("pending");
ok("every pending row precedes every reviewed row", lastPending < firstNonPending,
   list.map((x) => x.status).join(","));
ok("both pending rows present", list.filter((x) => x.status === "pending").length === 2);
const filtered = await svc.getAll("rejected", null);
ok("status filter works", filtered.length > 0 && filtered.every((x) => x.status === "rejected"));
const searched = await svc.getAll(null, "nobody@");
ok("search over contact works", searched.length === 1 && searched[0].id === r2.id, JSON.stringify(searched.map(s=>s.id)));
const counts = await svc.getCounts();
ok("counts add up", counts.total === list.length && counts.pending + counts.approved + counts.rejected === counts.total, JSON.stringify(counts));

console.log("\n== K. real admin action route (303 + audit + code in the URL) ==");
const { POST } = await import("../src/pages/admin/signup/action.ts");

const makeRequest = (form) => {
  const fd = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) fd.set(k, String(v));
  return new Request("http://localhost/admin/signup/action", {
    method: "POST",
    body: fd,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "cf-connecting-ip": "198.51.100.22" },
  });
};
const adminCtx = (req) => ({
  request: req,
  locals: { runtime: { env: { DB } }, SESSION: { id: 1, username: "admin", full_name: "مدیر", role: "super_admin" } },
});

const approveRes = await POST(adminCtx(makeRequest({ id: r5.id, action: "approve", plan_id: 2 })));
const approveLoc = approveRes.headers.get("Location") || "";
ok("approve responds 303", approveRes.status === 303, String(approveRes.status));
ok("303 Location is /admin/signup", approveLoc.startsWith("/admin/signup?"), approveLoc);
const codeParam = new URLSearchParams(approveLoc.split("?")[1] || "").get("code") || "";
ok("license code is handed to the admin in the URL", /^GPOS-/.test(codeParam), codeParam);
ok("created flag present", new URLSearchParams(approveLoc.split("?")[1]).get("created") === "1");
const logged = q("SELECT actor_id, action, target_type, target_id, metadata, ip_address, result FROM audit_logs WHERE action='signup_approved' AND target_id=?", r5.id)[0];
ok("ActivityService logged signup_approved", !!logged);
ok("  actorId recorded", logged.actor_id === 1, String(logged.actor_id));
ok("  target type/id recorded", logged.target_type === "signup_request" && logged.target_id === r5.id);
ok("  metadata carries the code", (logged.metadata || "").includes(codeParam), logged.metadata);
ok("  ip recorded", logged.ip_address === "198.51.100.22", logged.ip_address);
ok("  result recorded", logged.result === "success");
ok("page row shows the code", !!q("SELECT license_code FROM (SELECT sr.id, licenses.code as license_code FROM signup_requests sr LEFT JOIN licenses ON sr.approved_license_id = licenses.id) WHERE id=?", r5.id)[0]?.license_code);

const rejectRes = await POST(adminCtx(makeRequest({ id: r6.id, action: "reject" })));
ok("reject responds 303", rejectRes.status === 303);
ok("reject Location carries ok=rejected", (rejectRes.headers.get("Location") || "").includes("ok=rejected"));
ok("ActivityService logged signup_rejected",
   q("SELECT COUNT(*) c FROM audit_logs WHERE action='signup_rejected' AND target_id=?", r6.id)[0].c >= 1);

const badRes = await POST(adminCtx(makeRequest({ id: 999999, action: "approve", plan_id: 1 })));
ok("unknown id -> err redirect", (badRes.headers.get("Location") || "").includes("err=not_found"),
   badRes.headers.get("Location") || "");
const unknownAction = await POST(adminCtx(makeRequest({ id: r6.id, action: "frobnicate" })));
ok("unknown action -> unknown_action", (unknownAction.headers.get("Location") || "").includes("err=unknown_action"));
const noSession = await POST({
  request: makeRequest({ id: r6.id, action: "reject" }),
  locals: { runtime: { env: { DB } }, SESSION: null },
});
ok("no session -> redirect to login", (noSession.headers.get("Location") || "") === "/admin/login");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} service test(s) failed`);
console.log("all service tests passed");
