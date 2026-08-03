// B站专注模式 — 视频播放页净化脚本
// 方案：保留原生播放器，切除分心元素
//   - 相关推荐 / 评论区：默认折叠，点击展开
//   - 自动连播：强制关闭（点击播放器设置中的「播完暂停」）
//   - 顶部导航 / 结束页推荐 / 广告位：隐藏
// 仅作用于 www.bilibili.com/video/*

(function () {
  'use strict';

  const STORAGE_KEY = 'biliFocusMode';
  const HIDE_STYLE_ID = 'bfm-video-hide-native';
  const STYLE_ID = 'bfm-video-style';
  const HEADER_ID = 'bfm-video-header';

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
  let setupObserver = null;

  // ===== 第 0 步：立即隐藏顶部导航（避免闪烁） =====
  injectHideStyle();

  function injectHideStyle() {
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = `#biliMainHeader, #bili-header-container { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  // ===== 主入口 =====
  async function main() {
    try {
      const data = await getStorageData();
      if (data.enabled === false) {
        document.getElementById(HIDE_STYLE_ID)?.remove();
        listenForEnable();
        return;
      }
      isActive = true;
      currentTheme = data.theme || 'light';
      await injectStyles();
      applyTheme(currentTheme);
      // 关键：等页面完全加载且浏览器空闲后再插入 DOM
      // （过早插入会破坏 B站 Vue 水合/补丁，导致按钮失灵、头像不加载）
      afterPageSettled(() => {
        buildHeader();
        setupCollapsibles();
        disableAutoplay();
      });
      listenForDisable();
      listenForThemeChange();
    } catch (e) {
      console.error('[B站专注模式] 视频页净化失败:', e);
      document.getElementById(HIDE_STYLE_ID)?.remove(); // 失败兜底
    }
  }

  // 等页面完全加载且浏览器空闲，避免与 B站前端框架抢 DOM
  function afterPageSettled(fn) {
    const run = () => {
      if (window.requestIdleCallback) {
        requestIdleCallback(fn, { timeout: 2500 });
      } else {
        setTimeout(fn, 1500);
      }
    };
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run, { once: true });
  }

  // ===== 注入净化样式 =====
  async function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const url = chrome.runtime.getURL('content_scripts/video.css');
    const css = await (await fetch(url)).text();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ===== 插件顶栏（Logo + 搜索 + 主题） =====
  function buildHeader() {
    if (document.getElementById(HEADER_ID)) return;
    const header = document.createElement('div');
    header.id = HEADER_ID;
    header.innerHTML = `
      <a class="bfm-logo" href="https://www.bilibili.com/" title="回到B站主页">bilibili</a>
      <div class="bfm-search-box">
        <svg class="bfm-search-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
          <circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/>
          <path d="M14 14L18 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input class="bfm-search-input" type="text" autocomplete="off"
               placeholder="搜索视频、UP主、番剧..."/>
      </div>
      <div class="bfm-themes">
        <button data-theme="light" title="纯白">☀️</button>
        <button data-theme="dark" title="深色">🌙</button>
        <button data-theme="paper" title="纸张">📄</button>
      </div>
    `;
    document.body.prepend(header);

    const input = header.querySelector('.bfm-search-input');
    const doSearch = () => {
      const kw = input.value.trim();
      if (kw) window.location.href =
        `https://search.bilibili.com/all?keyword=${encodeURIComponent(kw)}`;
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    header.querySelector('.bfm-search-icon').addEventListener('click', doSearch);

    header.querySelectorAll('.bfm-themes button').forEach(btn => {
      btn.addEventListener('click', async () => {
        applyTheme(btn.dataset.theme);
        await saveStorageData({ theme: btn.dataset.theme });
      });
    });
    syncThemeButtons();
  }

  // ===== 折叠区域：相关推荐 + 评论区 =====
  // 注意：绝不能往 #app（Vue 管辖）里插入节点，否则 Vue 补丁报错、页面事件失灵。
  // 因此折叠只改目标元素的 data-bfm-collapsed 属性（安全），
  // 开关按钮做成悬浮胶囊挂在 body 末尾（完全不碰 Vue 树）。
  function setupCollapsibles() {
    let recDone = false;
    let cmDone = false;

    const trySetup = () => {
      // 相关推荐（右栏）
      if (!recDone) {
        const rec = document.querySelector('.recommend-list-v1');
        if (rec) {
          rec.dataset.bfmCollapsed = '1';
          makeFloatToggle('相关推荐', rec, 0);
          recDone = true;
        }
      }

      // 评论区：新版 Shadow DOM 组件或旧版容器
      if (!cmDone) {
        const cm = document.querySelector('bili-comments') || document.getElementById('comment');
        if (cm) {
          cm.dataset.bfmCollapsed = '1';
          makeFloatToggle('评论区', cm, 1);
          cmDone = true;
        }
      }

      return recDone && cmDone;
    };

    if (trySetup()) return;

    // 元素异步渲染，监听直到出现（20 秒超时）
    setupObserver = new MutationObserver(() => {
      if (!isActive) return;
      if (trySetup()) {
        setupObserver.disconnect();
        setupObserver = null;
      }
    });
    setupObserver.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      if (setupObserver) { setupObserver.disconnect(); setupObserver = null; }
    }, 20000);
  }

  // 悬浮折叠开关：append 到 body，fixed 定位在右下角
  function makeFloatToggle(label, target, index) {
    const btn = document.createElement('button');
    btn.className = 'bfm-collapse-toggle bfm-float-toggle';
    btn.style.bottom = (170 + index * 48) + 'px';
    const render = (collapsed) => {
      btn.textContent = collapsed ? `▸ ${label}` : `▾ ${label}`;
      btn.title = collapsed ? `展开${label}` : `折叠${label}`;
    };
    render(true);
    btn.addEventListener('click', () => {
      const collapsed = target.dataset.bfmCollapsed === '1';
      target.dataset.bfmCollapsed = collapsed ? '0' : '1';
      render(!collapsed);
      if (collapsed) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.body.appendChild(btn);
  }

  // ===== 关闭自动连播（点击播放器设置中的「播完暂停」） =====
  function disableAutoplay() {
    const tryClick = () => {
      const radio = document.querySelector(
        '.bpx-player-ctrl-setting-handoff input[type="radio"][value="2"]'
      );
      if (radio && !radio.checked) { radio.click(); return true; }
      return !!radio;
    };
    if (tryClick()) return;
    const obs = new MutationObserver(() => {
      if (!isActive) return;
      if (tryClick()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 20000);
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
    document.querySelectorAll(`#${HEADER_ID} .bfm-themes button`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });
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
      if (change?.newValue?.enabled === false && isActive) location.reload();
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
