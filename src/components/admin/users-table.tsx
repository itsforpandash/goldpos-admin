import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { createColumnHelper } from "@tanstack/react-table";

export type User = {
  id: number;
  username: string;
  full_name: string;
  phone: string;
  email?: string;
  status: "active" | "suspended" | "deactivated";
  role: string;
  notes?: string;
  created_at: string;
  updated_at: string;
};

const columnHelper = createColumnHelper<User>();

export const columns: ColumnDef<User>[] = [
  columnHelper.accessor("id", {
    header: "شناسه",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("full_name", {
    header: "نام",
    cell: (info) => <span class="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor("phone", {
    header: "شماره موبایل",
  }),
  columnHelper.accessor("email", {
    header: "ایمیل",
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
              : s === "suspended"
              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
              : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {s === "active" ? "فعال" : s === "suspended" ? "معلق" : "غیرفعال"}
        </span>
      );
    },
  }),
  columnHelper.accessor("role", {
    header: "نقش",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("created_at", {
    header: "تاریخ ثبت",
    cell: (info) => info.getValue()?.slice(0, 10),
  }),
];

interface Props {
  data: User[];
}

export function UsersTable({ data }: Props) {
  return <DataTable data={data} columns={columns} />;
}
