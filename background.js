// B站专注模式 — Background Service Worker
// 功能：管理插件状态，启用/禁用时切换彩色/灰度图标

const STORAGE_KEY = 'biliFocusMode';

const COLOR_ICONS = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png'
};

const GRAY_ICONS = {
  16: 'icons/icon16_gray.png',
  48: 'icons/icon48_gray.png',
  128: 'icons/icon128_gray.png'
};

// 安装时初始化默认设置
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([STORAGE_KEY], (result) => {
    if (!result[STORAGE_KEY]) {
      chrome.storage.sync.set({
        [STORAGE_KEY]: {
          enabled: true,
          theme: 'light'
        }
      });
    } else {
      // 已安装过：按当前状态同步一次图标
      updateIcon(result[STORAGE_KEY].enabled !== false);
    }
  });
});

// 浏览器启动时也同步一次图标状态
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get([STORAGE_KEY], (result) => {
    const data = result[STORAGE_KEY];
    updateIcon(!data || data.enabled !== false);
  });
});

// 监听存储变化，更新图标状态
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
    const newData = changes[STORAGE_KEY].newValue;
    updateIcon(!newData || newData.enabled !== false);
  }
});

// 更新图标（启用=彩色，禁用=灰度）
function updateIcon(enabled) {
  chrome.action.setIcon({
    path: enabled ? COLOR_ICONS : GRAY_ICONS
  }).catch(() => {
    // 忽略图标切换失败（不影响核心功能）
  });
}
