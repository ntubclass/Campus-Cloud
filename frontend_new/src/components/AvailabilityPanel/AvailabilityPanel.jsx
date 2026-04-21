/**
 * AvailabilityPanel — 月曆 + 時間選擇器版
 * Props:
 *   draft     { resource_type, cores, memory, disk_size?, rootfs_size?, gpu_required? }
 *   onChange  ({ start_at: string|null, end_at: string|null }) => void
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { VmRequestAvailabilityService } from "../../services/vmRequestAvailability";
import styles from "./AvailabilityPanel.module.scss";

const MIcon = ({ name, size = 16 }) => (
  <span className="material-icons-outlined" style={{ fontSize: size, lineHeight: 1 }}>
    {name}
  </span>
);

const MONTH_NAMES = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
const DAY_HEADERS = ["日","一","二","三","四","五","六"];

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isDraftReady(draft) {
  if (!draft?.resource_type || !draft?.cores || !draft?.memory) return false;
  return draft.resource_type === "vm" ? Boolean(draft.disk_size) : Boolean(draft.rootfs_size);
}

export default function AvailabilityPanel({ draft, onChange }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toDateStr(today), [today]);

  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate]     = useState(null);
  const [startHour, setStartHour] = useState(null);
  const [endHour, setEndHour]     = useState(null);
  const [hoverDate, setHoverDate] = useState(null);
  const [picking, setPicking]     = useState("start");

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  /* ── Fetch ── */
  const draftReady = isDraftReady(draft);
  const draftKey = draftReady
    ? `${draft.resource_type}|${draft.cores}|${draft.memory}|${draft.disk_size ?? ""}|${draft.rootfs_size ?? ""}|${draft.gpu_required ?? 0}`
    : null;

  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setStartDate(null); setEndDate(null); setStartHour(null); setEndHour(null);
    VmRequestAvailabilityService.preview(draft)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Day map ── */
  const dayMap = useMemo(() => {
    const map = {};
    data?.days.forEach((d) => { map[d.date] = d; });
    return map;
  }, [data]);

  function getDayLevel(dateStr) {
    const day = dayMap[dateStr];
    if (!day) return null;
    const total     = day.slots.length;
    const available = day.slots.filter((s) => s.status === "available").length;
    const selectable = day.slots.filter((s) => s.status === "available" || s.status === "limited").length;
    if (selectable === 0) return "none";
    if (available / total >= 0.5) return "good";
    return "limited";
  }

  function getSelectableHours(dateStr) {
    return (dayMap[dateStr]?.slots ?? [])
      .filter((s) => s.status === "available" || s.status === "limited")
      .map((s) => s.hour)
      .sort((a, b) => a - b);
  }

  /* ── Calendar grid ── */
  const calendarDays = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const last  = new Date(viewYear, viewMonth + 1, 0);
    const days  = Array(first.getDay()).fill(null);
    for (let d = 1; d <= last.getDate(); d++) days.push(new Date(viewYear, viewMonth, d));
    return days;
  }, [viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  /* ── Day click ── */
  function handleDayClick(dateStr, level) {
    if (!level || level === "none") return;
    if (picking === "start" || !startDate) {
      setStartDate(dateStr); setEndDate(null);
      setStartHour(null);   setEndHour(null);
      setPicking("end");
    } else if (dateStr < startDate) {
      setStartDate(dateStr); setEndDate(null);
      setStartHour(null);   setEndHour(null);
    } else if (dateStr === startDate) {
      setEndDate(null);
    } else {
      setEndDate(dateStr);
      setPicking("start");
    }
  }

  /* ── Notify parent ── */
  useEffect(() => {
    if (!startDate || !endDate || startHour == null || endHour == null) {
      onChangeRef.current?.({ start_at: null, end_at: null });
      return;
    }
    const startSlot = dayMap[startDate]?.slots.find((s) => s.hour === startHour);
    const endSlot   = dayMap[endDate]?.slots.find((s) => s.hour === endHour);
    onChangeRef.current?.({
      start_at: startSlot?.start_at ?? null,
      end_at:   endSlot?.end_at     ?? null,
    });
  }, [startDate, endDate, startHour, endHour, dayMap]);

  /* ── Early returns ── */
  if (!draftReady) return (
    <div className={styles.root}>
      <p className={styles.hint}>先填完基本規格後，再選日期與連續時段。</p>
    </div>
  );
  if (loading) return (
    <div className={styles.root}>
      <div className={styles.skeletonWrap}>
        <div className={`${styles.skeleton} ${styles.skeletonCalendar}`} />
      </div>
    </div>
  );
  if (error || !data) return (
    <div className={styles.root}>
      <p className={`${styles.hint} ${styles.hintError}`}>目前無法取得時段資料，請稍後再試。</p>
    </div>
  );

  const effectiveEnd  = endDate ?? (picking === "end" && hoverDate > startDate ? hoverDate : null);
  const startHours    = startDate ? getSelectableHours(startDate) : [];
  const endHours      = endDate   ? getSelectableHours(endDate)   : [];
  const isComplete    = startDate && endDate && startHour != null && endHour != null;

  return (
    <div className={styles.root}>

      {/* ── Calendar ── */}
      <div className={styles.calendar}>
        <div className={styles.calendarNav}>
          <button type="button" className={styles.calendarNavBtn} onClick={prevMonth}>
            <MIcon name="chevron_left" size={18} />
          </button>
          <span className={styles.calendarTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
          <button type="button" className={styles.calendarNavBtn} onClick={nextMonth}>
            <MIcon name="chevron_right" size={18} />
          </button>
        </div>

        <div className={styles.calendarGrid}>
          {DAY_HEADERS.map((h) => (
            <div key={h} className={styles.calendarDayHeader}>{h}</div>
          ))}
          {calendarDays.map((d, i) => {
            if (!d) return <div key={`pad-${i}`} />;
            const dateStr  = toDateStr(d);
            const level    = getDayLevel(dateStr);
            const isPast   = dateStr < todayStr;
            const disabled = isPast || !level || level === "none";
            const isStart  = dateStr === startDate;
            const isEnd    = dateStr === endDate;
            const inRange  = startDate && effectiveEnd
              && dateStr > startDate && dateStr < effectiveEnd;
            const isPreview = !endDate && inRange;

            return (
              <button
                key={dateStr}
                type="button"
                disabled={disabled}
                className={[
                  styles.calendarDay,
                  !disabled && level === "good"    ? styles.calendarDayGood    : "",
                  !disabled && level === "limited" ? styles.calendarDayLimited : "",
                  !disabled && level === "none"    ? styles.calendarDayNone    : "",
                  isStart    ? styles.calendarDayStart   : "",
                  isEnd      ? styles.calendarDayEnd     : "",
                  inRange && !isPreview ? styles.calendarDayInRange   : "",
                  isPreview  ? styles.calendarDayPreview : "",
                  disabled   ? styles.calendarDayDisabled : "",
                ].filter(Boolean).join(" ")}
                onClick={() => handleDayClick(dateStr, level)}
                onMouseEnter={() => picking === "end" && setHoverDate(dateStr)}
                onMouseLeave={() => setHoverDate(null)}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className={styles.legend}>
        {[
          { cls: styles.calendarDayGood,    label: "可申請" },
          { cls: styles.calendarDayLimited, label: "名額有限" },
          { cls: styles.calendarDayNone,    label: "已滿" },
        ].map(({ cls, label }) => (
          <div key={label} className={styles.legendItem}>
            <span className={`${styles.legendDot} ${cls}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Time pickers ── */}
      {(startDate || endDate) && (
        <div className={styles.timeRow}>
          <div className={styles.timeGroup}>
            <span className={styles.timeLabel}>開始</span>
            <span className={styles.timeDate}>{startDate ?? "—"}</span>
            <select
              className={styles.timeSelect}
              value={startHour ?? ""}
              disabled={!startDate}
              onChange={(e) => setStartHour(Number(e.target.value))}
            >
              <option value="" disabled>選擇時間</option>
              {startHours.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </div>
          <div className={styles.timeGroup}>
            <span className={styles.timeLabel}>結束</span>
            <span className={styles.timeDate}>{endDate ?? "—"}</span>
            <select
              className={styles.timeSelect}
              value={endHour ?? ""}
              disabled={!endDate}
              onChange={(e) => setEndHour(Number(e.target.value))}
            >
              <option value="" disabled>選擇時間</option>
              {endHours.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ── Summary ── */}
      {isComplete && (
        <div className={styles.summary}>
          <MIcon name="check_circle" size={14} />
          <span>
            {startDate} {String(startHour).padStart(2, "0")}:00
            {" → "}
            {endDate} {String(endHour).padStart(2, "0")}:00
          </span>
        </div>
      )}

      {/* ── Prompt ── */}
      {!startDate && (
        <p className={styles.hint}>點選開始日期</p>
      )}
      {startDate && !endDate && (
        <p className={styles.hint}>再點選結束日期</p>
      )}
    </div>
  );
}
