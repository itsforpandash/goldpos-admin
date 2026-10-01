import { BackupService } from "@/lib/services/backup";

export async function POST({ locals, request }: any) {
  const env = locals?.runtime?.env || process.env;
  const DB = env?.DB;

  if (!DB) {
    return Response.json({ success: false, message: "Database binding unavailable" }, { status: 500 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    let backupData: any;
    let mode: "merge" | "replace" = "merge";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("backup_file") as File;
      mode = (formData.get("mode") as "merge" | "replace") || "merge";

      if (!file) {
        return Response.json({ success: false, message: "فایل بکاپ انتخاب نشده است" }, { status: 400 });
      }
      const text = await file.text();
      backupData = JSON.parse(text);
    } else {
      const json = await request.json();
      backupData = json.backup || json;
      mode = json.mode || "merge";
    }

    if (!backupData || typeof backupData !== "object") {
      return Response.json({ success: false, message: "فرمت داده‌های بکاپ نامعتبر است" }, { status: 400 });
    }

    const backupService = new BackupService(DB);
    const result = await backupService.importData(backupData, mode);

    return Response.json({
      success: result.success,
      message: result.success
        ? "اطلاعات با موفقیت بازیابی شد"
        : "برخی خطاها در هنگام بازیابی رخ داد",
      imported: result.imported,
      errors: result.errors,
    });
  } catch (error: any) {
    return Response.json(
      { success: false, message: error?.message || "خطا در پردازش فایل پشتیبان" },
      { status: 500 },
    );
  }
}
