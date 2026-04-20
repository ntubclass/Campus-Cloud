/**
 * FastTemplatesPanel
 * 服務模板選擇面板（Modal overlay）
 * 資料來自 virtual:templates（讀取 frontend/src/json/）
 */
import { useMemo, useState } from "react";
import rawData from "virtual:templates";
import styles from "./FastTemplatesPanel.module.scss";

const MIcon = ({ name, size = 20 }) => (
  <span className="material-icons-outlined" style={{ fontSize: size, lineHeight: 1 }}>
    {name}
  </span>
);

/* ── 解析原始資料 ── */
const metadataFile = rawData["metadata.json"] ?? { categories: [] };
const CATEGORIES = [...metadataFile.categories].sort((a, b) => a.sort_order - b.sort_order);

const TEMPLATES = Object.entries(rawData)
  .filter(([key]) => key !== "metadata.json" && key !== "versions.json" && key !== "github-versions.json")
  .map(([, val]) => val)
  .filter(Boolean)
  .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

/* ── 分類對照表 ── */
const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.id, c]));

export default function FastTemplatesPanel({ onSelect, onClose }) {
  const [search, setSearch]       = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [selected, setSelected]   = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TEMPLATES.filter((t) => {
      const matchSearch =
        !q ||
        (t.name || "").toLowerCase().includes(q) ||
        (t.description_zh || t.description || "").toLowerCase().includes(q) ||
        (t.slug || "").toLowerCase().includes(q);
      const matchCat =
        categoryId === "all" ||
        (t.categories || []).includes(Number(categoryId));
      return matchSearch && matchCat;
    });
  }, [search, categoryId]);

  function handleConfirm() {
    if (!selected) return;
    onSelect(selected);
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.headerIcon}><MIcon name="layers" size={16} /></span>
          <span className={styles.headerTitle}>選擇服務模板</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
            <MIcon name="close" size={18} />
          </button>
        </div>

        {/* Filters */}
        <div className={styles.filters}>
          <div className={styles.searchWrap}>
            <MIcon name="search" size={16} />
            <input
              className={styles.searchInput}
              placeholder="搜尋模板名稱或描述…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
              autoFocus
            />
            {search && (
              <button type="button" className={styles.searchClear} onClick={() => setSearch("")}>
                <MIcon name="close" size={14} />
              </button>
            )}
          </div>
          <select
            className={styles.categorySelect}
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); setSelected(null); }}
          >
            <option value="all">所有分類</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Template list + detail */}
        <div className={styles.body}>
          {/* List */}
          <div className={styles.list}>
            {filtered.length === 0 ? (
              <div className={styles.empty}>
                <MIcon name="search_off" size={32} />
                <span>找不到符合的模板</span>
              </div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  className={`${styles.item} ${selected?.slug === t.slug ? styles.itemActive : ""}`}
                  onClick={() => setSelected(t)}
                  onDoubleClick={() => { setSelected(t); onSelect(t); }}
                >
                  {t.logo ? (
                    <img src={t.logo} alt="" className={styles.itemLogo} onError={(e) => { e.target.style.display = "none"; }} />
                  ) : (
                    <div className={styles.itemLogoFallback}><MIcon name="layers" size={16} /></div>
                  )}
                  <div className={styles.itemMeta}>
                    <span className={styles.itemName}>{t.name}</span>
                    {t.categories?.[0] && (
                      <span className={styles.itemCat}>
                        {CATEGORY_MAP.get(t.categories[0])?.name ?? ""}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Detail */}
          <div className={styles.detail}>
            {selected ? (
              <>
                <div className={styles.detailHeader}>
                  {selected.logo && (
                    <img src={selected.logo} alt="" className={styles.detailLogo} />
                  )}
                  <div>
                    <h3 className={styles.detailName}>{selected.name}</h3>
                    <span className={styles.detailSlug}>{selected.slug}</span>
                  </div>
                </div>
                <p className={styles.detailDesc}>
                  {selected.description_zh || selected.description || "（無說明）"}
                </p>
                {selected.install_methods?.[0]?.resources && (
                  <div className={styles.detailSpecs}>
                    <h4 className={styles.detailSpecsTitle}>預設規格</h4>
                    <div className={styles.detailSpecGrid}>
                      {selected.install_methods[0].resources.cpu && (
                        <div className={styles.detailSpecItem}>
                          <span className={styles.detailSpecLabel}>CPU</span>
                          <span className={styles.detailSpecValue}>{selected.install_methods[0].resources.cpu} 核</span>
                        </div>
                      )}
                      {selected.install_methods[0].resources.ram && (
                        <div className={styles.detailSpecItem}>
                          <span className={styles.detailSpecLabel}>記憶體</span>
                          <span className={styles.detailSpecValue}>{selected.install_methods[0].resources.ram} MB</span>
                        </div>
                      )}
                      {selected.install_methods[0].resources.hdd && (
                        <div className={styles.detailSpecItem}>
                          <span className={styles.detailSpecLabel}>磁碟</span>
                          <span className={styles.detailSpecValue}>{selected.install_methods[0].resources.hdd} GB</span>
                        </div>
                      )}
                      {selected.install_methods[0].resources.os && (
                        <div className={styles.detailSpecItem}>
                          <span className={styles.detailSpecLabel}>OS</span>
                          <span className={styles.detailSpecValue}>{selected.install_methods[0].resources.os}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.detailEmpty}>
                <MIcon name="layers" size={36} />
                <span>選擇一個模板以查看詳情</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.footerCount}>{filtered.length} 個模板</span>
          <div className={styles.footerActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>取消</button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={!selected}
              onClick={handleConfirm}
            >
              <MIcon name="check" size={16} />
              套用模板
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
