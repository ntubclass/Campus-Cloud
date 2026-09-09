import { apiGet, apiPost } from "./api";

/* 管理者首頁同時有硬體快看與容量水位兩個區塊要看這份匯總，
   同一個 tick 打兩次是白花的往返；共用同一筆 in-flight 請求並短暫快取。
   TTL 遠短於快看的 30 秒自動更新，所以自動更新拿到的一定是新資料。 */
const OVERVIEW_CACHE_TTL_MS = 5_000;
let overviewCache = null;

export const MonitoringService = {
  /** 全域監控匯總：叢集容量/用量、節點與 VM 統計（管理員）
   *  呼叫端各自帶的 signal 只用來忽略自己的結果，不會取消共用請求。 */
  getOverview({ timeoutMs } = {}) {
    const now = Date.now();
    if (overviewCache?.pending) return overviewCache.pending;
    if (overviewCache && now - overviewCache.cachedAt < OVERVIEW_CACHE_TTL_MS) {
      return Promise.resolve(overviewCache.value);
    }
    /* 刻意不轉交呼叫端的 signal：共用的請求不能被先卸載的那一方取消。 */
    const pending = apiGet("/api/v1/monitoring/overview", { timeoutMs })
      .then((value) => {
        overviewCache = { value, cachedAt: Date.now(), pending: null };
        return value;
      })
      .catch((error) => {
        if (overviewCache?.pending === pending) overviewCache = null;
        throw error;
      });
    overviewCache = { value: null, cachedAt: 0, pending };
    return pending;
  },

  /** 節點 RRD 趨勢（timeframe: hour|day|week） */
  getNodeRrd(node, timeframe = "hour") {
    return apiGet(
      `/api/v1/monitoring/nodes/${encodeURIComponent(node)}/rrd?timeframe=${timeframe}`,
    );
  },

  /** VM/LXC RRD 趨勢（擁有者或管理員） */
  getVmRrd(vmid, timeframe = "hour") {
    return apiGet(`/api/v1/monitoring/vms/${vmid}/rrd?timeframe=${timeframe}`);
  },

  /** 警告事件列表（active=true 只列未解除的） */
  listAlerts({ active = false, limit = 200 } = {}) {
    const q = new URLSearchParams();
    q.set("active", String(active));
    q.set("limit", String(limit));
    return apiGet(`/api/v1/monitoring/alerts?${q.toString()}`);
  },

  /** 確認（ack）一筆警告 */
  ackAlert(alertId) {
    return apiPost(`/api/v1/monitoring/alerts/${alertId}/ack`, {});
  },
};
