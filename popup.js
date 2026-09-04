document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('autoFillToggle');
  const statsCount = document.getElementById('statsCount');

  // Load state from chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get({ autoFillEnabled: true, totalAutoFilled: 0 }, resolve);
    });

    toggle.checked = data.autoFillEnabled;
    statsCount.textContent = `${data.totalAutoFilled} 次`;

    toggle.addEventListener('change', () => {
      chrome.storage.local.set({ autoFillEnabled: toggle.checked });
    });
  }
});
