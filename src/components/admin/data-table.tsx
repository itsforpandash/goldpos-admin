import type { ColumnDef, Table as TTable } from "@tanstack/react-table";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

interface Props<TData, TValue> {
  data: TData[];
  columns: ColumnDef<TData, TValue>[];
}

export function DataTable<TData, TValue>({ data, columns }: Props<TData, TValue>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div class="rounded-md border border-border overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} class="px-4 py-3 text-right font-medium text-muted-foreground">
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} class="border-t border-border hover:bg-muted/30 transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} class="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} class="h-24 text-center text-muted-foreground">
                موردی یافت نشد
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
