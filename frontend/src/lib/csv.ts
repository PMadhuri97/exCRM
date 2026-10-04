/**
 * CSV export — no domain knowledge, just rows of strings to a file.
 *
 * Every cell is quoted, and a cell that a spreadsheet would read as a formula
 * (`=`, `+`, `-`, `@`, tab or carriage return first) is prefixed with `'`.
 * Company and buyer names are free text typed by people outside the firm, so an
 * export that opens in Excel must not run whatever they typed.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  // CRLF, as RFC 4180 has it — Excel on Windows is the likeliest reader.
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Hand the browser a CSV file to save. A leading byte-order mark makes Excel
 * read the file as UTF-8, so names with accents survive the round trip. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
