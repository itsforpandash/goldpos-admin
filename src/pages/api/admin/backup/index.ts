import { BackupService } from "@/lib/services/backup";

export async function GET({ locals }: any) {
  const env = locals?.runtime?.env || process.env;
  const DB = env?.DB;

  if (!DB) {
    return Response.json({ success: false, message: "Database binding unavailable" }, { status: 500 });
  }

  const backupService = new BackupService(DB);
  const data = await backupService.exportAll();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `goldpos-backup-${timestamp}.json`;

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
