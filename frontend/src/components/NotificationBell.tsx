import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";

interface Item { id: number; title: string; body: string | null; link: string | null; at: string; read: boolean }

// FR-REQ-14: inbox notifications for school managers and the directorate (refreshes every minute)
export default function NotificationBell() {
  const n = useApi<{ items: Item[]; unread: number }>("/notifications");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { reload } = n;

  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function openItem(i: Item) {
    if (!i.read) await apiFetch(`/notifications/${i.id}/read`, { method: "POST" }).catch(() => {});
    setOpen(false);
    reload();
    if (i.link) navigate(i.link);
  }

  const unread = n.data?.unread ?? 0;
  return (
    <div className="position-relative" ref={ref}>
      <button type="button" className="btn btn-link text-white p-1 position-relative" aria-label={`الإشعارات (${unread} غير مقروء)`} onClick={() => setOpen((o) => !o)}>
        <i className="bi bi-bell fs-5"></i>
        {unread > 0 && <span className="position-absolute top-0 start-0 badge rounded-pill text-bg-warning" style={{ fontSize: ".65rem" }}>{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel shadow rounded-3">
          <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
            <span className="fw-bold">الإشعارات</span>
            {unread > 0 && <button className="btn btn-link btn-sm p-0" onClick={async () => { await apiFetch("/notifications/read-all", { method: "POST" }); reload(); }}>تعليم الكل كمقروء</button>}
          </div>
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {n.data?.items.map((i) => (
              <button key={i.id} type="button" className={`notif-item ${i.read ? "" : "unread"}`} onClick={() => openItem(i)}>
                <div className="fw-semibold small">{i.title}</div>
                {i.body && <div className="small text-secondary text-truncate">{i.body}</div>}
                <div className="text-secondary" style={{ fontSize: ".7rem" }}>{i.at}</div>
              </button>
            ))}
            {n.data?.items.length === 0 && <div className="p-3 small text-secondary">لا توجد إشعارات</div>}
          </div>
        </div>
      )}
    </div>
  );
}
