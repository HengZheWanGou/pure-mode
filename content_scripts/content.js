// B站专注模式 — 内容脚本
// 全屏覆盖层方案

(function () {
  'use strict';

  const STORAGE_KEY = 'biliFocusMode';
  const CONTAINER_ID = 'bili-focus-container';

  const THEMES = {
    light: {
      bg: '#FFFFFF', surface: '#FFFFFF', border: '#E8E8E8',
      text: '#1A1A1E', textSecondary: '#8C8C8C',
      shadow: '0 4px 20px rgba(0,0,0,0.06)', focusBorder: '#FB7299',
      avatarBorder: '#E8E8E8', btnBg: '#F5F5F5', btnHover: '#EEEEEE'
    },
    dark: {
      bg: '#0D0D0D', surface: '#1A1A1E', border: '#2D2D33',
      text: '#E8E8E8', textSecondary: '#888888',
      shadow: '0 4px 20px rgba(0,0,0,0.3)', focusBorder: '#FB7299',
      avatarBorder: '#333333', btnBg: '#2D2D33', btnHover: '#3D3D45'
    },
    paper: {
      bg: '#F5F3EF', surface: '#FFFFFF', border: '#E0DCD5',
      text: '#1A1A1E', textSecondary: '#8C8C8C',
      shadow: '0 4px 20px rgba(0,0,0,0.04)', focusBorder: '#FB7299',
      avatarBorder: '#E0DCD5', btnBg: '#E8E4DE', btnHover: '#DDD9D3'
    }
  };

  let currentTheme = 'light';
  let userAvatar = null;
  let userMid = null;
  let observer = null;
  let isActive = false;

  // ===== 主入口 =====
  async function main() {
    try {
      const data = await getStorageData();
      if (data.enabled === false) {
        listenForEnable();
        return;
      }
      isActive = true;
      currentTheme = data.theme || 'light';
      injectStyles();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
      } else {
        onReady();
      }
      listenForDisable();
    } catch (e) {
      console.error('[B站专注模式] 初始化失败:', e);
    }
  }

  function onReady() {
    try {
      // 1. 同步提取 mid（从 Cookie，不依赖 DOM）
      extractMidFromCookie();

      // 2. 立即构建覆盖层（此时头像可能是默认的）
      buildOverlay();
      protectOverlay();
      preventScroll();

      // 3. 异步获取真实头像并更新
      fetchAvatarAndUpdate();
    } catch (e) {
      console.error('[B站专注模式] 构建页面失败:', e);
    }
  }

  // ===== 从 Cookie 提取 mid =====
  function extractMidFromCookie() {
    const dedeMatch = document.cookie.match(/DedeUserID=(\d+)/);
    if (dedeMatch) userMid = dedeMatch[1];
  }

  // ===== 获取头像并更新（三层回退） =====
  async function fetchAvatarAndUpdate() {
    // 第1层：B站 API（最可靠，不依赖 DOM）
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (data.data && data.data.face) {
        userAvatar = data.data.face;
        if (data.data.mid) userMid = String(data.data.mid);
        updateAvatarInOverlay();
        return;
      }
    } catch (e) {
      console.log('[B站专注模式] API 获取头像失败，回退到 DOM 查找');
    }

    // 第2层：立即从 DOM 查找
    tryFindAvatarFromDOM();
    if (userAvatar) {
      updateAvatarInOverlay();
      return;
    }

    // 第3层：延迟重试（等 B站 Vue 加载完头像）
    setTimeout(() => {
      tryFindAvatarFromDOM();
      if (userAvatar) updateAvatarInOverlay();
    }, 2000);
  }

  // ===== 从 DOM 查找头像 =====
  function tryFindAvatarFromDOM() {
    if (userAvatar) return; // 已找到则跳过

    function getImgSrc(img) {
      if (!img) return null;
      const src = img.currentSrc || img.src || img.dataset?.src || img.getAttribute('data-src');
      return src && (src.startsWith('http') || src.startsWith('//')) ? src : null;
    }

    // 优先查找右上角入口的头像
    const avatarSelectors = [
      '.right-entry img',
      '.header-right img',
      'img.bili-header__avatar',
      '.header-avatar img',
      '.avatar img',
      '.bili-header__face img',
      '.bili-header__avatar img',
      '.header-entry-avatar img',
      '.user-avatar img'
    ];

    for (const sel of avatarSelectors) {
      const img = document.querySelector(sel);
      const src = getImgSrc(img);
      if (src) {
        userAvatar = src.startsWith('//') ? 'https:' + src : src;
        return;
      }
    }

    // 兜底：遍历所有 img 找 face/avatar 特征
    const allImgs = document.querySelectorAll('img');
    for (const img of allImgs) {
      const src = getImgSrc(img);
      if (src && (src.includes('/face/') || src.includes('avatar'))) {
        userAvatar = src.startsWith('//') ? 'https:' + src : src;
        return;
      }
    }
  }

  // ===== 更新覆盖层中的头像 =====
  function updateAvatarInOverlay() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    const avatarLink = container.querySelector('.bfm-avatar');
    const avatarImg = container.querySelector('.bfm-avatar img');

    if (avatarLink && userMid) {
      avatarLink.href = `https://space.bilibili.com/${userMid}`;
      avatarLink.title = '个人空间';
    }

    if (avatarImg && userAvatar) {
      avatarImg.src = userAvatar;
    }
  }

  // ===== Storage =====
  function getStorageData() {
    return new Promise((resolve) => {
      const fallback = () => {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          resolve(raw ? JSON.parse(raw) : { enabled: true, theme: 'light' });
        } catch {
          resolve({ enabled: true, theme: 'light' });
        }
      };

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
          resolve(result[STORAGE_KEY] || { enabled: true, theme: 'light' });
        });
        setTimeout(fallback, 500);
      } else {
        fallback();
      }
    });
  }

  function saveStorageData(data) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
          const current = result[STORAGE_KEY] || { enabled: true, theme: 'light' };
          chrome.storage.sync.set({ [STORAGE_KEY]: { ...current, ...data } }, resolve);
        });
      } else {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const current = raw ? JSON.parse(raw) : { enabled: true, theme: 'light' };
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...data }));
        } catch { /* ignore */ }
        resolve();
      }
    });
  }

  // ===== 监听开关 =====
  function listenForEnable() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const change = changes[STORAGE_KEY];
      if (change && change.newValue && change.newValue.enabled === true && !isActive) {
        location.reload();
      }
    });
  }

  function listenForDisable() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const change = changes[STORAGE_KEY];
      if (change && change.newValue && change.newValue.enabled === false && isActive) {
        cleanup();
      }
    });
  }

  // ===== 清理 =====
  function cleanup() {
    isActive = false;
    const container = document.getElementById(CONTAINER_ID);
    if (container) container.remove();
    if (observer) { observer.disconnect(); observer = null; }
    document.body.style.overflow = '';
    document.body.style.height = '';
    document.documentElement.style.overflow = '';
    const injectedStyle = document.getElementById('bili-focus-style');
    if (injectedStyle) injectedStyle.remove();
  }

  // ===== 构建覆盖层 =====
  function buildOverlay() {
    removeExisting();
    const el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.innerHTML = renderHTML();
    document.body.appendChild(el);
    applyTheme(currentTheme);
    bindEvents(el);
  }

  function removeExisting() {
    const old = document.getElementById(CONTAINER_ID);
    if (old) old.remove();
  }

  function renderHTML() {
    const avatarSrc = userAvatar || 'https://static.hdslb.com/images/member/noface.gif';
    const spaceUrl = userMid ? `https://space.bilibili.com/${userMid}` : 'https://passport.bilibili.com/login';

    return `
      <div class="bfm-logo">
        <svg width="110" height="30" viewBox="0 0 110 30" fill="none" xmlns="http://www.w3.org/2000/svg">
          <text x="0" y="23" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="bold" fill="#FB7299">bilibili</text>
        </svg>
      </div>

      <div class="bfm-search-box">
        <svg class="bfm-search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/>
          <path d="M14 14L18 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input type="text" class="bfm-search-input" placeholder="搜索视频、UP主、番剧..." autocomplete="off"/>
      </div>

      <a href="${spaceUrl}" class="bfm-avatar" target="_self" title="${userMid ? '个人空间' : '登录'}">
        <img src="${avatarSrc}" alt="avatar"/>
      </a>

      <div class="bfm-theme-switcher">
        <button class="bfm-theme-btn" data-theme="light" title="纯白">☀️</button>
        <button class="bfm-theme-btn" data-theme="dark" title="深色">🌙</button>
        <button class="bfm-theme-btn" data-theme="paper" title="纸张">📄</button>
      </div>
    `;
  }

  // ===== 保护覆盖层 =====
  function protectOverlay() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      if (!isActive) return;
      const container = document.getElementById(CONTAINER_ID);
      if (!container) {
        buildOverlay();
        return;
      }
      if (document.body.lastElementChild !== container) {
        document.body.appendChild(container);
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  function preventScroll() {
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';
    document.documentElement.style.overflow = 'hidden';
  }

  // ===== 主题 =====
  function applyTheme(name) {
    const t = THEMES[name];
    if (!t) return;
    const el = document.getElementById(CONTAINER_ID);
    if (!el) return;
    el.style.setProperty('--bfm-bg', t.bg);
    el.style.setProperty('--bfm-surface', t.surface);
    el.style.setProperty('--bfm-border', t.border);
    el.style.setProperty('--bfm-text', t.text);
    el.style.setProperty('--bfm-text-secondary', t.textSecondary);
    el.style.setProperty('--bfm-shadow', t.shadow);
    el.style.setProperty('--bfm-focus-border', t.focusBorder);
    el.style.setProperty('--bfm-avatar-border', t.avatarBorder);
    el.style.setProperty('--bfm-btn-bg', t.btnBg);
    el.style.setProperty('--bfm-btn-hover', t.btnHover);
    el.style.backgroundColor = t.bg;
    el.querySelectorAll('.bfm-theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === name);
    });
    currentTheme = name;
  }

  // ===== 事件绑定 =====
  function bindEvents(el) {
    const input = el.querySelector('.bfm-search-input');
    const icon = el.querySelector('.bfm-search-icon');

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch(input.value.trim());
      });
      setTimeout(() => input.focus(), 300);
    }

    if (icon) {
      icon.addEventListener('click', () => doSearch(input.value.trim()));
    }

    el.querySelectorAll('.bfm-theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.theme);
        saveStorageData({ theme: btn.dataset.theme });
      });
    });
  }

  function doSearch(keyword) {
    if (!keyword) {
      const input = document.querySelector('.bfm-search-input');
      if (input) input.focus();
      return;
    }
    window.location.href = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;
  }

  // ===== 注入样式 =====
  function injectStyles() {
    const css = `
      #bili-focus-container {
        position: fixed; top: 0; left: 0;
        width: 100vw; height: 100vh;
        z-index: 2147483647;
        display: flex; flex-direction: column;
        align-items: center; justify-content: flex-start;
        padding-top: 38vh;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        transition: background-color 0.3s ease;
      }
      .bfm-logo {
        position: absolute; top: 24px; left: 50%;
        transform: translateX(-50%);
        animation: bfmFadeIn 0.3s ease both;
      }
      .bfm-search-box {
        display: flex; align-items: center;
        width: 100%; max-width: 560px; height: 52px;
        padding: 0 20px; margin: 0 24px;
        background: var(--bfm-surface);
        border: 1.5px solid var(--bfm-border);
        border-radius: 12px;
        box-shadow: var(--bfm-shadow);
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        animation: bfmFadeInUp 0.4s ease-out 0.1s both;
      }
      .bfm-search-box:focus-within {
        border-color: var(--bfm-focus-border);
        box-shadow: 0 4px 24px rgba(251, 114, 153, 0.15);
      }
      .bfm-search-icon {
        flex-shrink: 0;
        color: var(--bfm-text-secondary);
        cursor: pointer;
        margin-right: 12px;
        transition: color 0.2s ease;
      }
      .bfm-search-box:focus-within .bfm-search-icon {
        color: var(--bfm-focus-border);
      }
      .bfm-search-input {
        flex: 1; border: none; outline: none;
        background: transparent;
        font-size: 16px;
        color: var(--bfm-text);
        caret-color: var(--bfm-focus-border);
      }
      .bfm-search-input::placeholder {
        color: var(--bfm-text-secondary);
      }
      .bfm-avatar {
        position: fixed; top: 24px; right: 24px;
        width: 40px; height: 40px;
        border-radius: 50%; overflow: hidden;
        border: 2px solid var(--bfm-avatar-border);
        cursor: pointer;
        transition: border-color 0.2s ease, transform 0.2s ease;
        z-index: 2147483648;
        text-decoration: none;
        animation: bfmFadeIn 0.3s ease 0.15s both;
      }
      .bfm-avatar:hover {
        border-color: var(--bfm-focus-border);
        transform: scale(1.05);
      }
      .bfm-avatar img {
        width: 100%; height: 100%;
        object-fit: cover;
      }
      .bfm-theme-switcher {
        position: fixed; bottom: 24px; right: 24px;
        display: flex; gap: 8px;
        z-index: 2147483648;
        animation: bfmFadeIn 0.3s ease 0.2s both;
      }
      .bfm-theme-btn {
        width: 36px; height: 36px;
        border-radius: 50%;
        border: 2px solid transparent;
        background: var(--bfm-btn-bg);
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }
      .bfm-theme-btn:hover {
        background: var(--bfm-btn-hover);
        transform: scale(1.1);
      }
      .bfm-theme-btn.active {
        border-color: var(--bfm-focus-border);
        background: rgba(251, 114, 153, 0.1);
      }
      @keyframes bfmFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes bfmFadeInUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .bili-header, .bili-header__bar, .header-channel, .channel-menu,
      .international-header, .mini-header, .nav-header-wrapper, .bili-header__channel,
      .recommended-swipe, .bili-banner, .banner-img, .home-banner, .eva-banner,
      .carousel-box, .focus-banner, .banner-item,
      .channel-icons, .channel-entry, .channel-grid, .channel-item, .popular-channel,
      .feed-card, .video-card, .bili-video-card, .bili-recommendation-container,
      .recommend-list, .feed2, .feed2-card, .large-card, .small-card,
      .card-list, .video-list, .bili-video-card__wrap,
      .channel-module, .home-zone-module, .zone-list, .zone-module,
      .popular-container, .guochuang-container, .douga-container, .music-container,
      .dance-container, .game-container, .tech-container, .digital-container,
      .life-container, .kichiku-container, .fashion-container, .ent-container,
      .cinephile-container, .documentary-container,
      .ad-report, .adcard, .ad-floor, .ad-banner, .sponsor-module, .pop-live, .guide-box,
      .footer, .bili-footer, .international-footer,
      .van-dialog, .bili-dialog-m, .to-top, .go-back, .login-tip, .bili-app, .download-tip,
      .popover-channel, .stretch, .header-login, .header-upload, .right-entry, .left-entry,
      .v-popover, .v-popover-wrap, .bili-header__avatar, .bili-header__face,
      .index__container, .index__feed, .index__channel, .index__recommend,
      .index__popular, .index__card, .index__banner, .index__carousel,
      .v-card, .vd-card, .video-page-card, .rec-list, .rec-card, .rank-list, .rank-card,
      .timeline-box, .timeline-card, .timeline-item {
        display: none !important;
      }
    `;

    const style = document.createElement('style');
    style.id = 'bili-focus-style';
    style.textContent = css;

    const tryInsert = () => {
      if (document.head) {
        document.head.appendChild(style);
      } else {
        setTimeout(tryInsert, 10);
      }
    };
    tryInsert();
  }

  main();

})();
