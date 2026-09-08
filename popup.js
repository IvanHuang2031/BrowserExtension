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
            statusMsg.textContent = '無法與該分頁連線（可能非標準網頁）';
            statusMsg.style.color = '#ef4444';
            return;
          }

          if (res && res.success) {
            statusMsg.textContent = `辨識成功，已填入 ${res.count || 1} 處驗證碼！`;
            statusMsg.style.color = '#059669';
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
