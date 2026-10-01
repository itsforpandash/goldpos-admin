// Table-driven test of the pure signup validators.
// Run: node --experimental-strip-types tests/signup-validators.test.ts
import {
  normalizeContact,
  normalizeEmail,
  normalizePhone,
  phoneCandidateForms,
  validateSignupPayload,
  isSignupInputError,
} from "../src/lib/services/signup.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
  }
}

// ---------------------------------------------------------------- phone
const VALID_PHONES = [
  "09121234567",
  "+989121234567",
  "00989121234567",
  "0912 123 4567",
  "0912-123-4567",
  " 09121234567  ",
  "۰۹۱۲۱۲۳۴۵۶۷",
  "٠٩١٢١٢٣٤٥٦٧",
  "(0912) 123-4567",
];
const CANON = "+989121234567";

for (const raw of VALID_PHONES) {
  check(`phone normalize ${JSON.stringify(raw)}`, normalizePhone(raw), CANON);
  check(
    `contact type ${JSON.stringify(raw)}`,
    normalizeContact(raw),
    { ok: true, contact: CANON, contactType: "phone" },
  );
}

// All spellings must map to the same canonical contact -> same duplicate key.
const canonicals = new Set(VALID_PHONES.map((p) => normalizePhone(p)));
check("all valid phone spellings collapse to one canonical value", [...canonicals], [CANON]);

// +98 / 0098 / 09 forms collide as duplicates.
const spellings = ["+989121234567", "00989121234567", "09121234567"];
const seen = new Set(
  spellings.map((s) => {
    const res = normalizeContact(s) as { ok: boolean; contact?: string; message?: string };
    return res.ok ? res.contact! : `ERR:${res.message}`;
  }),
);
check("+98/0098/09 collide", seen.size, 1);
check("collided value is canonical", [...seen][0], CANON);

const INVALID_PHONES = [
  "9121234567",       // bare 10 digits: no operator/country prefix, deliberately rejected
  "989121234567",     // country code without "+" and without "00" — not in the accepted set
  "0812345678",       // landline prefix 08 — not a mobile
  "0912123456",       // too short
  "091212345678",     // too long
  "+14155552671",     // US number
  "0912123456a",
  "",
  "   ",
];
for (const raw of INVALID_PHONES) {
  check(`phone reject ${JSON.stringify(raw)}`, normalizePhone(raw), null);
}

// ---------------------------------------------------------------- email
const VALID_EMAILS = [
  ["Ali@Example.COM", "ali@example.com"],
  ["  name@example.com  ", "name@example.com"],
  ["first.last@example.co.uk", "first.last@example.co.uk"],
  ["shop+tag@sub.domain.ir", "shop+tag@sub.domain.ir"],
];
for (const [raw, expected] of VALID_EMAILS) {
  check(`email normalize ${JSON.stringify(raw)}`, normalizeEmail(raw), expected);
  check(
    `contact type email ${JSON.stringify(raw)}`,
    normalizeContact(raw),
    { ok: true, contact: expected, contactType: "email" },
  );
}

const INVALID_EMAILS = [
  "plainaddress",
  "@example.com",
  "user@",
  "user@example",        // no TLD
  "user@example.c",      // one-char TLD
  "user name@example.com",
  "user@@example.com",
  "user@-example.com",
  "user@exam_ple.com",
  `a${"x".repeat(70)}@example.com`, // local part over 64
];
for (const raw of INVALID_EMAILS) {
  check(`email reject ${JSON.stringify(raw)}`, normalizeEmail(raw), null);
}

// A value with "@" is judged only as an email — never silently accepted as a phone.
for (const raw of ["bad-email@", "not@an@email", "@09121234567"]) {
  const res = normalizeContact(raw) as any;
  check(`no phone coercion for ${JSON.stringify(raw)}`, res.ok, false);
  check(
    `email error message for ${JSON.stringify(raw)}`,
    res.message,
    "ایمیل واردشده معتبر نیست. نمونه درست: name@example.com",
  );
}

// A malformed email must produce the email error, not the generic one.
check(
  "malformed email yields email-specific message",
  (normalizeContact("user@example") as any).message,
  "ایمیل واردشده معتبر نیست. نمونه درست: name@example.com",
);
check(
  "malformed phone yields phone-specific message",
  (normalizeContact("0812345678") as any).message,
  "شماره موبایل معتبر نیست. نمونه درست: 09121234567 یا +989121234567",
);
check(
  "gibberish yields generic message",
  (normalizeContact("سلام") as any).message,
  "ورودی معتبر نیست. ایمیل (مثل name@example.com) یا شماره موبایل ایرانی (مثل 09121234567) وارد کنید.",
);
check("empty yields required message", (normalizeContact("") as any).message, "لطفاً ایمیل یا شماره موبایل خود را وارد کنید.");

// ------------------------------------------------------------ candidates
const forms = phoneCandidateForms(CANON);
for (const f of ["+989121234567", "989121234567", "00989121234567", "09121234567", "۰۹۱۲۱۲۳۴۵۶۷"]) {
  check(`user lookup covers ${f}`, forms.includes(f), true);
}
check("email contact produces no phone candidates", phoneCandidateForms("a@b.com"), ["a@b.com"]);

// ------------------------------------------------------------- payload
const good = validateSignupPayload({ contact: "09121234567", fullName: " علی ", note: " " });
check("payload returns validated", isSignupInputError(good), false);
check("payload name trimmed", (good as any).fullName, "علی");
check("payload empty note -> null", (good as any).note, null);
check("payload no plan -> null", (good as any).planId, null);
check("payload type", (good as any).contactType, "phone");

const goodEmail = validateSignupPayload({ contact: "Ali@Example.com", planId: 2 });
check("payload email plan", (goodEmail as any).planId, 2);

for (const bad of [
  { contact: "", fullName: "x" },
  { contact: "123", fullName: "x" },
  { contact: "09121234567", fullName: "x".repeat(121) },
  { contact: "09121234567", fullName: "x", note: "y".repeat(1001) },
  { contact: "09121234567", fullName: "x", planId: -3 },
]) {
  const res: any = validateSignupPayload(bad as any);
  check(`payload rejects ${JSON.stringify(bad).slice(0, 60)}`, isSignupInputError(res), true);
  check("payload error has Persian message", typeof res.message === "string" && /[؀-ۿ]/.test(res.message), true);
}

// ----------------------------------------------------------------- report
console.log(`\n${pass} passed, ${fail} failed`);
console.log("all validator tests passed");
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  ✗ " + f);
  throw new Error(`${fail} validator test(s) failed`);
}
