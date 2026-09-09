import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AiPveChat from "../../../../components/AiPveChat/AiPveChat";
import MIcon from "../../../../components/MIcon";
import usePveOverview from "../../../../hooks/usePveOverview";
import { useAuth } from "../../../../contexts/AuthContext";
import { AiApiService } from "../../../../services/aiApi";
import { BatchProvisionService } from "../../../../services/batchProvision";
import { JobsService } from "../../../../services/jobs";
import { MonitoringService } from "../../../../services/monitoring";
import { SpecChangeRequestsService } from "../../../../services/specChangeRequests";
import { VmRequestsService } from "../../../../services/vmRequests";
import {
  buildFyiStats,
  buildTodayRows,
  buildUrgentRows,
  formatCheckedAt,
  mergeInfraProblems,
} from "./adminAttention";
import styles from "./AdminDashboardPage.module.scss";
import PageHeader from "../../../../components/PageHeader/PageHeader";

export function countRows(response) {
  if (Array.isArray(response)) return response.length;
  if (Number.isFinite(response?.count)) return response.count;
  if (Number.isFinite(response?.total)) return response.total;
  if (Array.isArray(response?.data)) return response.data.length;
  if (Array.isArray(response?.items)) return response.items.length;
  return 0;
}

export function normalizeAssistantPrompt(value) {
  return String(value ?? "").trim();
}

export default function AdminDashboardPage() {
  const { t, i18n } = useTranslation("personal");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { overview, loading: overviewLoading, refreshing, error: overviewError, reload } = usePveOverview();
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [conversationPrompt, setConversationPrompt] = useState("");
  /* 放大模式：對話佔滿版面，上面的待辦暫時收起來 */
  const [focusMode, setFocusMode] = useState(false);
  const [checks, setChecks] = useState({ alerts: [], failedJobs: 0, requests: 0, batches: 0, aiRequests: 0, unavailable: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function loadChecks() {
      setLoading(true);
      const settled = await Promise.allSettled([
        VmRequestsService.listAll("pending"),
        SpecChangeRequestsService.listAll({ status: "pending" }),
        BatchProvisionService.listPending(),
        AiApiService.listAllRequests(),
        JobsService.list({ statuses: ["failed", "blocked"], historyDays: 7, limit: 50 }),
        MonitoringService.listAlerts({ active: true, limit: 100 }),
      ]);
      if (!active) return;
      const value = (index) => settled[index].status === "fulfilled" ? settled[index].value : null;
      const aiPending = value(3)?.data?.filter((request) => request.status === "pending").length ?? 0;
      const alertRows = value(5);
      setChecks({
        requests: countRows(value(0)) + countRows(value(1)),
        batches: countRows(value(2)),
        aiRequests: aiPending,
        failedJobs: countRows(value(4)),
        alerts: Array.isArray(alertRows) ? alertRows : alertRows?.data ?? [],
        unavailable: settled.filter((result) => result.status === "rejected").length,
      });
      setLoading(false);
    }
    loadChecks();
    return () => { active = false; };
  }, []);

  /* 即時異常與未解除告警的門檻判斷共用同一組設定，兩邊都列會讓同一台機器
     出現兩次；mergeInfraProblems 負責去重，細節見 adminAttention.js。 */
  const infraProblems = useMemo(
    () => mergeInfraProblems(overview?.issues ?? [], checks.alerts ?? []),
    [overview?.issues, checks.alerts],
  );
  const urgent = useMemo(
    () => buildUrgentRows({ infraProblems, failedJobs: checks.failedJobs }, t),
    [infraProblems, checks.failedJobs, t],
  );
  const today = useMemo(() => buildTodayRows(checks, t), [checks, t]);
  const stats = useMemo(() => buildFyiStats(overview, t), [overview, t]);

  const busy = loading || (overviewLoading && !overview);
  const name = user?.full_name?.trim() || user?.email?.split("@")[0] || t("AdminDashboardPage.defaultName");

  function resetAssistant() {
    setConversationPrompt("");
    setAssistantPrompt("");
    setFocusMode(false);
  }

  function openAssistant(event) {
    event.preventDefault();
    const prompt = normalizeAssistantPrompt(assistantPrompt);
    if (!prompt) return;
    setConversationPrompt(prompt);
  }

  const suggestions = [
    t("AdminDashboardPage.suggestion1"),
    t("AdminDashboardPage.suggestion2"),
    t("AdminDashboardPage.suggestion3"),
  ];

  return <div className={`${styles.page} ${focusMode ? styles.pageFocused : ""}`}>
    <PageHeader title={t("AdminDashboardPage.greeting", { name })} subtitle={t("AdminDashboardPage.subtitle")} />

    {!focusMode && <section className={styles.attention} aria-labelledby="admin-attention-title">
      <div className={styles.attentionHead}>
        <div>
          <h2 id="admin-attention-title">{t("AdminDashboardPage.attentionTitle")}</h2>
          <span className={styles.checkedAt}>
            {overview
              ? t("AdminDashboardPage.pveUpdatedAt", { time: formatCheckedAt(overview.collected_at, i18n.language) })
              : t("AdminDashboardPage.pveNotChecked")}
          </span>
        </div>
        <button type="button" onClick={() => reload()} disabled={busy || refreshing}>
          <MIcon name="refresh" size={15} className={refreshing ? styles.spin : ""} />
          {t("AdminDashboardPage.pveRefresh")}
        </button>
      </div>

      {busy ? <div className={styles.checking}><MIcon name="sync" size={18} className={styles.spin} />{t("AdminDashboardPage.checking")}</div> : <>
        {/* 現在就處理：服務已經受影響，看到就該動手 */}
        {urgent.length > 0 && <div className={`${styles.tier} ${styles.tierNow}`}>
          <h3><MIcon name="priority_high" size={15} />{t("AdminDashboardPage.tierNowTitle")}</h3>
          {urgent.map((row) => <button type="button" key={row.key} className={`${styles.row} ${styles[`row_${row.tone}`]}`} onClick={() => navigate(row.path)}>
            <MIcon name={row.icon} size={17} />
            <span><strong>{row.title}</strong><small>{row.detail}</small></span>
            {row.count ? <b>{row.count}</b> : null}
            <MIcon name="chevron_right" size={16} />
          </button>)}
        </div>}

        {/* 排進今天：有人被卡住等我放行，但服務沒壞 */}
        {today.length > 0 && <div className={styles.tier}>
          <h3><MIcon name="approval" size={15} />{t("AdminDashboardPage.tierTodayTitle")}</h3>
          {today.map((row) => <button type="button" key={row.key} className={styles.row} onClick={() => navigate(row.path)}>
            <MIcon name={row.icon} size={17} />
            <span><strong>{row.title}</strong></span>
            <b>{row.count}</b>
            <MIcon name="chevron_right" size={16} />
          </button>)}
        </div>}

        {urgent.length === 0 && today.length === 0 && <div className={styles.allClear}>
          <MIcon name="check_circle" size={19} />
          <div><strong>{t("AdminDashboardPage.allClearTitle")}</strong><small>{t("AdminDashboardPage.allClearDesc")}</small></div>
        </div>}

        {/* 只是知會：不需要動作的運作數字，收成一條窄帶 */}
        <div className={styles.statsBar}>
          {stats.map((stat) => <button type="button" key={stat.key} onClick={() => navigate(stat.path)}>
            <MIcon name={stat.icon} size={15} />
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </button>)}
          {(overviewError || overview?.data_status === "stale" || overview?.data_status === "partial") && <span className={styles.staleNote}>
            <MIcon name="sync_problem" size={14} />
            {overview?.data_status === "partial" ? t("AdminDashboardPage.pvePartialMessage") : t("AdminDashboardPage.pveStaleMessage")}
          </span>}
          {checks.unavailable > 0 && <span className={styles.staleNote}>
            <MIcon name="cloud_off" size={14} />
            {t("AdminDashboardPage.issueUnavailableTitle")}
          </span>}
        </div>
      </>}
    </section>}

    {/* AI 助手：沒開始對話前只是一條輸入列，不要先佔掉整片高度 */}
    <section className={`${styles.assistant} ${focusMode ? styles.assistantFocused : ""}`} aria-labelledby="admin-assistant-title">
      <div className={styles.assistantHead}>
        <MIcon name="support_agent" size={19} />
        <h2 id="admin-assistant-title">{t("AdminDashboardPage.assistantLabel")}</h2>
        {conversationPrompt ? <div className={styles.assistantActions}>
          <button type="button" onClick={() => setFocusMode((value) => !value)}>
            <MIcon name={focusMode ? "close_fullscreen" : "open_in_full"} size={15} />
            {focusMode ? t("AdminDashboardPage.backToOverview") : t("AdminDashboardPage.expandChat")}
          </button>
          <button type="button" onClick={resetAssistant}>
            <MIcon name="refresh" size={15} />
            {t("AdminDashboardPage.askAgain")}
          </button>
        </div> : <span className={styles.assistantHint}>{t("AdminDashboardPage.assistantTitle")}</span>}
      </div>

      {conversationPrompt ? <AiPveChat initialPrompt={conversationPrompt} compact={!focusMode} fill={focusMode} />
        : <form className={styles.assistantForm} onSubmit={openAssistant}>
          <div className={styles.assistantInput}>
            <MIcon name="terminal" size={19} />
            <input value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} placeholder={t("AdminDashboardPage.promptPlaceholder")} autoComplete="off" />
            <button type="submit" disabled={!assistantPrompt.trim()}>{t("AdminDashboardPage.startAsking")}<MIcon name="arrow_forward" size={16} /></button>
          </div>
          <div className={styles.assistantSuggestions}>
            {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setAssistantPrompt(suggestion)}>{suggestion}</button>)}
          </div>
        </form>}
    </section>
  </div>;
}
