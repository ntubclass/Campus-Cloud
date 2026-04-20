import { useEffect, useState } from "react";
import styles from "./RequestsPage.module.scss";
import { apiGet, apiPost } from "../../../services/api";
import { useAuth } from "../../../contexts/AuthContext";
import AiSidePanel from "./AiSidePanel";
import FastTemplatesPanel from "../../../components/FastTemplatesPanel/FastTemplatesPanel";

const MIcon = ({ name, size = 20 }) => (
  <span className="material-icons-outlined" style={{ fontSize: size, lineHeight: 1 }}>
    {name}
  </span>
);

function normalizeHostname(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

function FieldGroup({ label, hint, required, error, children, labelRight }) {
  return (
    <div className={styles.formGroup}>
      <label className={styles.label}>
        <span>
          {label}
          {required && <span className={styles.required}> *</span>}
        </span>
        {labelRight && <span className={styles.labelValue}>{labelRight}</span>}
      </label>
      {children}
      {hint && <p className={styles.fieldHint}>{hint}</p>}
      {error && <p className={styles.fieldError}>{error}</p>}
    </div>
  );
}

function SelectField({ value, onChange, disabled, children, placeholder }) {
  return (
    <select
      className={styles.select}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {children}
    </select>
  );
}

export default function RequestFormPage({ onBack, className }) {
  const { user } = useAuth();
  const isPrivileged = user?.is_superuser || user?.role === "admin" || user?.role === "teacher";

  const [closing, setClosing]   = useState(false);
  const [aiOpen, setAiOpen]     = useState(false);

  /* Service template (LXC only) */
  const [serviceTemplateName, setServiceTemplateName] = useState("");
  const [serviceTemplateSlug, setServiceTemplateSlug] = useState("");
  const [showTemplatePanel, setShowTemplatePanel]     = useState(false);

  /* Form state */
  const [resourceType, setResourceType] = useState("lxc");
  const [mode, setMode]                 = useState("scheduled");
  const [form, setForm] = useState({
    hostname: "",
    ostemplate: "",
    os_info: "",
    password: "",
    template_id: "",
    username: "",
    cores: 2,
    memory: 2048,
    rootfs_size: 8,
    disk_size: 20,
    gpu_mapping_id: "",
    start_at: "",
    end_at: "",
    immediate_no_end: true,
    reason: "",
  });
  const [errors, setErrors]         = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  /* API data */
  const [lxcTemplates, setLxcTemplates] = useState([]);
  const [lxcLoading, setLxcLoading]     = useState(false);
  const [vmTemplates, setVmTemplates]   = useState([]);
  const [vmLoading, setVmLoading]       = useState(false);
  const [gpuOptions, setGpuOptions]     = useState([]);
  const [gpuLoading, setGpuLoading]     = useState(false);

  /* Fetch LXC templates */
  useEffect(() => {
    if (resourceType !== "lxc" || lxcTemplates.length > 0) return;
    setLxcLoading(true);
    apiGet("/api/v1/lxc/templates")
      .then(setLxcTemplates)
      .catch(() => {})
      .finally(() => setLxcLoading(false));
  }, [resourceType]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Fetch VM templates */
  useEffect(() => {
    if (resourceType !== "vm" || vmTemplates.length > 0) return;
    setVmLoading(true);
    apiGet("/api/v1/vm/templates")
      .then(setVmTemplates)
      .catch(() => {})
      .finally(() => setVmLoading(false));
  }, [resourceType]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Fetch GPU options (VM only, after window selected or immediate) */
  const canLoadGpu = resourceType === "vm" && (mode === "immediate" || (form.start_at && form.end_at));
  useEffect(() => {
    if (!canLoadGpu) {
      setGpuOptions([]);
      setForm((prev) => ({ ...prev, gpu_mapping_id: "" }));
      return;
    }
    setGpuLoading(true);
    const params = mode === "immediate"
      ? ""
      : `?start_at=${encodeURIComponent(form.start_at)}&end_at=${encodeURIComponent(form.end_at)}`;
    apiGet(`/api/v1/gpu/options${params}`)
      .then(setGpuOptions)
      .catch(() => setGpuOptions([]))
      .finally(() => setGpuLoading(false));
  }, [canLoadGpu, form.start_at, form.end_at, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key, val) {
    setForm((prev) => ({ ...prev, [key]: val }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  function handleBack() {
    setClosing(true);
    setTimeout(onBack, 180);
  }

  function validate() {
    const errs = {};
    if (!form.hostname.trim()) errs.hostname = "Hostname 為必填";
    else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(form.hostname))
      errs.hostname = "Hostname 只能包含小寫英數字與連字符，且不能以連字符開頭或結尾";
    if (!form.password) errs.password = "密碼為必填（至少 8 個字元）";
    else if (form.password.length < 8) errs.password = "密碼至少需要 8 個字元";
    if (!form.reason.trim()) errs.reason = "申請原因為必填";
    else if (form.reason.trim().length < 10) errs.reason = "申請原因至少需要 10 個字元";
    if (resourceType === "lxc" && !form.ostemplate) errs.ostemplate = "請選擇作業系統範本";
    if (resourceType === "vm") {
      if (!form.template_id) errs.template_id = "請選擇作業系統";
      if (!form.username.trim()) errs.username = "使用者名稱為必填";
    }
    if (mode === "scheduled") {
      if (!form.start_at) errs.start_at = "請選擇開始時間";
      if (!form.end_at) errs.end_at = "請選擇結束時間";
      if (form.start_at && form.end_at && new Date(form.start_at) >= new Date(form.end_at))
        errs.end_at = "結束時間必須晚於開始時間";
    }
    if (mode === "immediate" && !form.immediate_no_end && form.end_at) {
      if (new Date(form.end_at) <= new Date()) errs.end_at = "結束時間必須晚於現在";
    }
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      const body = {
        resource_type: resourceType,
        mode,
        hostname: form.hostname,
        password: form.password,
        cores: form.cores,
        memory: form.memory,
        os_info: form.os_info || undefined,
        reason: form.reason.trim(),
        storage: "local-lvm",
        ...(resourceType === "lxc"
          ? { ostemplate: form.ostemplate, rootfs_size: form.rootfs_size }
          : { template_id: Number(form.template_id), username: form.username, disk_size: form.disk_size }),
        ...(form.gpu_mapping_id ? { gpu_mapping_id: form.gpu_mapping_id } : {}),
        ...(mode === "scheduled"
          ? { start_at: form.start_at, end_at: form.end_at }
          : (!form.immediate_no_end && form.end_at ? { end_at: form.end_at } : {})),
      };
      await apiPost("/api/v1/vm-requests/", body);
      handleBack();
    } catch (err) {
      setSubmitError(err?.message ?? "送出失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSelectTemplate(template) {
    setServiceTemplateName(template.name || "");
    setServiceTemplateSlug(template.slug || "");
    setShowTemplatePanel(false);
    const res = template.install_methods?.[0]?.resources;
    if (res) {
      if (res.cpu) set("cores", res.cpu);
      if (res.ram) set("memory", res.ram);
      if (res.hdd) set("rootfs_size", Math.max(res.hdd, 8));
    }
    if (template.slug) set("hostname", template.slug.slice(0, 63));
  }

  const animCls = closing ? styles.animSlideOutRight : (className ?? "");

  return (
    <div className={`${styles.formPage} ${animCls}`}>
      {/* ── 頁首 ── */}
      <div className={styles.formPageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>申請資源</h1>
          <p className={styles.pageSubtitle}>填寫需求，或讓 AI 助手幫你決定規格</p>
        </div>
        <button type="button" className={styles.backBtn} onClick={handleBack}>
          <MIcon name="arrow_back" size={18} />
          返回
        </button>
      </div>

      {/* ── 主體：表單 + AI 側欄 ── */}
      <div className={styles.formPageBody}>
        <div className={styles.formScroll}>
          <form id="request-form" onSubmit={handleSubmit} className={styles.form}>

            {/* ── 模式切換（管理員／老師） ── */}
            {isPrivileged && (
              <div className={styles.formSection}>
                <h2 className={styles.sectionTitle}>申請模式</h2>
                <div className={styles.typeToggle}>
                  {[
                    { key: "scheduled", label: "預約模式", icon: "calendar_month" },
                    { key: "immediate", label: "立即模式", icon: "bolt" },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={`${styles.typeBtn} ${mode === m.key ? styles.typeBtnActive : ""}`}
                      onClick={() => setMode(m.key)}
                    >
                      <MIcon name={m.icon} size={16} />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── 資源類型 ── */}
            <div className={styles.formSection}>
              <h2 className={styles.sectionTitle}>資源類型</h2>
              <div className={styles.typeToggle}>
                {[
                  { key: "lxc", label: "LXC 容器", icon: "dashboard" },
                  { key: "vm",  label: "虛擬機器", icon: "computer"  },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`${styles.typeBtn} ${resourceType === t.key ? styles.typeBtnActive : ""}`}
                    onClick={() => setResourceType(t.key)}
                  >
                    <MIcon name={t.icon} size={16} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── LXC 欄位 ── */}
            {resourceType === "lxc" && (
              <div className={styles.formSection}>
                <h2 className={styles.sectionTitle}>容器設定</h2>

                <FieldGroup label="Hostname" required error={errors.hostname}>
                  <input
                    className={styles.input}
                    placeholder="project-alpha-web"
                    value={form.hostname}
                    onChange={(e) => set("hostname", e.target.value)}
                    onBlur={(e) => set("hostname", normalizeHostname(e.target.value))}
                  />
                </FieldGroup>

                <FieldGroup label="服務模板（選填）">
                  {serviceTemplateName ? (
                    <div className={styles.templateSelected}>
                      <MIcon name="layers" size={16} />
                      <div className={styles.templateSelectedMeta}>
                        <span className={styles.templateSelectedName}>{serviceTemplateName}</span>
                        {serviceTemplateSlug && (
                          <span className={styles.templateSelectedSlug}>{serviceTemplateSlug}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className={styles.templateClearBtn}
                        onClick={() => { setServiceTemplateName(""); setServiceTemplateSlug(""); }}
                        title="移除模板"
                      >
                        <MIcon name="close" size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.templateSelectBtn}
                      onClick={() => setShowTemplatePanel(true)}
                    >
                      <MIcon name="layers" size={16} />
                      瀏覽服務模板
                    </button>
                  )}
                </FieldGroup>

                <FieldGroup label="作業系統範本" required error={errors.ostemplate}
                  hint="請從已上傳到節點的範本中選擇">
                  <SelectField
                    value={form.ostemplate}
                    onChange={(v) => set("ostemplate", v)}
                    disabled={lxcLoading}
                    placeholder={lxcLoading ? "載入中…" : "選擇範本"}
                  >
                    {lxcTemplates.map((t) => (
                      <option key={t.volid} value={t.volid}>
                        {t.volid.split("/").pop()?.replace(".tar.zst", "") ?? t.volid}
                      </option>
                    ))}
                    {!lxcLoading && lxcTemplates.length === 0 && (
                      <option value="" disabled>目前沒有可用範本</option>
                    )}
                  </SelectField>
                </FieldGroup>

                <FieldGroup label="OS 說明" hint="選填，例如：Ubuntu 22.04 LTS">
                  <input
                    className={styles.input}
                    placeholder="Ubuntu 22.04 LTS"
                    value={form.os_info}
                    onChange={(e) => set("os_info", e.target.value)}
                  />
                </FieldGroup>

                <FieldGroup label="Root 密碼" required error={errors.password}>
                  <input
                    className={styles.input}
                    type="password"
                    placeholder="至少 8 個字元"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                  />
                </FieldGroup>
              </div>
            )}

            {/* ── VM 欄位 ── */}
            {resourceType === "vm" && (
              <div className={styles.formSection}>
                <h2 className={styles.sectionTitle}>虛擬機設定</h2>

                <FieldGroup label="VM 名稱" required error={errors.hostname}>
                  <input
                    className={styles.input}
                    placeholder="web-server-01"
                    value={form.hostname}
                    onChange={(e) => set("hostname", e.target.value)}
                    onBlur={(e) => set("hostname", normalizeHostname(e.target.value))}
                  />
                </FieldGroup>

                <FieldGroup label="作業系統" required error={errors.template_id}>
                  <SelectField
                    value={form.template_id}
                    onChange={(v) => set("template_id", v)}
                    disabled={vmLoading}
                    placeholder={vmLoading ? "載入中…" : "選擇作業系統"}
                  >
                    {vmTemplates.map((t) => (
                      <option key={t.vmid} value={t.vmid}>{t.name}</option>
                    ))}
                    {!vmLoading && vmTemplates.length === 0 && (
                      <option value="" disabled>目前沒有可用範本</option>
                    )}
                  </SelectField>
                </FieldGroup>

                <FieldGroup label="OS 說明" hint="選填，例如：Ubuntu 22.04 LTS">
                  <input
                    className={styles.input}
                    placeholder="Ubuntu 22.04 LTS"
                    value={form.os_info}
                    onChange={(e) => set("os_info", e.target.value)}
                  />
                </FieldGroup>

                <div className={styles.formGrid}>
                  <FieldGroup label="使用者名稱" required error={errors.username}>
                    <input
                      className={styles.input}
                      placeholder="admin"
                      value={form.username}
                      onChange={(e) => set("username", e.target.value)}
                    />
                  </FieldGroup>

                  <FieldGroup label="密碼" required error={errors.password}>
                    <input
                      className={styles.input}
                      type="password"
                      placeholder="至少 8 個字元"
                      value={form.password}
                      onChange={(e) => set("password", e.target.value)}
                    />
                  </FieldGroup>
                </div>
              </div>
            )}

            {/* ── 硬體規格 ── */}
            <div className={styles.formSection}>
              <h2 className={styles.sectionTitle}>硬體規格</h2>

              <FieldGroup label="CPU 核心數" labelRight={`${form.cores} 核`}>
                <input
                  type="range" min={1} max={8} step={1}
                  className={styles.slider}
                  value={form.cores}
                  onChange={(e) => set("cores", Number(e.target.value))}
                />
                <div className={styles.sliderTicks}>
                  {[1, 2, 4, 8].map((v) => <span key={v}>{v}</span>)}
                </div>
              </FieldGroup>

              <FieldGroup label="記憶體" labelRight={`${(form.memory / 1024).toFixed(1)} GB`}>
                <input
                  type="range" min={512} max={32768} step={512}
                  className={styles.slider}
                  value={form.memory}
                  onChange={(e) => set("memory", Number(e.target.value))}
                />
                <div className={styles.sliderTicks}>
                  {["1GB", "8GB", "16GB", "32GB"].map((v) => <span key={v}>{v}</span>)}
                </div>
              </FieldGroup>

              {resourceType === "lxc" ? (
                <FieldGroup label="磁碟空間（Rootfs）">
                  <div className={styles.diskRow}>
                    <input
                      type="range" min={8} max={500} step={1}
                      className={styles.slider}
                      value={form.rootfs_size}
                      onChange={(e) => set("rootfs_size", Number(e.target.value))}
                    />
                    <div className={styles.diskInput}>
                      <input
                        type="number" min={8} max={500}
                        className={`${styles.input} ${styles.inputNumber}`}
                        value={form.rootfs_size}
                        onChange={(e) => set("rootfs_size", Math.min(500, Math.max(8, Number(e.target.value) || 8)))}
                      />
                      <span className={styles.diskUnit}>GB</span>
                    </div>
                  </div>
                </FieldGroup>
              ) : (
                <FieldGroup label="磁碟空間">
                  <div className={styles.diskRow}>
                    <input
                      type="range" min={20} max={500} step={1}
                      className={styles.slider}
                      value={form.disk_size}
                      onChange={(e) => set("disk_size", Number(e.target.value))}
                    />
                    <div className={styles.diskInput}>
                      <input
                        type="number" min={20} max={500}
                        className={`${styles.input} ${styles.inputNumber}`}
                        value={form.disk_size}
                        onChange={(e) => set("disk_size", Math.min(500, Math.max(20, Number(e.target.value) || 20)))}
                      />
                      <span className={styles.diskUnit}>GB</span>
                    </div>
                  </div>
                </FieldGroup>
              )}
            </div>

            {/* ── GPU（VM only）── */}
            {resourceType === "vm" && (
              <div className={styles.formSection}>
                <h2 className={styles.sectionTitle}>GPU 加速（選填）</h2>

                {!canLoadGpu && mode === "scheduled" && (
                  <p className={styles.fieldHint}>請先選擇租借時段，再載入該時段可用的 GPU。</p>
                )}
                {canLoadGpu && !gpuLoading && gpuOptions.length === 0 && (
                  <p className={styles.fieldHint}>此時段目前沒有可用 GPU，可改選其他時段或不使用 GPU。</p>
                )}

                <FieldGroup
                  label="選擇 GPU"
                  hint="GPU 會依所選時段重新計算可用性，送出前仍會再做一次檢查"
                >
                  <SelectField
                    value={form.gpu_mapping_id || "__none__"}
                    onChange={(v) => set("gpu_mapping_id", v === "__none__" ? "" : v)}
                    disabled={!canLoadGpu || gpuLoading || gpuOptions.length === 0}
                    placeholder={canLoadGpu ? undefined : "請先選擇時段"}
                  >
                    <option value="__none__">不需要 GPU</option>
                    {gpuOptions.map((gpu) => (
                      <option
                        key={gpu.mapping_id}
                        value={gpu.mapping_id}
                        disabled={gpu.available_count <= 0}
                      >
                        {gpu.description || gpu.mapping_id}
                        {gpu.total_vram_mb > 0
                          ? ` (${gpu.total_vram_mb >= 1024 ? `${(gpu.total_vram_mb / 1024).toFixed(0)} GB` : `${gpu.total_vram_mb} MB`})`
                          : gpu.vram ? ` (${gpu.vram})` : ""}
                        {` [${gpu.available_count}/${gpu.device_count} 可用]`}
                        {gpu.available_count <= 0 ? " — 已滿" : ""}
                      </option>
                    ))}
                  </SelectField>
                </FieldGroup>
              </div>
            )}

            {/* ── 時段選擇 ── */}
            <div className={styles.formSection}>
              <h2 className={styles.sectionTitle}>
                {mode === "immediate" ? "立即模式設定" : "租借時段"}
              </h2>

              {mode === "immediate" ? (
                <>
                  <p className={styles.fieldHint}>
                    立即模式會在送出申請後馬上開始部署，不需要選擇開始時間。
                  </p>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={form.immediate_no_end}
                      onChange={(e) => set("immediate_no_end", e.target.checked)}
                    />
                    無限期 (No end date)
                  </label>
                  {!form.immediate_no_end && (
                    <FieldGroup label="結束時間" error={errors.end_at}>
                      <input
                        type="datetime-local"
                        className={styles.input}
                        value={form.end_at}
                        onChange={(e) => set("end_at", e.target.value)}
                      />
                    </FieldGroup>
                  )}
                </>
              ) : (
                <div className={styles.formGrid}>
                  <FieldGroup label="開始時間" required error={errors.start_at}>
                    <input
                      type="datetime-local"
                      className={styles.input}
                      value={form.start_at}
                      onChange={(e) => set("start_at", e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                    />
                  </FieldGroup>
                  <FieldGroup label="結束時間" required error={errors.end_at}>
                    <input
                      type="datetime-local"
                      className={styles.input}
                      value={form.end_at}
                      onChange={(e) => set("end_at", e.target.value)}
                      min={form.start_at || new Date().toISOString().slice(0, 16)}
                    />
                  </FieldGroup>
                </div>
              )}
            </div>

            {/* ── 申請原因 ── */}
            <div className={styles.formSection}>
              <h2 className={styles.sectionTitle}>申請原因</h2>
              <FieldGroup label="申請原因" required error={errors.reason}>
                <textarea
                  className={styles.textarea}
                  rows={4}
                  placeholder="請說明申請用途（至少 10 個字元）…"
                  value={form.reason}
                  onChange={(e) => set("reason", e.target.value)}
                />
                <div className={styles.charCount}>{form.reason.length} 字</div>
              </FieldGroup>
            </div>

          </form>

          {submitError && (
            <div className={styles.submitError}>
              <MIcon name="error_outline" size={16} />
              {submitError}
            </div>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={handleBack}>取消</button>
            <button
              type="submit"
              form="request-form"
              className={styles.btnPrimary}
              disabled={submitting}
            >
              {submitting
                ? <><MIcon name="hourglass_empty" size={16} />送出中…</>
                : <><MIcon name="send" size={16} />送出申請</>
              }
            </button>
          </div>
        </div>

        {/* AI 側欄 */}
        {aiOpen && <AiSidePanel />}
      </div>

      {/* 浮動 AI Tab */}
      <button
        type="button"
        className={`${styles.aiFloatingTab} ${aiOpen ? styles.aiFloatingTabOpen : ""}`}
        onClick={() => setAiOpen((v) => !v)}
      >
        <MIcon name="smart_toy" size={16} />
        <span>{aiOpen ? "收起 AI 助手" : "AI 助手"}</span>
        <MIcon name={aiOpen ? "keyboard_arrow_down" : "keyboard_arrow_up"} size={16} />
      </button>

      {/* 服務模板選擇面板 */}
      {showTemplatePanel && (
        <FastTemplatesPanel
          onClose={() => setShowTemplatePanel(false)}
          onSelect={handleSelectTemplate}
        />
      )}
    </div>
  );
}
