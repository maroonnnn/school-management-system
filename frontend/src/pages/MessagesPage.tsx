import { useState, type ChangeEvent, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { API_BASE, apiFetch, getToken } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Field, Loading, PageHeader } from "../components/ui";

interface InboxRow { id: number; kind: string; subject: string; preview: string; requires_ack: boolean; sender_name: string; sent_at: string; opened: boolean; acknowledged: boolean; attachments: number }
interface OutboxRow { id: number; kind: string; subject: string; status: "DRAFT" | "SENT"; requires_ack: boolean; target_summary: string; at: string; recipients: number; opened: number; acknowledged: number }
interface Recipient { recipient_type: string; name: string; opened_at: string | null; opened_by_name: string | null; acknowledged_at: string | null; acknowledged_by_name: string | null }
interface Detail {
  id: number; subject: string; body: string; kind: string; status: string; requires_ack: boolean; target_summary: string;
  sender_name: string; sender_user_name: string; sent_at: string | null; isSender: boolean; acknowledged: boolean | null;
  attachments: { id: number; file_name: string; file_size: number }[]; recipients: Recipient[];
}
interface Targets { directorates: { id: number; name: string }[]; schools: { id: number; name: string; directorate_id: number }[] }
interface PendingFile { fileName: string; mimeType: string; dataBase64: string; size: number }

const KIND: Record<string, { label: string; cls: string }> = {
  CIRCULAR: { label: "تعميم وزاري", cls: "text-bg-primary" },
  NOTICE: { label: "إشعار المديرية", cls: "text-bg-info" },
  MESSAGE: { label: "رسالة", cls: "text-bg-light border" },
};
const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

// FR-MSG-01..12
function MessagesPage() {
  const { user } = useAuth();
  const isMinistry = user?.role === "MINISTRY_ADMIN";
  const isDirectorate = user?.role === "DIRECTORATE_ADMIN";
  const isSchool = !isMinistry && !isDirectorate;
  const [params, setParams] = useSearchParams();
  const box = (params.get("box") ?? (isMinistry ? "outbox" : "inbox")) as "inbox" | "outbox" | "compose";
  const openId = params.get("open") ? Number(params.get("open")) : null;
  const go = (b: string, open?: number) => setParams(open ? { box: b, open: String(open) } : { box: b });

  const inbox = useApi<InboxRow[]>(box === "inbox" ? "/messages/inbox" : null);
  const outbox = useApi<OutboxRow[]>(box === "outbox" ? "/messages/outbox" : null);
  const detail = useApi<Detail>(openId && box !== "compose" ? `/messages/${openId}` : null);
  const targets = useApi<Targets>(box === "compose" && !isSchool ? "/messages/meta/targets" : null);
  const [msg, setMsg] = useState({ ok: "", err: "" });

  const emptyForm = { subject: "", body: "", requiresAck: false, mode: isSchool ? "MY_DIRECTORATE" : "ALL_SCHOOLS", ids: [] as number[], replyToId: null as number | null };
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [editingDraft, setEditingDraft] = useState<number | null>(null);

  async function run(fn: () => Promise<{ message: string; data?: { id: number } }>, after?: (r: { data?: { id: number } }) => void) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await fn();
      setMsg({ ok: r.message, err: "" });
      inbox.reload(); outbox.reload(); detail.reload();
      after?.(r);
    } catch (e) {
      setMsg({ ok: "", err: (e as Error).message });
    }
  }

  async function addFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (files.length >= 3) return setMsg({ ok: "", err: "حتى 3 مرفقات فقط" });
    if (f.size > 3 * 1024 * 1024) return setMsg({ ok: "", err: "حجم المرفق أكبر من 3 ميغابايت" });
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const dataBase64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    setFiles([...files, { fileName: f.name, mimeType: f.type || MIME[ext] || "", dataBase64, size: f.size }]);
  }

  function submit(send: boolean) {
    const payload = {
      subject: form.subject, body: form.body, requiresAck: form.requiresAck, replyToId: form.replyToId,
      target: { mode: form.mode, ids: form.ids }, attachments: files.map(({ fileName, mimeType, dataBase64 }) => ({ fileName, mimeType, dataBase64 })),
    };
    const reset = () => { setForm(emptyForm); setFiles([]); setEditingDraft(null); };
    if (editingDraft) {
      void run(async () => {
        const r = await apiFetch<{ message: string }>(`/messages/${editingDraft}`, { method: "PUT", body: JSON.stringify(payload) });
        if (!send) return r;
        return apiFetch<{ message: string }>(`/messages/${editingDraft}/send`, { method: "POST" });
      }, () => { const id = editingDraft; reset(); go("outbox", id); });
    } else {
      void run(() => apiFetch<{ message: string; data: { id: number } }>("/messages", { method: "POST", body: JSON.stringify({ ...payload, send }) }),
        (r) => { reset(); go("outbox", r.data?.id); });
    }
  }

  async function download(fileId: number, name: string) {
    const r = await fetch(`${API_BASE}/messages/${openId}/attachments/${fileId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) return setMsg({ ok: "", err: "تعذّر تنزيل المرفق" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function reply(d: Detail) {
    setForm({ ...emptyForm, subject: `رد: ${d.subject}`, replyToId: d.id, mode: isSchool ? "MY_DIRECTORATE" : "SCHOOLS", ids: [] });
    go("compose");
  }

  const toggleId = (id: number) => setForm({ ...form, ids: form.ids.includes(id) ? form.ids.filter((x) => x !== id) : [...form.ids, id] });
  const d = detail.data;
  const tabs: [string, string][] = [...(isMinistry ? [] : [["inbox", "الوارد"] as [string, string]]), ["outbox", "الصادر"], ["compose", isMinistry ? "تعميم جديد" : "رسالة جديدة"]];
  const unread = (inbox.data ?? []).filter((m) => !m.opened).length;

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="المراسلات والتعاميم" subtitle={isMinistry ? "تعاميم الوزارة للمديريات والمدارس" : isDirectorate ? "وارد وصادر المديرية — المراسلة مع مدارسها فقط" : "وارد وصادر المدرسة — المراسلة مع المديرية فقط"} />
      <ul className="nav nav-pills mb-3">
        {tabs.map(([k, label]) => (
          <li className="nav-item" key={k}>
            <button className={`nav-link ${box === k ? "active" : ""}`} onClick={() => go(k)}>
              {label}{k === "inbox" && unread > 0 && <span className="badge text-bg-warning ms-1">{unread}</span>}
            </button>
          </li>
        ))}
      </ul>
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || inbox.error || outbox.error || detail.error}</Alert>

      {box === "compose" && (
        <form className="card border-0 shadow-sm rounded-4" style={{ maxWidth: 860 }} onSubmit={(e: FormEvent) => { e.preventDefault(); submit(true); }}>
          <div className="card-body row g-3">
            <div className="col-12">
              <label className="form-label fw-semibold small">إلى</label>
              {isSchool ? <div className="form-control bg-light">مديرية التربية التابعة لها المدرسة</div> : (
                <>
                  <div className="d-flex flex-wrap gap-3 mb-2">
                    {([["ALL_SCHOOLS", isMinistry ? "كل المدارس" : "كل مدارس المديرية"], ...(isMinistry ? [["DIRECTORATES", "مديريات محددة"]] : []), ["SCHOOLS", "مدارس محددة"]] as [string, string][]).map(([v, l]) => (
                      <div className="form-check" key={v}>
                        <input id={`mode-${v}`} type="radio" className="form-check-input" checked={form.mode === v} onChange={() => setForm({ ...form, mode: v, ids: [] })} />
                        <label htmlFor={`mode-${v}`} className="form-check-label">{l}</label>
                      </div>
                    ))}
                  </div>
                  {form.mode !== "ALL_SCHOOLS" && (
                    <div className="d-flex flex-wrap gap-2 p-2 border rounded-3" style={{ maxHeight: 160, overflowY: "auto" }}>
                      {(form.mode === "DIRECTORATES" ? targets.data?.directorates : targets.data?.schools)?.map((t) => (
                        <button type="button" key={t.id} onClick={() => toggleId(Number(t.id))}
                          className={`btn btn-sm ${form.ids.includes(Number(t.id)) ? "btn-primary" : "btn-outline-secondary"}`}>{t.name}</button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <Field label="الموضوع *" col="col-12"><input className="form-control" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required maxLength={200} /></Field>
            <Field label="النص *" col="col-12"><textarea className="form-control" rows={7} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /></Field>
            {!isSchool && (
              <div className="col-12 form-check ms-2">
                <input id="ack" type="checkbox" className="form-check-input" checked={form.requiresAck} onChange={(e) => setForm({ ...form, requiresAck: e.target.checked })} />
                <label htmlFor="ack" className="form-check-label">يتطلب تأكيد الاستلام من الجهة المستلمة</label>
              </div>
            )}
            <div className="col-12">
              <label className="btn btn-sm btn-outline-secondary"><i className="bi bi-paperclip ms-1"></i>إرفاق ملف (PDF، صورة، Word ≤ 3MB)
                <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={addFile} />
              </label>
              {files.map((f, i) => (
                <span key={i} className="badge text-bg-light border ms-2">{f.fileName} <button type="button" className="btn-close btn-close-sm ms-1" style={{ fontSize: ".5rem" }} aria-label="إزالة" onClick={() => setFiles(files.filter((_, j) => j !== i))}></button></span>
              ))}
              {editingDraft && <div className="small text-secondary mt-1">المرفقات المضافة هنا تُضاف إلى مرفقات المسودة الموجودة.</div>}
            </div>
            <div className="col-12 d-flex gap-2">
              <button className="btn btn-primary"><i className="bi bi-send ms-1"></i>إرسال</button>
              <button type="button" className="btn btn-outline-secondary" onClick={() => submit(false)}>حفظ كمسودة</button>
              <span className="small text-secondary align-self-center">بعد الإرسال لا يمكن تعديل الرسالة أو حذفها.</span>
            </div>
          </div>
        </form>
      )}

      {box !== "compose" && (
        <div className="row g-3">
          <div className={openId ? "col-xl-5" : "col-12"}>
            <div className="card border-0 shadow-sm rounded-4">
              {(box === "inbox" ? inbox : outbox).loading && !(box === "inbox" ? inbox.data : outbox.data) ? <Loading /> : (
                <div className="list-group list-group-flush rounded-4">
                  {box === "inbox" && inbox.data?.map((m) => (
                    <button key={m.id} type="button" onClick={() => go("inbox", m.id)}
                      className={`list-group-item list-group-item-action py-3 ${Number(m.id) === openId ? "active" : ""} ${!m.opened ? "fw-bold" : ""}`}>
                      <div className="d-flex justify-content-between gap-2">
                        <span>{!m.opened && <i className="bi bi-circle-fill text-warning ms-1" style={{ fontSize: ".5rem" }}></i>}{m.subject}</span>
                        <span className={`badge ${KIND[m.kind].cls}`}>{KIND[m.kind].label}</span>
                      </div>
                      <div className={`small fw-normal ${Number(m.id) === openId ? "" : "text-secondary"}`}>
                        {m.sender_name} · {m.sent_at}{m.attachments > 0 && <> · <i className="bi bi-paperclip"></i>{m.attachments}</>}
                        {m.requires_ack && !m.acknowledged && <span className="badge text-bg-danger ms-1">يتطلب تأكيداً</span>}
                      </div>
                    </button>
                  ))}
                  {box === "outbox" && outbox.data?.map((m) => (
                    <button key={m.id} type="button" onClick={() => go("outbox", m.id)}
                      className={`list-group-item list-group-item-action py-3 ${Number(m.id) === openId ? "active" : ""}`}>
                      <div className="d-flex justify-content-between gap-2">
                        <span className="fw-semibold">{m.subject}</span>
                        {m.status === "DRAFT" ? <span className="badge text-bg-light border">مسودة</span> : <span className={`badge ${KIND[m.kind].cls}`}>{KIND[m.kind].label}</span>}
                      </div>
                      <div className={`small ${Number(m.id) === openId ? "" : "text-secondary"}`}>
                        إلى: {m.target_summary} · {m.at}
                        {m.status === "SENT" && <> · فُتحت {m.opened}/{m.recipients}{m.requires_ack && <> · أُكّدت {m.acknowledged}/{m.recipients}</>}</>}
                      </div>
                    </button>
                  ))}
                  {(box === "inbox" ? inbox.data : outbox.data)?.length === 0 && <p className="text-secondary p-4 mb-0">لا توجد رسائل.</p>}
                </div>
              )}
            </div>
          </div>

          {openId && (
            <div className="col-xl-7">
              <div className="card border-0 shadow-sm rounded-4">
                <div className="card-body">
                  {!d ? <Loading /> : (
                    <>
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <div>
                          <span className={`badge ${KIND[d.kind].cls} mb-1`}>{KIND[d.kind].label}</span>
                          <h2 className="h5 fw-bold brand-title mb-1">{d.subject}</h2>
                          <div className="small text-secondary">من: {d.sender_name} ({d.sender_user_name}){d.sent_at && ` · ${d.sent_at}`} · إلى: {d.target_summary}</div>
                        </div>
                        <button className="btn-close" aria-label="إغلاق" onClick={() => go(box)}></button>
                      </div>
                      <div className="p-3 rounded-3 bg-light mb-3" style={{ whiteSpace: "pre-wrap" }}>{d.body}</div>
                      {d.attachments.length > 0 && (
                        <ul className="list-unstyled small mb-3">
                          {d.attachments.map((a) => (
                            <li key={a.id}><button className="btn btn-link btn-sm p-0" onClick={() => download(a.id, a.file_name)}><i className="bi bi-paperclip"></i> {a.file_name}</button> <span className="text-secondary">· {Math.ceil(a.file_size / 1024)} KB</span></li>
                          ))}
                        </ul>
                      )}
                      <div className="d-flex flex-wrap gap-2 mb-3">
                        {!d.isSender && d.requires_ack && !d.acknowledged && (
                          <button className="btn btn-success btn-sm" onClick={() => run(() => apiFetch(`/messages/${d.id}/acknowledge`, { method: "POST" }))}>
                            <i className="bi bi-check2-circle ms-1"></i>تأكيد الاستلام
                          </button>
                        )}
                        {!d.isSender && d.acknowledged && <span className="badge text-bg-success p-2">تم تأكيد الاستلام</span>}
                        {!d.isSender && !isMinistry && (isSchool || d.kind === "MESSAGE") && (
                          <button className="btn btn-outline-primary btn-sm" onClick={() => reply(d)}><i className="bi bi-reply ms-1"></i>رد</button>
                        )}
                        {d.isSender && d.status === "DRAFT" && (
                          <>
                            <button className="btn btn-primary btn-sm" onClick={() => run(() => apiFetch(`/messages/${d.id}/send`, { method: "POST" }))}>إرسال</button>
                            <button className="btn btn-outline-secondary btn-sm" onClick={() => {
                              setForm({ ...emptyForm, subject: d.subject, body: d.body, requiresAck: d.requires_ack });
                              setEditingDraft(d.id);
                              go("compose");
                            }}>تعديل</button>
                            <button className="btn btn-outline-danger btn-sm" onClick={() => window.confirm("حذف المسودة؟") && run(() => apiFetch(`/messages/${d.id}`, { method: "DELETE" }), () => go("outbox"))}>حذف</button>
                          </>
                        )}
                      </div>

                      {d.isSender && d.status === "SENT" && (
                        <>
                          <h3 className="h6 fw-bold">حالة الاستلام <span className="text-secondary small fw-normal">(FR-MSG-10)</span></h3>
                          <div className="table-responsive">
                            <table className="table table-sm align-middle small mb-0">
                              <thead className="table-light"><tr><th>الجهة</th><th>فُتحت</th>{d.requires_ack && <th>تأكيد الاستلام</th>}</tr></thead>
                              <tbody>
                                {d.recipients.map((r, i) => (
                                  <tr key={i}>
                                    <td>{r.name}{r.recipient_type === "DIRECTORATE" && <span className="text-secondary"> (نسخة)</span>}</td>
                                    <td>{r.opened_at ? <><i className="bi bi-check2 text-success"></i> {r.opened_at}<div className="text-secondary">{r.opened_by_name}</div></> : <span className="text-secondary">لم تُفتح</span>}</td>
                                    {d.requires_ack && <td>{r.acknowledged_at ? <><i className="bi bi-check2-all text-success"></i> {r.acknowledged_at}<div className="text-secondary">{r.acknowledged_by_name}</div></> : <span className="badge text-bg-warning">بانتظار</span>}</td>}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MessagesPage;
