from fastapi import Header, Depends
from typing import Optional, List

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

def admin_auth(x_admin_token: Optional[str] = Header(None)):
    if not ADMIN_TOKEN or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="unauthorized")
    return True

@app.get("/admin/reports")
def admin_list_reports(
    status: str = "pending", limit: int = 100, _: bool = Depends(admin_auth)
):
    if status not in ("pending","batched","submitted","rejected"):
        raise HTTPException(400, "bad status")
    sql = """
      SELECT report_id, qr_content, ST_AsText(ST_PointFromGeoHash(ST_GeoHash(loc))) as loc_text,
             status, created_at, reviewed_at, admin_note
      FROM report
      WHERE status=%s
      ORDER BY created_at
      LIMIT %s
    """
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, (status, limit))
        rows = cur.fetchall()
        return {"items": rows}

class NoteReq(BaseModel):
    admin_note: Optional[constr(max_length=2000)] = None

@app.post("/admin/reports/{report_id}/approve")
def admin_approve(report_id: int, body: NoteReq, _: bool = Depends(admin_auth)):
    sql = "UPDATE report SET status='pending', reviewed_at=now(), admin_note=%s WHERE report_id=%s RETURNING report_id"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (body.admin_note, report_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "not found")
    return {"status":"ok","report_id":report_id}

@app.post("/admin/reports/{report_id}/reject")
def admin_reject(report_id: int, body: NoteReq, _: bool = Depends(admin_auth)):
    sql = "UPDATE report SET status='rejected', reviewed_at=now(), admin_note=%s WHERE report_id=%s RETURNING report_id"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (body.admin_note, report_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "not found")
    return {"status":"ok","report_id":report_id}

class BatchCreateReq(BaseModel):
    target_system: constr(min_length=1, max_length=200)
    limit: int = 100
    created_by: Optional[constr(max_length=100)] = "admin"

@app.post("/admin/batches")
def admin_create_batch(body: BatchCreateReq, _: bool = Depends(admin_auth)):
    sql = "SELECT create_submit_batch(%s,%s,%s)"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (body.target_system, body.created_by, body.limit))
        batch_id = cur.fetchone()[0]
    return {"batch_id": batch_id}

@app.get("/admin/batches/{batch_id}")
def admin_get_batch(batch_id: int, _: bool = Depends(admin_auth)):
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM submit_batch WHERE batch_id=%s", (batch_id,))
        batch = cur.fetchone()
        if not batch:
            raise HTTPException(404, "not found")
        cur.execute("""
          SELECT r.report_id, r.qr_content, r.status
          FROM submit_batch_item s JOIN report r ON r.report_id=s.report_id
          WHERE s.batch_id=%s ORDER BY r.created_at
        """, (batch_id,))
        items = cur.fetchall()
    return {"batch": batch, "items": items}

class SubmitReq(BaseModel):
    external_ref: Optional[constr(max_length=200)] = None

@app.post("/admin/batches/{batch_id}/submit")
def admin_submit_batch(batch_id: int, body: SubmitReq, _: bool = Depends(admin_auth)):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT mark_batch_submitted(%s,%s)", (batch_id, body.external_ref))
    return {"status":"ok","batch_id":batch_id}