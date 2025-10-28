import { useEffect, useState } from "react";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState([]);
  const [msg, setMsg] = useState("");

  const fetchReports = async () => {
    const res = await axios.get(`${API_URL}/report`);
    setReports(res.data);
  };

  useEffect(() => { fetchReports(); }, []);

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const dispatch = async () => {
    if (!selected.length) return setMsg("신고할 항목을 선택하세요.");
    await axios.post(`${API_URL}/dispatch/manual`, { ids: selected });
    setMsg(`${selected.length}건 신고 완료`);
    setSelected([]);
    fetchReports();
  };

  const remove = async (id) => {
    await axios.delete(`${API_URL}/report/${id}`);
    setMsg("삭제 완료");
    fetchReports();
  };

  return (
    <div style={{ padding: 20, fontFamily: "Pretendard, sans-serif" }}>
      <h2> QSSAGE 운영자 대시보드</h2>
      <button onClick={fetchReports}>🔄 새로고침</button>
      <button onClick={dispatch} style={{ marginLeft: 10 }}>🚔 일괄 신고</button>
      <p>{msg}</p>

      <table border="1" cellPadding="6" style={{ width: "100%", marginTop: 20, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>선택</th>
            <th>ID</th>
            <th>URL</th>
            <th>위치</th>
            <th>시간</th>
            <th>삭제</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /></td>
              <td>{r.id}</td>
              <td>{r.url}</td>
              <td>{r.location || "-"}</td>
              <td>{new Date(r.detected_at).toLocaleString()}</td>
              <td><button onClick={() => remove(r.id)}>🗑️</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}