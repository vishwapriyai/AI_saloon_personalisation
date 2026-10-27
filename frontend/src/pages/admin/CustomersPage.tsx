import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, AlertTriangle, ShieldCheck, Phone, ArrowUp, ArrowDown, ArrowUpDown,
  ChevronLeft, ChevronRight, FileSpreadsheet, FileText, RefreshCw, X,
} from 'lucide-react';
import { getCustomers } from '../../api/client';

interface DirectoryCustomer {
  id: number;
  customer_code: string;
  full_name: string;
  segment_name: string;
  total_visits: number;
  total_spent: number;
  matched_by_phone?: boolean;
}

type SortKey = 'full_name' | 'segment_name' | 'total_visits' | 'total_spent' | 'risk';
type SortDir = 'asc' | 'desc';

// Churn risk shown from the customer's segment until the churn model is connected
const riskOf = (segment: string) => (/rare|at-risk|inactive/i.test(segment) ? 'HIGH' : 'LOW');
const PAGE_SIZES = [10, 25, 50, 100];
const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const SEGMENT_TONE = (s: string) =>
  /high|vip|premium/i.test(s) ? 'bg-[#fdf3d7] text-[#7a5a0c]'
    : /new/i.test(s) ? 'bg-[#e8f1f7] text-[#2f5f7f]'
      : /rare|risk|inactive/i.test(s) ? 'bg-rose-50 text-rose-700'
        : 'bg-[#eef3ee] text-[#4f6b5a]';

/** Page numbers with gaps, e.g. 1 … 4 5 6 … 12 */
function pageList(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => { if (i && p - sorted[i - 1] > 1) out.push('…'); out.push(p); });
  return out;
}

export const CustomersPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [customers, setCustomers] = useState<DirectoryCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('full_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  // Search runs on the server (name, mobile number or customer ID); phone numbers are never sent to the page
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      getCustomers(searchTerm.trim() || undefined)
        .then((data) => { if (active) { setCustomers(Array.isArray(data) ? data : []); setPage(1); } })
        .catch((err) => console.error('Failed to load customers:', err))
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [searchTerm]);

  const sorted = useMemo(() => {
    const value = (c: DirectoryCustomer) => (sortKey === 'risk' ? riskOf(c.segment_name || '') : (c[sortKey] ?? ''));
    return [...customers].sort((a, b) => {
      const x = value(a); const y = value(b);
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [customers, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'total_visits' || key === 'total_spent' ? 'desc' : 'asc'); }
    setPage(1);
  };

  // Exports contain every customer matching the search, in the current sort order (not just this page)
  const exportRows = () => sorted.map((c) => ({
    code: c.customer_code, name: c.full_name, segment: c.segment_name || '', visits: c.total_visits || 0,
    spent: Math.round(c.total_spent || 0), risk: riskOf(c.segment_name || '') === 'HIGH' ? 'High risk' : 'Active',
  }));
  const fileBase = `customers-${new Date().toISOString().slice(0, 10)}`;

  const exportExcel = async () => {
    setExporting('excel');
    try {
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      const header = ['Customer ID', 'Name', 'Segment', 'Visits', 'Total spent (₹)', 'Churn risk'].map((value) => ({ value, fontWeight: 'bold' as const }));
      const body = exportRows().map((r) => [
        { value: r.code }, { value: r.name }, { value: r.segment }, { value: r.visits, type: Number }, { value: r.spent, type: Number }, { value: r.risk },
      ]);
      await writeXlsxFile([header, ...body], { columns: [{ width: 16 }, { width: 28 }, { width: 24 }, { width: 10 }, { width: 16 }, { width: 14 }] })
        .toFile(`${fileBase}.xlsx`);
    } catch (e) {
      console.error('Excel export failed:', e);
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    setExporting('pdf');
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(16);
      doc.text('Customer intelligence & segments', 14, 16);
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(`${sorted.length} customers${searchTerm.trim() ? ` matching "${searchTerm.trim()}"` : ''} · ${new Date().toLocaleString('en-IN')}`, 14, 22);
      autoTable(doc, {
        startY: 27,
        // jsPDF's built-in fonts have no ₹ sign, so amounts are written as "Rs."
        head: [['Customer ID', 'Name', 'Segment', 'Visits', 'Total spent', 'Churn risk']],
        body: exportRows().map((r) => [r.code, r.name, r.segment, String(r.visits), `Rs. ${r.spent.toLocaleString('en-IN')}`, r.risk]),
        headStyles: { fillColor: [36, 74, 55], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [246, 250, 247] },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
      });
      doc.save(`${fileBase}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      setExporting(null);
    }
  };

  const SortHeader: React.FC<{ k: SortKey; label: string; align?: 'right' }> = ({ k, label, align }) => {
    const on = sortKey === k;
    const Icon = !on ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th aria-sort={on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-4 py-3 align-middle ${align === 'right' ? 'text-right' : 'text-left'}`}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex h-6 items-center gap-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d27a]/50 cursor-pointer ${align === 'right' ? 'flex-row-reverse' : ''} ${
            on ? 'text-[#ffffff]' : 'text-[#ffffff]/75 hover:text-[#ffffff]'
          }`}
        >
          {label}
          <Icon aria-hidden="true" className={`size-3.5 ${on ? 'text-[#f3d27a]' : 'text-[#ffffff]/40'}`} />
        </button>
      </th>
    );
  };

  const exportBtn = 'flex h-10 items-center gap-2 rounded-xl border border-[#dfe7e1] bg-[#ffffff] px-3.5 text-sm font-semibold text-[#33483c] transition-colors hover:border-[#c3d3c9] hover:bg-[#f6faf7] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1a2a20] sm:text-3xl">Customers</h1>
        <p className="mt-1 text-sm text-[#6c7e73]">Segments, visits, spend and churn risk for every customer.</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#dfe7e1] bg-[#ffffff]">
        {/* Toolbar: rows per page + export (left), search (right) */}
        <div className="flex flex-col gap-3 border-b border-[#ebf0ec] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[#6c7e73]">
              Show
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="h-10 cursor-pointer rounded-xl border border-[#dfe7e1] bg-[#ffffff] px-3 text-sm font-semibold text-[#1a2a20] focus:border-[#2f5d46] focus:outline-none focus:ring-4 focus:ring-[#2f5d46]/12"
                aria-label="Rows per page"
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              entries
            </label>
            <span aria-hidden="true" className="hidden h-6 w-px bg-[#ebf0ec] sm:block" />
            <div className="flex gap-2">
              <button onClick={exportExcel} disabled={!sorted.length || exporting !== null} className={exportBtn}>
                {exporting === 'excel' ? <RefreshCw className="size-4 animate-spin" /> : <FileSpreadsheet aria-hidden="true" className="size-4 text-[#23847a]" />}
                Excel
              </button>
              <button onClick={exportPdf} disabled={!sorted.length || exporting !== null} className={exportBtn}>
                {exporting === 'pdf' ? <RefreshCw className="size-4 animate-spin" /> : <FileText aria-hidden="true" className="size-4 text-rose-600" />}
                PDF
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {loading && <RefreshCw aria-label="Loading" className="size-4 animate-spin text-[#7f968a]" />}
            <div className="group relative w-full lg:w-80">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#7f968a] group-focus-within:text-[#2f5d46]" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, mobile or ID"
                aria-label="Search customers by name, mobile number or customer ID"
                className="h-10 w-full rounded-xl border border-[#dfe7e1] bg-[#ffffff] pl-10 pr-9 text-sm text-[#1a2a20] placeholder-[#8b9a92] focus:border-[#2f5d46] focus:outline-none focus:ring-4 focus:ring-[#2f5d46]/12"
              />
              {searchTerm && (
                <button type="button" onClick={() => setSearchTerm('')} aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-[#7f968a] hover:bg-[#eef3ee] hover:text-[#1a2a20] cursor-pointer">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[22%]" />
              <col className="w-[10%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="bg-gradient-to-r from-[#1d3d2d] to-[#2b5740]">
              <tr>
                <SortHeader k="full_name" label="Customer" />
                <SortHeader k="segment_name" label="Segment" />
                <SortHeader k="total_visits" label="Visits" align="right" />
                <SortHeader k="total_spent" label="Total spent" align="right" />
                <SortHeader k="risk" label="Churn risk" />
                <th className="px-4 py-3 text-right align-middle"><span className="inline-flex h-6 items-center text-[11px] font-semibold uppercase tracking-wider text-[#ffffff]/75">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ebf0ec] text-sm">
              {loading && customers.length === 0 && Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-4"><span className="block h-4 w-3/4 animate-pulse rounded bg-[#eef3ee]" /></td>
                  ))}
                </tr>
              ))}
              {!loading && customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <p className="text-sm font-semibold text-[#33483c]">No customers found</p>
                    <p className="mt-1 text-xs text-[#8a9a92]">Try a different name, mobile number or customer ID.</p>
                  </td>
                </tr>
              )}
              {rows.map((c) => {
                const high = riskOf(c.segment_name || '') === 'HIGH';
                return (
                  <tr key={c.id} className="transition-colors hover:bg-[#f6faf7]">
                    <td className="px-4 py-3.5 align-middle">
                      <div className="flex items-center">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[#1a2a20]">{c.full_name}</div>
                          <div className="font-mono text-[11px] text-[#7f968a]">{c.customer_code}</div>
                          {c.matched_by_phone && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#2f5d46]">
                              <Phone aria-hidden="true" className="size-3" /> Matched mobile number
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <span className={`inline-block max-w-full truncate rounded-full px-2.5 py-1 align-middle text-xs font-semibold ${SEGMENT_TONE(c.segment_name || '')}`} title={c.segment_name || undefined}>{c.segment_name || '—'}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right align-middle font-semibold tabular-nums text-[#33483c]">{c.total_visits}</td>
                    <td className="px-4 py-3.5 text-right align-middle font-bold tabular-nums text-[#1a2a20]">{inr(c.total_spent)}</td>
                    <td className="px-4 py-3.5 align-middle">
                      {high ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                          <AlertTriangle aria-hidden="true" className="size-3.5" /> High risk
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#e4eee7] px-2.5 py-1 text-xs font-semibold text-[#244a37]">
                          <ShieldCheck aria-hidden="true" className="size-3.5" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right align-middle">
                      <button className="rounded-lg border border-[#dfe7e1] px-3 py-1.5 text-xs font-semibold text-[#2f5d46] transition-colors hover:border-[#2f5d46] hover:bg-[#f2f8f4] cursor-pointer">
                        View profile
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer: count + pagination */}
        <div className="flex flex-col gap-3 border-t border-[#ebf0ec] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#6c7e73]" aria-live="polite">
            {sorted.length
              ? <>Showing <b className="text-[#1a2a20]">{start + 1}</b>–<b className="text-[#1a2a20]">{Math.min(start + pageSize, sorted.length)}</b> of <b className="text-[#1a2a20]">{sorted.length}</b> customers</>
              : 'Showing 0 customers'}
          </p>
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <button
              onClick={() => setPage(current - 1)}
              disabled={current <= 1}
              aria-label="Previous page"
              className="grid size-9 place-items-center rounded-lg text-[#33483c] transition-colors hover:bg-[#eef3ee] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="size-4" />
            </button>
            {pageList(current, totalPages).map((p, i) => p === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-sm text-[#a3b3a9]">…</span>
            ) : (
              <button
                key={p}
                onClick={() => setPage(p)}
                aria-current={p === current ? 'page' : undefined}
                className={`grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-semibold transition-colors cursor-pointer ${
                  p === current ? 'bg-[#244a37] text-[#ffffff] shadow-sm' : 'text-[#33483c] hover:bg-[#eef3ee]'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage(current + 1)}
              disabled={current >= totalPages}
              aria-label="Next page"
              className="grid size-9 place-items-center rounded-lg text-[#33483c] transition-colors hover:bg-[#eef3ee] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="size-4" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
};
