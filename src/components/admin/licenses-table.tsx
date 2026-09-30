import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { createColumnHelper } from "@tanstack/react-table";
import { toPersianDigits, formatPersianDate } from "@/lib/i18n";

export type License = {
  id: number;
  code: string;
  user_id: number;
  plan_id: number;
  plan_name?: string;
  status: "unused" | "active" | "expired" | "revoked";
  max_devices: number;
  activated_at?: string;
  expires_at: string;
  revoked_at?: string;
  created_at: string;
  active_device_count?: number;
};

const columnHelper = createColumnHelper<License>();

export const licenseColumns: ColumnDef<License>[] = [
  columnHelper.accessor("code", {
    header: "کد لایسنس",
    cell: (info) => (
      <span class="font-mono text-xs bg-muted px-2 py-1 rounded">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor("plan_name", {
    header: "پلن",
  }),
  columnHelper.accessor("status", {
    header: "وضعیت",
    cell: (info) => {
      const s = info.getValue();
      return (
        <span
          class={`px-2 py-1 rounded-full text-xs ${
            s === "active"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : s === "unused"
              ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
              : s === "expired"
              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
              : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {s === "active" ? "فعال" : s === "unused" ? "استفاده نشده" : s === "expired" ? "منقضی" : "لغو شده"}
        </span>
      );
    },
  }),
  columnHelper.accessor("active_device_count", {
    header: "دستگاه",
    cell: (info) => `${toPersianDigits(info.getValue() ?? 0)}/${toPersianDigits(info.row.original.max_devices)}`,
  }),
  columnHelper.accessor("expires_at", {
    header: "انقضا",
    cell: (info) => formatPersianDate(info.getValue()),
  }),
  columnHelper.accessor("created_at", {
    header: "ایجاد",
    cell: (info) => formatPersianDate(info.getValue()),
  }),
];

interface Props {
  data: License[];
}

export function LicensesTable({ data }: Props) {
  return <DataTable data={data} columns={licenseColumns} />;
}
