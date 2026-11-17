import { apiFetch } from "../services/api";
import { useCallback, useState } from "react";

type RequestStatus = "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

interface SchoolRequest {
  id: number;
  request_number: string;
  request_type: string;
  title: string;
  description: string;
  status: RequestStatus;
  created_at: string;
  submitted_at: string | null;
  school_name: string;
  created_by_name: string;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}


const statusLabels: Record<RequestStatus, string> = {
  SUBMITTED: "مقدّم",
  UNDER_REVIEW: "قيد المراجعة",
  APPROVED: "مقبول",
  REJECTED: "مرفوض",
};

const statusClasses: Record<RequestStatus, string> = {
  SUBMITTED: "text-bg-primary",
  UNDER_REVIEW: "text-bg-warning",
  APPROVED: "text-bg-success",
  REJECTED: "text-bg-danger",
};

function DirectorateRequests() {
  const [requests, setRequests] = useState<SchoolRequest[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<number | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<number | null>(
    null,
  );
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const result = await apiFetch<ApiResponse<SchoolRequest[]>>("/requests/directorate");

      if (!Array.isArray(result.data)) {
        throw new Error("استجابة الخادم لا تحتوي على قائمة الطلبات");
      }

      setRequests(result.data);
      setHasLoaded(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "حدث خطأ أثناء الاتصال بالخادم",
      );
      setRequests([]);
      setHasLoaded(false);
    } finally {
      setLoading(false);
    }
  }, []);

  async function changeRequestStatus(
    requestId: number,
    action: "review" | "approve" | "reject",
    reason?: string,
  ) {
    setActiveRequestId(requestId);
    setError("");
    setMessage("");

    try {
      const result = await apiFetch<ApiResponse<SchoolRequest>>(`/requests/${requestId}/${action}`, {
        method: "POST",
        ...(action === "reject" && { body: JSON.stringify({ reason }) }),
      });

      setRejectingRequestId(null);
      setRejectionReason("");
      await loadRequests();
      setMessage(result.message || "تم تحديث حالة الطلب بنجاح");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "حدث خطأ أثناء الاتصال بالخادم",
      );
    } finally {
      setActiveRequestId(null);
    }
  }

  return (
    <main className="container py-4 py-lg-5" dir="rtl">
      <div className="mb-4">
        <div className="text-primary fw-semibold mb-2">
          <i className="bi bi-house-door ms-1"></i>
          لوحة التحكم / طلبات المدارس
        </div>
        <h2 className="fw-bold mb-2" style={{ color: "var(--brand-green-900)" }}>
          مراجعة طلبات المدارس
        </h2>
        <p className="text-secondary mb-0">
          استعراض طلبات مديريتك ومتابعة مراجعتها واتخاذ القرار بشأنها.
        </p>
      </div>

      {error && (
        <div className="alert alert-danger rounded-3" role="alert">
          <i className="bi bi-exclamation-circle ms-2"></i>
          {error}
        </div>
      )}
      {message && (
        <div className="alert alert-success rounded-3" role="status">
          <i className="bi bi-check-circle ms-2"></i>
          {message}
        </div>
      )}

      <section className="card border-0 shadow-sm rounded-4">
        <div className="card-body p-0">
          <div className="d-flex justify-content-between align-items-center p-4 border-bottom">
            <h5 className="fw-bold mb-0">طلبات المديرية</h5>
            <div className="d-flex align-items-center gap-2">
              <span className="badge rounded-pill bg-light text-primary">
                {requests.length} طلب
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={() => void loadRequests()}
                disabled={loading}
              >
                <i className="bi bi-arrow-clockwise ms-1"></i>
                تحديث
              </button>
            </div>
          </div>

          {requests.length === 0 && !loading ? (
            <div className="text-center text-secondary p-5">
              {hasLoaded
                ? "لا توجد طلبات متاحة لهذه المديرية."
                : "اضغط على «تحديث» لجلب طلبات المديرية."}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">رقم الطلب</th>
                    <th scope="col">المدرسة</th>
                    <th scope="col">عنوان الطلب</th>
                    <th scope="col">مقدم الطلب</th>
                    <th scope="col">الحالة</th>
                    <th scope="col">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="text-nowrap">{request.request_number}</td>
                      <td>{request.school_name}</td>
                      <td>
                        <div className="fw-semibold">{request.title}</div>
                        <small className="text-secondary">
                          {request.description}
                        </small>
                      </td>
                      <td>{request.created_by_name}</td>
                      <td>
                        <span
                          className={`badge ${statusClasses[request.status]}`}
                        >
                          {statusLabels[request.status]}
                        </span>
                      </td>
                      <td>
                        <div className="d-flex flex-wrap gap-2">
                          {request.status === "SUBMITTED" && (
                            <button
                              className="btn btn-sm btn-outline-primary"
                              type="button"
                              disabled={activeRequestId !== null}
                              onClick={() =>
                                void changeRequestStatus(
                                  request.id,
                                  "review",
                                )
                              }
                            >
                              بدء المراجعة
                            </button>
                          )}
                          {request.status === "UNDER_REVIEW" && (
                            <>
                              <button
                                className="btn btn-sm btn-success"
                                type="button"
                                disabled={activeRequestId !== null}
                                onClick={() =>
                                  void changeRequestStatus(
                                    request.id,
                                    "approve",
                                  )
                                }
                              >
                                موافقة
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                type="button"
                                disabled={activeRequestId !== null}
                                onClick={() => {
                                  setRejectingRequestId(request.id);
                                  setRejectionReason("");
                                }}
                              >
                                رفض
                              </button>
                            </>
                          )}
                          {(request.status === "APPROVED" ||
                            request.status === "REJECTED") && (
                            <span className="text-secondary small">
                              لا توجد إجراءات متاحة
                            </span>
                          )}
                        </div>
                        {rejectingRequestId === request.id && (
                          <div className="mt-2" style={{ minWidth: 240 }}>
                            <label
                              className="form-label small"
                              htmlFor={`rejection-reason-${request.id}`}
                            >
                              سبب الرفض (مطلوب)
                            </label>
                            <textarea
                              id={`rejection-reason-${request.id}`}
                              className="form-control form-control-sm mb-2"
                              rows={2}
                              value={rejectionReason}
                              onChange={(event) =>
                                setRejectionReason(event.target.value)
                              }
                              required
                            />
                            <div className="d-flex gap-2">
                              <button
                                className="btn btn-sm btn-danger"
                                type="button"
                                disabled={
                                  !rejectionReason.trim() ||
                                  activeRequestId !== null
                                }
                                onClick={() =>
                                  void changeRequestStatus(
                                    request.id,
                                    "reject",
                                    rejectionReason.trim(),
                                  )
                                }
                              >
                                تأكيد الرفض
                              </button>
                              <button
                                className="btn btn-sm btn-outline-secondary"
                                type="button"
                                onClick={() => setRejectingRequestId(null)}
                              >
                                إلغاء
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default DirectorateRequests;
