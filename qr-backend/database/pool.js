// qr-backend/database/pool.js
import pkg from "pg";
const { Pool } = pkg;

// .env에 DB 정보가 있다면 자동으로 불러오기
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASS || "1234",
  database: process.env.DB_NAME || "qssage",
  port: process.env.DB_PORT || 5432,
  max: 10,               // 동시에 열 수 있는 커넥션 수
  idleTimeoutMillis: 30000, // 비활성 커넥션 대기시간(ms)
  connectionTimeoutMillis: 5000 // 연결 시도 제한 시간(ms)
});

// 연결 테스트 (서버 실행 시 1회 확인용)
pool.connect()
  .then(client => {
    console.log("✅ PostgreSQL 연결 성공:", client.database);
    client.release();
  })
  .catch(err => {
    console.error("❌ PostgreSQL 연결 실패:", err.message);
  });

export default pool;