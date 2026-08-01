// B站专注模式 — 搜索结果页净化脚本
// 方案：注入净化 CSS + 动态清除广告卡片 + 主题同步
// 仅作用于 search.bilibili.com

(function () {
  'use strict';

  const STORAGE_KEY = 'biliFocusMode';
  const STYLE_ID = 'bfm-search-style';
  const FAB_ID = 'bfm-theme-fab';

  // 与主页 content.js 保持一致的主题变量
  const THEMES = {
    light: {
      bg: '#FFFFFF', surface: '#FFFFFF', border: '#E8E8E8',
      text: '#1A1A1E', textSecondary: '#8C8C8C',
      shadow: '0 4px 20px rgba(0,0,0,0.06)', focusBorder: '#FB7299',
      btnBg: '#F5F5F5', btnHover: '#EEEEEE'
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
      await injectStyles();
      applyTheme(currentTheme);
      startAdPurger();
      buildThemeFab();
      listenForDisable();
      listenForThemeChange();
    } catch (e) {
      console.error('[B站专注模式] 搜索页净化失败:', e);
    }
  }

  // ===== 注入净化 CSS =====
  async function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const url = chrome.runtime.getURL('content_scripts/search.css');
    const css = await (await fetch(url)).text();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
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
    document.querySelectorAll(`#${FAB_ID} button`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === name);
    });
  }

  // ===== 广告卡片清除（信息流广告异步渲染，需持续监控） =====
  function purgeAds() {
    document.querySelectorAll('.bili-video-card').forEach(card => {
      if (card.dataset.bfmChecked) return;
      card.dataset.bfmChecked = '1';
      // 广告特征：跳转 cm.bilibili.com 商业链接，或带广告标识块
      const isAd = card.querySelector(
        'a[href*="cm.bilibili.com"], .bili-video-card__info--ad'
      );
      if (isAd) card.remove();
    });
  }

  function startAdPurger() {
    purgeAds();
    let scheduled = false;
    observer = new MutationObserver(() => {
      if (!isActive || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; purgeAds(); });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ===== 浮动主题切换按钮 =====
  function buildThemeFab() {
    if (document.getElementById(FAB_ID)) return;
    const fab = document.createElement('div');
    fab.id = FAB_ID;
    fab.className = 'bfm-theme-fab';
    fab.innerHTML = `
      <button data-theme="light" title="纯白">☀️</button>
      <button data-theme="dark" title="深色">🌙</button>
      <button data-theme="paper" title="纸张">📄</button>
    `;
    fab.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        applyTheme(btn.dataset.theme);
        await saveStorageData({ theme: btn.dataset.theme });
      });
    });
    (document.body || document.documentElement).appendChild(fab);
    document.querySelectorAll(`#${FAB_ID} button`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });
  }

  // ===== 清理（禁用插件时恢复页面） =====
  function cleanup() {
    isActive = false;
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(FAB_ID)?.remove();
    document.documentElement.removeAttribute('data-bfm-theme');
    if (observer) { observer.disconnect(); observer = null; }
  }

  // ===== 监听开关与主题变化 =====
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

  // 在主页/弹窗切换主题时，搜索页实时跟随
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
