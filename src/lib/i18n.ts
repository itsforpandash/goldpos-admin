// Persian (Jalali) date utilities — dependency-free implementation

const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const PERSIAN_MONTHS_SHORT = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

export function toPersianDigits(value: string | number): string {
  const str = String(value ?? "");
  const digits = "۰۱۲۳۴۵۶۷۸۹";
  return str.replace(/[0-9]/g, (d) => digits[parseInt(d, 10)]);
}

export function gregorianToJalali(date: Date): { year: number; month: number; day: number } {
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1;
  const gd = date.getDate();

  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  let gyAdj = gy - (gy <= 1600 ? 621 : 1600);
  const gy2 = gm > 2 ? gyAdj + 1 : gyAdj;
  let days = 365 * gyAdj + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = (days < 186 ? days % 31 : (days - 186) % 30) + 1;

  return { year: jy + (gy <= 1600 ? 621 : 1600), month: jm, day: jd };
}

export function formatPersianDate(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "—";
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return "—";
    const j = gregorianToJalali(date);
    return `${toPersianDigits(j.year)}/${toPersianDigits(String(j.month).padStart(2, "0"))}/${toPersianDigits(String(j.day).padStart(2, "0"))}`;
  } catch {
    return "—";
  }
}

export function formatPersianRelative(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "—";
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return "—";

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "همین حالا";
    if (diffMin < 60) return `${toPersianDigits(diffMin)} دقیقه پیش`;
    if (diffHours < 24) return `${toPersianDigits(diffHours)} ساعت پیش`;
    if (diffDays === 1) return "دیروز";
    if (diffDays < 30) return `${toPersianDigits(diffDays)} روز پیش`;
    return formatPersianDate(date);
  } catch {
    return "—";
  }
}

export function formatPersianTime(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "—";
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return "—";
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return toPersianDigits(`${h}:${m}`);
  } catch {
    return "—";
  }
}
