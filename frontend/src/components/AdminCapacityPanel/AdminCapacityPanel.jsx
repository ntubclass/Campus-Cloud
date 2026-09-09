import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import MIcon from "../MIcon";
import { GpuService } from "../../services/gpu";
import { IpManagementService } from "../../services/ipManagement";
import { MonitoringService } from "../../services/monitoring";
import styles from "./AdminCapacityPanel.module.scss";

/* 池型資源（儲存、IP、GPU）沒有像 CPU／記憶體那樣的可設定門檻，
   但「快配完了」對管理員就是要提前知道的事，所以用一組固定水位。
   CPU／記憶體優先吃 overview.thresholds，管理員調過就跟著調。 */
const POOL_WARN_PERCENT = 75;
const POOL_CRITICAL_PERCENT = 90;
const DEFAULT_THRESHOLD_PERCENT = 90;

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || bytes === "") return "—";
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  const gb = value / 1024 ** 3;
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(value / 1024 ** 2).toFixed(0)} MB`;
}

export function percentOf(used, total) {
  const usedValue = Number(used);
  const totalValue = Number(total);
  if (!Number.isFinite(usedValue) || !Number.isFinite(totalValue) || totalValue <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, (usedValue / totalValue) * 100));
}

/** 水位對應的語氣。critical 用滿載門檻，warn 早一階提醒。 */
export function capacityTone(percent, { warn, critical }) {
  if (percent === null) return "unknown";
  if (percent >= critical) return "critical";
  if (percent >= warn) return "warn";
  return "ok";
}

/**
 * 把三份來源整理成同一種列。任何一份缺了就略過該列，不要用 0 假裝有資料。
 */
export function buildCapacityRows({ overview, ipStatus, gpuMappings }, t) {
  const rows = [];
  const cpuThreshold = Number(overview?.thresholds?.cpu) || DEFAULT_THRESHOLD_PERCENT;
  const memThreshold = Number(overview?.thresholds?.memory) || DEFAULT_THRESHOLD_PERCENT;
  const poolLimits = { warn: POOL_WARN_PERCENT, critical: POOL_CRITICAL_PERCENT };

  if (overview) {
    rows.push({
      key: "cpu",
      icon: "memory",
      label: t("AdminCapacityPanel.cpuLabel"),
      percent: percentOf(overview.cpu_used, overview.cpu_total),
      detail: t("AdminCapacityPanel.cpuDetail", {
        used: Number(overview.cpu_used ?? 0).toFixed(1),
        total: overview.cpu_total ?? 0,
      }),
      limits: { warn: cpuThreshold - 15, critical: cpuThreshold },
      path: "/monitoring",
    });
    rows.push({
      key: "memory",
      icon: "developer_board",
      label: t("AdminCapacityPanel.memoryLabel"),
      percent: percentOf(overview.mem_used, overview.mem_total),
      detail: `${formatBytes(overview.mem_used)} / ${formatBytes(overview.mem_total)}`,
      limits: { warn: memThreshold - 15, critical: memThreshold },
      path: "/monitoring",
    });
    rows.push({
      key: "disk",
      icon: "storage",
      label: t("AdminCapacityPanel.diskLabel"),
      percent: percentOf(overview.disk_used, overview.disk_total),
      detail: `${formatBytes(overview.disk_used)} / ${formatBytes(overview.disk_total)}`,
      limits: poolLimits,
      path: "/storage",
    });
  }

  if (ipStatus?.configured) {
    rows.push({
      key: "ip",
      icon: "lan",
      label: t("AdminCapacityPanel.ipLabel"),
      percent: percentOf(ipStatus.used_ips, ipStatus.total_ips),
      detail: t("AdminCapacityPanel.ipDetail", {
        used: ipStatus.used_ips ?? 0,
        total: ipStatus.total_ips ?? 0,
      }),
      limits: poolLimits,
      path: "/ip-management",
    });
  }

  const mappings = gpuMappings?.data ?? gpuMappings;
  if (Array.isArray(mappings) && mappings.length) {
    const used = mappings.reduce((sum, row) => sum + Number(row.used_count ?? 0), 0);
    const total = mappings.reduce((sum, row) => sum + Number(row.capacity_count ?? 0), 0);
    if (total > 0) {
      rows.push({
        key: "gpu",
        icon: "auto_awesome_mosaic",
        label: t("AdminCapacityPanel.gpuLabel"),
        percent: percentOf(used, total),
        detail: t("AdminCapacityPanel.gpuDetail", { used, total }),
        limits: poolLimits,
        path: "/gpu-mgmt",
      });
    }
  }

  return rows.map((row) => ({ ...row, tone: capacityTone(row.percent, row.limits) }));
}

export default function AdminCapacityPanel() {
  const { t } = useTranslation("personal");
  const navigate = useNavigate();
  const [sources, setSources] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (signal) => {
    setLoading(true);
    const settled = await Promise.allSettled([
      MonitoringService.getOverview({ signal }),
      IpManagementService.getStatus(),
      GpuService.listMappings(),
    ]);
    if (signal?.aborted) return;
    const value = (index) => (settled[index].status === "fulfilled" ? settled[index].value : null);
    setSources({ overview: value(0), ipStatus: value(1), gpuMappings: value(2) });
    setFailed(settled.every((result) => result.status === "rejected"));
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const rows = sources ? buildCapacityRows(sources, t) : [];

  return (
    <section className={styles.panel} aria-labelledby="admin-capacity-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t("AdminCapacityPanel.eyebrow")}</span>
          <h3 id="admin-capacity-title">{t("AdminCapacityPanel.title")}</h3>
        </div>
        <button type="button" className={styles.refresh} onClick={() => load()} disabled={loading}>
          <MIcon name="refresh" size={16} className={loading ? styles.spin : ""} />
          {t("AdminCapacityPanel.refresh")}
        </button>
      </header>

      {loading && !sources ? (
        <div className={styles.state} role="status">
          <MIcon name="sync" size={18} className={styles.spin} />
          {t("AdminCapacityPanel.loading")}
        </div>
      ) : failed || !rows.length ? (
        <div className={styles.state} role="status">
          <MIcon name="cloud_off" size={18} />
          {t("AdminCapacityPanel.unavailable")}
        </div>
      ) : (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.key}>
              <button type="button" className={styles.row} onClick={() => navigate(row.path)}>
                <span className={styles.rowLabel}>
                  <MIcon name={row.icon} size={17} />
                  {row.label}
                </span>
                <span className={`${styles.track} ${styles[`tone_${row.tone}`]}`}>
                  <span className={styles.fill} style={{ width: `${row.percent ?? 0}%` }} />
                </span>
                <strong className={styles.percent}>
                  {row.percent === null ? "—" : `${row.percent.toFixed(0)}%`}
                </strong>
                <span className={styles.detail}>{row.detail}</span>
                <MIcon name="arrow_forward" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
