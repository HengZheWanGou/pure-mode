// B站专注模式 — Background Service Worker
// 功能：管理插件状态，处理图标变化

const STORAGE_KEY = 'biliFocusMode';

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
    }
  });
});

// 监听存储变化，更新图标状态
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
    const newData = changes[STORAGE_KEY].newValue;
    updateIcon(newData.enabled !== false);
  }
});

// 更新图标（启用=彩色，禁用=灰度）
function updateIcon(enabled) {
  // Manifest V3 中通过 action API 设置图标
  // 这里我们保持图标不变，通过 popup 中的状态文字来指示
  // 如需真正灰度图标，需要准备两套图标资源
}
