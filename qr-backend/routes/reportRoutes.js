import express from 'express';
import pg from 'pg';

const router = express.Router();

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'admin',
  password: process.env.PGPASSWORD || '1234',
  database: process.env.PGDATABASE || 'qssage',
});





// 📝 신고 등록
router.post('/', async (req, res) => {
  const { url, location } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });

  try {
    const insertQ = `
      INSERT INTO reports (url, location, detected_at)
      VALUES ($1, $2, NOW())
      RETURNING id, url, location, detected_at, dispatched;
    `;
    const { rows } = await pool.query(insertQ, [url, location || null]);
    res.json({ ok: true, report: rows[0] });
  } catch (err) {
    console.error('POST /report error:', err);
    res.status(500).json({ ok: false, error: 'insert failed' });
  }
});
// 📋 모든 신고 목록 조회 (관리자 페이지용)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports ORDER BY detected_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🗑️ 신고 삭제
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM reports WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;