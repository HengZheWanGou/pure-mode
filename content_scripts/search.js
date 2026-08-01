// B站专注模式 — 搜索结果页重构脚本
// 方案：隐藏原生页面，抽取视频数据后用插件风格完全重排
// 广告/直播/课程卡片不进入渲染（自然消除空洞）
// 仅作用于 search.bilibili.com

(function () {
  'use strict';

  const STORAGE_KEY = 'biliFocusMode';
  const HIDE_STYLE_ID = 'bfm-hide-native';
  const STYLE_ID = 'bfm-search-style';
  const ROOT_ID = 'bfm-search-root';

  const THEMES = {
    light: {
      bg: '#F7F7F8', surface: '#FFFFFF', border: '#E8E8E8',
      text: '#1A1A1E', textSecondary: '#8C8C8C',
      shadow: '0 4px 20px rgba(0,0,0,0.06)', focusBorder: '#FB7299',
      btnBg: '#F0F0F1', btnHover: '#E6E6E8'
    },
    dark: {
      bg: '#0D0D0D', surface: '#1A1A1E', border: '#2D2D33',
      text: '#E8E8E8', textSecondary: '#888888',
      shadow: '0 4px 20px rgba(0,0,0,0.3)', focusBorder: '#FB7299',
      btnBg: '#2D2D33', btnHover: '#3D3D45'
    },
    paper: {
      bg: '#F5F3EF', surface: '#FFFFFF', border: '#E0DCD5',
      text: '#1A1A1E', textSecondary: '#8C8C8C',
      shadow: '0 4px 20px rgba(0,0,0,0.04)', focusBorder: '#FB7299',
      btnBg: '#E8E4DE', btnHover: '#DDD9D3'
    }
  };

  let currentTheme = 'light';
  let isActive = false;
  let watchObserver = null;
  let nextPage = 1;
  let loading = false;
  const seenBV = new Set();

  // ===== 第 0 步：立即隐藏原生页面（不等 storage，避免闪烁） =====
  injectHideStyle();

  function injectHideStyle() {
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = `
      .search-page-wrapper, #bili-header-container,
      #biliMainFooter, .biliMainFooterWrapper { display: none !important; }
      html, body { background: #F7F7F8; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeHideStyle() {
    document.getElementById(HIDE_STYLE_ID)?.remove();
  }

  // ===== 主入口 =====
  async function main() {
    try {
      const data = await getStorageData();
      if (data.enabled === false) {
        removeHideStyle();
        listenForEnable();
        return;
      }
      isActive = true;
      currentTheme = data.theme || 'light';
      nextPage = getCurrentPage() + 1;
      await injectStyles();
      applyTheme(currentTheme);
      whenReady(buildUI);
      listenForDisable();
      listenForThemeChange();
    } catch (e) {
      console.error('[B站专注模式] 搜索页重构失败:', e);
      removeHideStyle(); // 失败兜底：恢复原生页面
    }
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  // ===== 注入重构样式 =====
  async function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const url = chrome.runtime.getURL('content_scripts/search.css');
    const css = await (await fetch(url)).text();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ===== 构建自建页面 =====
  function buildUI() {
    if (document.getElementById(ROOT_ID)) return;
    const keyword = getKeyword();

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <header class="bfm-header">
        <a class="bfm-logo" href="https://www.bilibili.com/" title="回到B站主页">bilibili</a>
        <div class="bfm-search-box">
          <svg class="bfm-search-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/>
            <path d="M14 14L18 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <input class="bfm-search-input" type="text" autocomplete="off"
                 placeholder="搜索视频、UP主、番剧..." value="${escapeAttr(keyword)}"/>
        </div>
        <div class="bfm-themes">
          <button data-theme="light" title="纯白">☀️</button>
          <button data-theme="dark" title="深色">🌙</button>
          <button data-theme="paper" title="纸张">📄</button>
        </div>
      </header>
      <main class="bfm-results" id="bfm-results"></main>
      <div class="bfm-empty" id="bfm-empty" hidden>没有找到相关视频，换个关键词试试</div>
      <div class="bfm-loadmore-wrap">
        <button class="bfm-loadmore" id="bfm-loadmore" hidden>加载更多</button>
      </div>
    `;
    document.body.appendChild(root);

    // 搜索交互
    const input = root.querySelector('.bfm-search-input');
    const doSearch = () => {
      const kw = input.value.trim();
      if (kw) window.location.href =
        `https://search.bilibili.com/all?keyword=${encodeURIComponent(kw)}`;
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    root.querySelector('.bfm-search-icon').addEventListener('click', doSearch);

    // 主题按钮
    root.querySelectorAll('.bfm-themes button').forEach(btn => {
      btn.addEventListener('click', async () => {
        applyTheme(btn.dataset.theme);
        await saveStorageData({ theme: btn.dataset.theme });
      });
    });
    syncThemeButtons();

    // 加载更多
    root.querySelector('#bfm-loadmore').addEventListener('click', loadMore);

    // 开始抓取当前页卡片（结果异步渲染，需等待出现）
    waitForCards();
  }

  // ===== 等待并抓取原生结果卡片 =====
  function waitForCards() {
    const found = harvestCards(document);
    if (found > 0) return;

    let elapsed = 0;
    watchObserver = new MutationObserver(() => {
      if (!isActive) return;
      if (harvestCards(document) > 0) {
        watchObserver.disconnect();
        watchObserver = null;
      }
    });
    watchObserver.observe(document.documentElement, { childList: true, subtree: true });

    // 8 秒仍无结果 → 显示空态
    const timer = setInterval(() => {
      elapsed += 500;
      if (!watchObserver) { clearInterval(timer); return; }
      if (elapsed >= 8000) {
        clearInterval(timer);
        watchObserver.disconnect();
        watchObserver = null;
        document.getElementById('bfm-empty')?.removeAttribute('hidden');
      }
    }, 500);
  }

  // 从文档中收割新卡片并渲染，返回新增数量
  function harvestCards(doc) {
    const cards = parseCards(doc);
    const fresh = cards.filter(c => !seenBV.has(c.bv));
    fresh.forEach(c => seenBV.add(c.bv));
    if (fresh.length > 0) {
      appendCards(fresh);
      document.getElementById('bfm-loadmore')?.removeAttribute('hidden');
    }
    return fresh.length;
  }

  // ===== 解析视频卡片（广告/直播/课程直接跳过） =====
  function parseCards(doc) {
    const out = [];
    doc.querySelectorAll('.bili-video-card').forEach(card => {
      // 广告特征：商业跳转链接或广告标识块
      if (card.querySelector('a[href*="cm.bilibili.com"], .bili-video-card__info--ad')) return;

      const linkEl = card.querySelector('a[href*="/video/BV"]');
      if (!linkEl) return; // 直播/课程/活动卡片：不属于视频结果，跳过

      const bv = (linkEl.href.match(/BV[0-9A-Za-z]+/) || [])[0];
      if (!bv) return;

      const titleEl = card.querySelector('.bili-video-card__info--tit');
      const title = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim();

      const img = card.querySelector('.bili-video-card__image img, .v-img img, img');
      let cover = img?.currentSrc || img?.src || img?.dataset?.src || img?.getAttribute('data-src') || '';
      if (cover.startsWith('//')) cover = 'https:' + cover;

      const duration = card.querySelector('.bili-video-card__stats__duration')?.textContent.trim() || '';
      const stats = [...card.querySelectorAll('.bili-video-card__stats--item')]
        .map(e => e.textContent.trim());
      const author = card.querySelector('.bili-video-card__info--author')?.textContent.trim() || '';
      const date = card.querySelector('.bili-video-card__info--date')?.textContent.trim() || '';

      if (title) {
        out.push({ bv, url: `https://www.bilibili.com/video/${bv}/`, title, cover,
                   duration, play: stats[0] || '', danmaku: stats[1] || '', author, date });
      }
    });
    return out;
  }

  // ===== 渲染卡片 =====
  function appendCards(cards) {
    const container = document.getElementById('bfm-results');
    if (!container) return;
    const keyword = getKeyword();
    const frag = document.createDocumentFragment();

    cards.forEach(c => {
      const el = document.createElement('a');
      el.className = 'bfm-card';
      el.href = c.url;
      el.target = '_blank';
      el.rel = 'noopener';
      el.innerHTML = `
        <div class="bfm-cover">
          ${c.cover ? `<img src="${escapeAttr(coverProxy(c.cover))}" loading="lazy" alt=""/>` : ''}
          ${c.duration ? `<span class="bfm-duration">${escapeHTML(c.duration)}</span>` : ''}
        </div>
        <div class="bfm-info">
          <div class="bfm-title">${highlightKeyword(c.title, keyword)}</div>
          <div class="bfm-meta">
            ${c.play ? `<span>▶ ${escapeHTML(c.play)}</span>` : ''}
            ${c.danmaku ? `<span>💬 ${escapeHTML(c.danmaku)}</span>` : ''}
          </div>
          <div class="bfm-author">
            ${c.author ? `<span>${escapeHTML(c.author)}</span>` : ''}
            ${c.date ? `<span>${escapeHTML(c.date)}</span>` : ''}
          </div>
        </div>
      `;
      frag.appendChild(el);
    });
    container.appendChild(frag);
  }

  // B站封面图鉴权：加尺寸后缀，缩小流量
  function coverProxy(url) {
    return url.includes('@') ? url : url + '@480w_270h_1c';
  }

  // ===== 加载更多（抓下一页 HTML 解析） =====
  async function loadMore() {
    if (loading) return;
    loading = true;
    const btn = document.getElementById('bfm-loadmore');
    const oldText = btn.textContent;
    btn.textContent = '加载中…';
    try {
      const url = new URL(location.href);
      url.searchParams.set('page', String(nextPage));
      const html = await (await fetch(url.toString(), { credentials: 'include' })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const added = harvestCards(doc);
      if (added === 0) {
        btn.textContent = '没有更多了';
        btn.disabled = true;
        return;
      }
      nextPage++;
      btn.textContent = oldText;
    } catch (e) {
      console.error('[B站专注模式] 加载更多失败:', e);
      btn.textContent = '加载失败，点击重试';
    } finally {
      loading = false;
    }
  }

  // ===== 工具 =====
  function getKeyword() {
    return new URL(location.href).searchParams.get('keyword') || '';
  }

  function getCurrentPage() {
    return parseInt(new URL(location.href).searchParams.get('page') || '1', 10) || 1;
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, ch =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function escapeAttr(s) { return escapeHTML(s); }

  function highlightKeyword(title, keyword) {
    let html = escapeHTML(title);
    if (!keyword) return html;
    const kw = escapeHTML(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      html = html.replace(new RegExp(`(${kw})`, 'gi'), '<em class="bfm-kw">$1</em>');
    } catch { /* 关键词含特殊字符时跳过高亮 */ }
    return html;
  }

  // ===== 主题 =====
  function applyTheme(name) {
    const t = THEMES[name];
    if (!t) return;
    const root = document.documentElement;
    root.style.setProperty('--bfm-bg', t.bg);
    root.style.setProperty('--bfm-surface', t.surface);
    root.style.setProperty('--bfm-border', t.border);
    root.style.setProperty('--bfm-text', t.text);
    root.style.setProperty('--bfm-text-secondary', t.textSecondary);
    root.style.setProperty('--bfm-shadow', t.shadow);
    root.style.setProperty('--bfm-focus-border', t.focusBorder);
    root.style.setProperty('--bfm-btn-bg', t.btnBg);
    root.style.setProperty('--bfm-btn-hover', t.btnHover);
    root.setAttribute('data-bfm-theme', name);
    currentTheme = name;
    syncThemeButtons();
  }

  function syncThemeButtons() {
    document.querySelectorAll(`#${ROOT_ID} .bfm-themes button`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });
  }

  // ===== 清理（禁用插件时完整恢复原生页面） =====
  function cleanup() {
    isActive = false;
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    removeHideStyle();
    document.documentElement.removeAttribute('data-bfm-theme');
    if (watchObserver) { watchObserver.disconnect(); watchObserver = null; }
  }

  // ===== 监听 =====
  function listenForEnable() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const change = changes[STORAGE_KEY];
      if (change?.newValue?.enabled === true && !isActive) location.reload();
    });
  }

  function listenForDisable() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const change = changes[STORAGE_KEY];
      if (change?.newValue?.enabled === false && isActive) cleanup();
    });
  }

  function listenForThemeChange() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const newTheme = changes[STORAGE_KEY]?.newValue?.theme;
      if (newTheme && newTheme !== currentTheme && isActive) applyTheme(newTheme);
    });
  }

  // ===== Storage =====
  function getStorageData() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
          resolve(result[STORAGE_KEY] || { enabled: true, theme: 'light' });
        });
      } else {
        resolve({ enabled: true, theme: 'light' });
      }
    });
  }

  function saveStorageData(data) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.sync) return resolve();
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        const current = result[STORAGE_KEY] || { enabled: true, theme: 'light' };
        chrome.storage.sync.set({ [STORAGE_KEY]: { ...current, ...data } }, resolve);
      });
    });
  }

  main();
})();
