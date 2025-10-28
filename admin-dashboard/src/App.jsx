import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  // ── helpers ──────────────────────────────────────────────
  const selectedCount = selected.length;
  const allIds = useMemo(() => reports.map((r) => r.id), [reports]);
  const allSelected = useMemo(
    () => allIds.length > 0 && allIds.every((id) => selected.includes(id)),
    [allIds, selected]
  );

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    if (!keyword) return reports;
    return reports.filter((r) => {
      const url = (r.url || "").toLowerCase();
      const loc = (r.location || "").toLowerCase();
      return url.includes(keyword) || loc.includes(keyword);
    });
  }, [q, reports]);

  // ── data ops ─────────────────────────────────────────────
  const fetchReports = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await axios.get(`${API_URL}/report`);
      setReports(res.data || []);
    } catch (e) {
      setErr("데이터 로드 실패");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const toggleAll = () => {
    if (allSelected) setSelected([]);
    else setSelected(allIds);
  };

  const dispatch = async () => {
    if (!selected.length) return setMsg("신고할 항목을 선택하세요.");
    setLoading(true);
    setMsg("");
    try {
      const res = await axios.post(`${API_URL}/dispatch/manual`, {
        ids: selected,
      });
      setMsg(`🚔 ${res.data?.count ?? selected.length}건 신고 완료`);
      setSelected([]);
      await fetchReports();
    } catch (e) {
      setErr("신고 전송 실패");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    setLoading(true);
    setMsg("");
    try {
      await axios.delete(`${API_URL}/report/${id}`);
      setMsg("🗑️ 삭제 완료");
      await fetchReports();
    } catch {
      setErr("삭제 실패");
    } finally {
      setLoading(false);
    }
  };

  // ── UI ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 text-white grid place-items-center font-bold">
              Q
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold leading-tight">
                QSSAGE 운영자 대시보드
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                신고된 URL 모니터링 · 일괄 신고 · 정리
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchReports}
              className="px-3 py-2 rounded-md border border-slate-300 hover:bg-slate-100 transition text-sm"
            >
              🔄 새로고침
            </button>
            <button
              onClick={dispatch}
              className="px-3 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition text-sm disabled:opacity-50"
              disabled={!selectedCount || loading}
            >
              🚔 선택 {selectedCount ? `(${selectedCount})` : ""} 신고
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Status row */}
        {(msg || err) && (
          <div
            className={`rounded-md px-4 py-3 text-sm ${
              err
                ? "bg-rose-50 text-rose-700 border border-rose-200"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}
          >
            {err || msg}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full bg-slate-200">
              총 {reports.length}건
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700">
              선택 {selectedCount}건
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="URL·위치 검색"
              className="w-full sm:w-64 px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr className="border-b border-slate-200">
                  <th className="text-left px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="text-left px-4 py-3">ID</th>
                  <th className="text-left px-4 py-3">URL</th>
                  <th className="text-left px-4 py-3">위치</th>
                  <th className="text-left px-4 py-3">시간</th>
                  <th className="text-left px-4 py-3">관리</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      로딩 중...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center">
                      <div className="text-slate-500">표시할 데이터가 없습니다</div>
                      <button
                        onClick={fetchReports}
                        className="mt-3 text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100"
                      >
                        새로고침
                      </button>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      </td>
                      <td className="px-4 py-3">{r.id}</td>
                      <td className="px-4 py-3">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline break-all"
                        >
                          {r.url}
                        </a>
                      </td>
                      <td className="px-4 py-3">{r.location || "-"}</td>
                      <td className="px-4 py-3">
                        {r.detected_at
                          ? new Date(r.detected_at).toLocaleString()
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => remove(r.id)}
                          className="px-2.5 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100"
                          title="삭제"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}