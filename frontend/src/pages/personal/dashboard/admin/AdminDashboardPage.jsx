import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AiPveChat from "../../../../components/AiPveChat/AiPveChat";
import AdminCapacityPanel from "../../../../components/AdminCapacityPanel/AdminCapacityPanel";
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
    .filter((bucket) => bucket.items.length > 0)
    .map((bucket) => ({
      ...bucket,
      total: bucket.items.reduce((sum, issue) => sum + issue.count, 0),
    }));
}

/* 管理主控台：照管理員心裡的分類擺，不是照側邊欄的功能表擺。
   問「這台機器接得上嗎」看平台接取，「這個人能做什麼」看身分與治理。 */
const CONSOLE_GROUPS = [
  {
    key: "platform",
    icon: "dns",
    items: [
      { key: "pveConnections", icon: "device_hub", path: "/pve-connections" },
      { key: "nodes", icon: "lock", path: "/nodes" },
      { key: "storage", icon: "storage", path: "/storage" },
      { key: "gpu", icon: "auto_awesome_mosaic", path: "/gpu-mgmt" },
    ],
  },
  {
    key: "network",
    icon: "lan",
    items: [
      { key: "ip", icon: "lan", path: "/ip-management" },
      { key: "domain", icon: "domain", path: "/domain" },
      { key: "gateway", icon: "router", path: "/gateway" },
      { key: "firewall", icon: "security", path: "/firewall" },
    ],
  },
  {
    key: "identity",
    icon: "admin_panel_settings",
    items: [
      { key: "users", icon: "group", path: "/admin" },
      { key: "ldap", icon: "badge", path: "/ldap" },
      { key: "quotas", icon: "data_usage", path: "/quotas" },
      { key: "governance", icon: "policy", path: "/governance" },
    ],
  },
  {
    key: "operations",
    icon: "schedule",
    items: [
      { key: "scheduler", icon: "settings_input_component", path: "/scheduler" },
      { key: "jobs", icon: "task_alt", path: "/jobs" },
      { key: "audit", icon: "receipt_long", path: "/audit" },
      { key: "aiMonitoring", icon: "monitor_heart", path: "/ai-monitoring" },
    ],
  },
];

export function normalizeAssistantPrompt(value) {
  return String(value ?? "").trim();
}

export default function AdminDashboardPage() {
  const { t } = useTranslation("personal");
  const navigate = useNavigate();
  const { user } = useAuth();
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [conversationPrompt, setConversationPrompt] = useState("");
  /* 放大模式：對話佔滿版面，上面的分層總覽暫時收起來 */
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

    {!focusMode && <>
      {/* 第一層：需要我決策的事 */}
      <section className={styles.tier} aria-labelledby="admin-attention-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>{t("AdminDashboardPage.tierDecisionLabel")}</span>
            <h2 id="admin-attention-title">{t("AdminDashboardPage.attentionTitle")}</h2>
          </div>
          <button type="button" onClick={() => navigate("/monitoring")}>{t("AdminDashboardPage.openMonitoring")}<MIcon name="arrow_forward" size={16} /></button>
        </div>
        {loading ? <div className={styles.checking}><MIcon name="sync" size={20} className={styles.spin} />{t("AdminDashboardPage.checking")}</div>
          : buckets.length ? <div className={styles.bucketGrid}>
            {buckets.map((bucket) => <article key={bucket.key} className={`${styles.bucket} ${styles[`bucket_${bucket.key}`]}`}>
              <header>
                <span className={styles.bucketIcon}><MIcon name={bucket.icon} size={19} /></span>
                <div>
                  <strong>{t(`AdminDashboardPage.bucket${bucket.key}Title`)}</strong>
                  <small>{t(`AdminDashboardPage.bucket${bucket.key}Desc`)}</small>
                </div>
                <em>{bucket.total}</em>
              </header>
              <div className={styles.bucketItems}>
                {bucket.items.map((issue) => <button type="button" key={issue.key} onClick={() => navigate(issue.path)}>
                  <MIcon name={issue.icon} size={17} />
                  <span><strong>{issue.title}</strong><small>{issue.description}</small></span>
                  <b>{issue.count}</b>
                  <MIcon name="arrow_forward" size={15} />
                </button>)}
              </div>
            </article>)}
          </div> : <div className={styles.allClear}>
            <span><MIcon name="check_circle" size={21} /></span>
            <div><strong>{t("AdminDashboardPage.allClearTitle")}</strong><p>{t("AdminDashboardPage.allClearDesc")}</p></div>
          </div>}
      </section>

      {/* 第二層：平台現在的樣子（健康 + 水位並排，兩者都是「現況」不是「待辦」） */}
      <section className={styles.tier} aria-labelledby="admin-state-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>{t("AdminDashboardPage.tierStateLabel")}</span>
            <h2 id="admin-state-title">{t("AdminDashboardPage.stateTitle")}</h2>
          </div>
        </div>
        <div className={styles.stateGrid}>
          <PveOperationsQuickLook />
          <AdminCapacityPanel />
        </div>
      </section>

      {/* 第三層：設定入口。平常不看，要找的時候要找得到 */}
      <section className={styles.tier} aria-labelledby="admin-console-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>{t("AdminDashboardPage.tierConsoleLabel")}</span>
            <h2 id="admin-console-title">{t("AdminDashboardPage.consoleTitle")}</h2>
          </div>
        </div>
        <div className={styles.consoleGrid}>
          {CONSOLE_GROUPS.map((group) => <article key={group.key} className={styles.consoleGroup}>
            <h3><MIcon name={group.icon} size={17} />{t(`AdminDashboardPage.console${group.key}Title`)}</h3>
            <div className={styles.consoleLinks}>
              {group.items.map((item) => <button type="button" key={item.key} onClick={() => navigate(item.path)}>
                <MIcon name={item.icon} size={16} />
                {t(`AdminDashboardPage.console${item.key}`)}
              </button>)}
            </div>
          </article>)}
        </div>
      </section>
    </>}

    {/* 最後一層：AI 助手全寬，回覆裡的表格才有完整寬度可展開 */}
    <section className={`${styles.assistantSection} ${focusMode ? styles.assistantSectionFocused : ""}`} aria-labelledby="admin-assistant-title">
      <div className={styles.assistantIntro}>
        <span className={styles.assistantIcon}><MIcon name="support_agent" size={26} /></span>
        <div>
          <span className={styles.assistantLabel}>{t("AdminDashboardPage.assistantLabel")}</span>
          <h2 id="admin-assistant-title">{t("AdminDashboardPage.assistantTitle")}</h2>
          {!conversationPrompt && <p>{t("AdminDashboardPage.assistantIntro")}</p>}
        </div>
        {conversationPrompt && <div className={styles.assistantActions}>
          <button type="button" className={styles.assistantReset} onClick={() => setFocusMode((value) => !value)}>
            <MIcon name={focusMode ? "close_fullscreen" : "open_in_full"} size={16} />
            {focusMode ? t("AdminDashboardPage.backToOverview") : t("AdminDashboardPage.expandChat")}
          </button>
          <button type="button" className={styles.assistantReset} onClick={resetAssistant}>
            <MIcon name="refresh" size={16} />
            {t("AdminDashboardPage.askAgain")}
          </button>
        </div>}
      </div>

      {conversationPrompt ? <AiPveChat initialPrompt={conversationPrompt} compact={!focusMode} fill={focusMode} />
        : <form className={styles.assistantForm} onSubmit={openAssistant}>
          <div className={styles.assistantInput}>
            <MIcon name="terminal" size={21} />
            <textarea value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} placeholder={t("AdminDashboardPage.promptPlaceholder")} rows={2} autoComplete="off" />
            <button type="submit" disabled={!assistantPrompt.trim()}><span>{t("AdminDashboardPage.startAsking")}</span><MIcon name="arrow_forward" size={18} /></button>
          </div>
          <div className={styles.assistantFooter}>
            <span>{t("AdminDashboardPage.suggestionsLabel")}</span>
            {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setAssistantPrompt(suggestion)}>{suggestion}</button>)}
          </div>
        </form>}
    </section>
  </div>;
}
