import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { createColumnHelper } from "@tanstack/react-table";
import { toPersianDigits, formatPersianDate, formatPersianTime } from "@/lib/i18n";

export type Device = {
  id: number;
  device_hash: string;
  license_id: number;
  user_id: number;
  license_code?: string;
  user_name?: string;
  plan_name?: string;
  device_model?: string;
  android_version?: string;
  app_version?: string;
  status: "active" | "inactive" | "blocked";
  first_activated_at?: string;
  last_connected_at?: string;
  created_at: string;
};

const columnHelper = createColumnHelper<Device>();

export const deviceColumns: ColumnDef<Device>[] = [
  columnHelper.accessor("device_hash", {
    header: "شناسه دستگاه",
    cell: (info) => (
      <span class="font-mono text-xs bg-muted px-2 py-1 rounded max-w-[120px] truncate block">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor("user_name", {
    header: "کاربر",
  }),
  columnHelper.accessor("license_code", {
    header: "لایسنس",
    cell: (info) => (
      <span class="font-mono text-xs bg-muted px-2 py-1 rounded">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor("device_model", {
    header: "مدل دستگاه",
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("android_version", {
    header: "اندروید",
    cell: (info) => info.getValue() || "—",
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
              : s === "blocked"
              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
              : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {s === "active" ? "فعال" : s === "blocked" ? "مسدود" : "غیرفعال"}
        </span>
      );
    },
  }),
  columnHelper.accessor("last_connected_at", {
    header: "آخرین اتصال",
    cell: (info) => info.getValue() ? formatPersianDate(info.getValue()) : "—",
  }),
];

interface Props {
  data: Device[];
}

export function DevicesTable({ data }: Props) {
  return <DataTable data={data} columns={deviceColumns} />;
}
