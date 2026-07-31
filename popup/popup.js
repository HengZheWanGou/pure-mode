// B站专注模式 — Popup 脚本

const STORAGE_KEY = 'biliFocusMode';

document.addEventListener('DOMContentLoaded', async () => {
  const toggleBtn = document.getElementById('toggle-btn');
  const statusText = document.getElementById('status-text');

  // 读取当前状态
  const data = await getStorageData();
  const enabled = data.enabled !== false; // 默认启用

  toggleBtn.checked = enabled;
  updateStatusUI(enabled);

  // 监听开关变化
  toggleBtn.addEventListener('change', async () => {
    const newEnabled = toggleBtn.checked;
    await saveStorageData({ enabled: newEnabled });
    updateStatusUI(newEnabled);

    // 通知当前标签页刷新
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('bilibili.com')) {
        chrome.tabs.reload(tab.id);
      }
    } catch (e) {
      // 忽略权限错误
    }
  });
});

function updateStatusUI(enabled) {
  const statusText = document.getElementById('status-text');
  if (enabled) {
    statusText.textContent = '已启用';
    statusText.classList.remove('disabled');
  } else {
    statusText.textContent = '已禁用';
    statusText.classList.add('disabled');
  }
}

function getStorageData() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || { enabled: true, theme: 'light' });
    });
  });
}

function saveStorageData(data) {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY], (result) => {
      const current = result[STORAGE_KEY] || { enabled: true, theme: 'light' };
      const updated = { ...current, ...data };
      chrome.storage.sync.set({ [STORAGE_KEY]: updated }, resolve);
    });
  });
}
