import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AiPveChat from "../../../../components/AiPveChat/AiPveChat";
import PveOperationsQuickLook from "../../../../components/PveOperationsQuickLook/PveOperationsQuickLook";
import MIcon from "../../../../components/MIcon";
import { useAuth } from "../../../../contexts/AuthContext";
import { AiApiService } from "../../../../services/aiApi";
import { BatchProvisionService } from "../../../../services/batchProvision";
import { JobsService } from "../../../../services/jobs";
import { MonitoringService } from "../../../../services/monitoring";
import { SpecChangeRequestsService } from "../../../../services/specChangeRequests";
import { VmRequestsService } from "../../../../services/vmRequests";
import styles from "./AdminDashboardPage.module.scss";
import PageHeader from "../../../../components/PageHeader/PageHeader";
import i18n from "../../../../i18n";

export function countRows(response) {
  if (Array.isArray(response)) return response.length;
  if (Number.isFinite(response?.count)) return response.count;
  if (Number.isFinite(response?.total)) return response.total;
  if (Array.isArray(response?.data)) return response.data.length;
  if (Array.isArray(response?.items)) return response.items.length;
  return 0;
}

const defaultT = (key) => i18n.t(key, { ns: "personal" });

export function buildAdminIssues(checks, t = defaultT) {
  const issues = [];
  if (checks.alerts > 0) issues.push({ key: "alerts", tone: "danger", icon: "error", title: t("AdminDashboardPage.issueAlertsTitle"), description: t("AdminDashboardPage.issueAlertsDesc"), count: checks.alerts, path: "/monitoring" });
  if (checks.failedJobs > 0) issues.push({ key: "jobs", tone: "danger", icon: "error_outline", title: t("AdminDashboardPage.issueJobsTitle"), description: t("AdminDashboardPage.issueJobsDesc"), count: checks.failedJobs, path: "/jobs" });
  if (checks.requests > 0) issues.push({ key: "requests", tone: "info", icon: "pending_actions", title: t("AdminDashboardPage.issueRequestsTitle"), description: t("AdminDashboardPage.issueRequestsDesc"), count: checks.requests, path: "/request-review" });
  if (checks.batches > 0) issues.push({ key: "batches", tone: "info", icon: "library_add_check", title: t("AdminDashboardPage.issueBatchesTitle"), description: t("AdminDashboardPage.issueBatchesDesc"), count: checks.batches, path: "/batch-review" });
  if (checks.aiRequests > 0) issues.push({ key: "ai", tone: "info", icon: "rate_review", title: t("AdminDashboardPage.issueAiTitle"), description: t("AdminDashboardPage.issueAiDesc"), count: checks.aiRequests, path: "/ai-api-review" });
  if (checks.unavailable > 0) issues.push({ key: "unavailable", tone: "muted", icon: "cloud_off", title: t("AdminDashboardPage.issueUnavailableTitle"), description: t("AdminDashboardPage.issueUnavailableDesc"), count: checks.unavailable, path: "/monitoring" });
  return issues;
}

/* 待辦分三桶，因為管理員對它們的反應完全不同：
   故障要現在動手、審核是別人在等我放行、狀態不明只是資料沒收到。
   桶子由既有 issue 的 tone 決定，避免同一份清單定義兩次。 */
const ISSUE_BUCKETS = [
  { key: "faults", tone: "danger", icon: "crisis_alert" },
  { key: "review", tone: "info", icon: "approval" },
  { key: "degraded", tone: "muted", icon: "cloud_off" },
];

export function groupAdminIssues(issues) {
  return ISSUE_BUCKETS
    .map((bucket) => ({
      ...bucket,
      items: issues.filter((issue) => issue.tone === bucket.tone),
    }))
    .filter((bucket) => bucket.items.length > 0);
}

export function normalizeAssistantPrompt(value) {
  return String(value ?? "").trim();
}

export default function AdminDashboardPage() {
  const { t } = useTranslation("personal");
  const navigate = useNavigate();
  const { user } = useAuth();
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [conversationPrompt, setConversationPrompt] = useState("");
  /* 放大模式：對話佔滿版面，上面的待辦與狀態暫時收起來 */
  const [focusMode, setFocusMode] = useState(false);
  const [checks, setChecks] = useState({ alerts: 0, failedJobs: 0, requests: 0, batches: 0, aiRequests: 0, unavailable: 0 });
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
      const unavailable = settled.filter((result) => result.status === "rejected").length;
      const aiPending = value(3)?.data?.filter((request) => request.status === "pending").length ?? 0;
      setChecks({
        requests: countRows(value(0)) + countRows(value(1)),
        batches: countRows(value(2)),
        aiRequests: aiPending,
        failedJobs: countRows(value(4)),
        alerts: countRows(value(5)),
        unavailable,
      });
      setLoading(false);
    }
    loadChecks();
    return () => { active = false; };
  }, []);

  const issues = useMemo(() => buildAdminIssues(checks, t), [checks, t]);
  const buckets = useMemo(() => groupAdminIssues(issues), [issues]);
  const pendingTotal = useMemo(
    () => issues.reduce((sum, issue) => sum + issue.count, 0),
    [issues],
  );
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

    {/* 待辦與硬體狀態並排：一邊回答「要做什麼」，一邊回答「有沒有壞」，
        兩邊內容都不長，疊成兩段只是把頁面拉長。 */}
    {!focusMode && <div className={styles.topGrid}>
      <section className={styles.card} aria-labelledby="admin-attention-title">
        <div className={styles.cardHead}>
          {/* 副標與右卡的「更新於…」同樣是兩行，否則兩張卡的內容起始高度差一截 */}
          <div>
            <h2 id="admin-attention-title">{t("AdminDashboardPage.attentionTitle")}</h2>
            <span className={styles.cardSubtitle}>
              {loading ? t("AdminDashboardPage.checking")
                : pendingTotal ? t("AdminDashboardPage.attentionSummary", { count: pendingTotal })
                : t("AdminDashboardPage.attentionSummaryClear")}
            </span>
          </div>
          <button type="button" onClick={() => navigate("/monitoring")}>{t("AdminDashboardPage.openMonitoring")}<MIcon name="arrow_forward" size={15} /></button>
        </div>
        {loading ? <div className={styles.checking}><MIcon name="sync" size={18} className={styles.spin} /></div>
          : buckets.length ? <div className={styles.buckets}>
            {buckets.map((bucket) => <div key={bucket.key} className={`${styles.bucket} ${styles[`bucket_${bucket.key}`]}`}>
              <div className={styles.bucketHead}>
                <MIcon name={bucket.icon} size={15} />
                {t(`AdminDashboardPage.bucket${bucket.key}Title`)}
              </div>
              {bucket.items.map((issue) => <button type="button" key={issue.key} className={styles.issue} onClick={() => navigate(issue.path)}>
                <MIcon name={issue.icon} size={16} />
                <span>{issue.title}</span>
                <b>{issue.count}</b>
                <MIcon name="chevron_right" size={16} />
              </button>)}
            </div>)}
          </div> : <div className={styles.allClear}>
            <MIcon name="check_circle" size={19} />
            <div><strong>{t("AdminDashboardPage.allClearTitle")}</strong><small>{t("AdminDashboardPage.allClearDesc")}</small></div>
          </div>}
      </section>

      <PveOperationsQuickLook />
    </div>}

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
