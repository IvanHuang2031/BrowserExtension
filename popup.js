document.addEventListener('DOMContentLoaded', async () => {
  const autoFillToggle = document.getElementById('autoFillToggle');
  const universalToggle = document.getElementById('universalToggle');
  const statsCount = document.getElementById('statsCount');
  const forceBtn = document.getElementById('forceRecognizeBtn');
  const statusMsg = document.getElementById('statusMessage');

  // Load state from chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get({
        autoFillEnabled: true,
        universalEnabled: true,
        totalAutoFilled: 0
      }, resolve);
    });

    autoFillToggle.checked = data.autoFillEnabled;
    universalToggle.checked = data.universalEnabled;
    statsCount.textContent = `${data.totalAutoFilled} 次`;

    autoFillToggle.addEventListener('change', () => {
      chrome.storage.local.set({ autoFillEnabled: autoFillToggle.checked });
    });

    universalToggle.addEventListener('change', () => {
      chrome.storage.local.set({ universalEnabled: universalToggle.checked });
    });

    // Display current extension version
    const versionTag = document.getElementById('versionTag');
    if (versionTag && typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      const ver = chrome.runtime.getManifest().version;
      versionTag.textContent = `核心版本 v${ver} (純本機離線)`;
    }

    const restartBtn = document.getElementById('restartOcrBtn');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        statusMsg.textContent = '正在重新載入 OCR 引擎...';
        statusMsg.style.color = '#3b82f6';
        chrome.runtime.sendMessage({ action: 'RESTART_OFFSCREEN' }, (res) => {
          if (res && res.success) {
            statusMsg.textContent = '✅ ' + (res.message || 'OCR 核心已重啟');
            statusMsg.style.color = '#059669';
          } else {
            statusMsg.textContent = '重啟失敗：' + (res?.error || chrome.runtime.lastError?.message || '未知錯誤');
            statusMsg.style.color = '#ef4444';
          }
        });
      });
    }

    forceBtn.addEventListener('click', async () => {
      statusMsg.textContent = '正在掃描頁面並辨識...';
      statusMsg.style.color = '#3b82f6';

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          statusMsg.textContent = '無法取得當前分頁';
          statusMsg.style.color = '#ef4444';
          return;
        }

        chrome.tabs.sendMessage(tab.id, { action: 'FORCE_RECOGNIZE_ACTIVE_TAB' }, (res) => {
          if (chrome.runtime.lastError) {
            statusMsg.textContent = '無法連線至該分頁（若剛更新擴充功能，請先重新整理 F5 該網頁）';
            statusMsg.style.color = '#ef4444';
            return;
          }

          if (res && res.success) {
            statusMsg.textContent = `辨識成功，已填入 ${res.count || 1} 處驗證碼！`;
            statusMsg.style.color = '#059669';
            chrome.storage.local.get({ totalAutoFilled: 0 }, (d) => {
              statsCount.textContent = `${d.totalAutoFilled || 0} 次`;
            });
          } else {
            statusMsg.textContent = res?.message || '未在頁面上找到符合條件的驗證碼';
            statusMsg.style.color = '#eab308';
          }
        });
      } catch (err) {
        statusMsg.textContent = '觸發失敗：' + err.message;
        statusMsg.style.color = '#ef4444';
      }
    });
  }
});
