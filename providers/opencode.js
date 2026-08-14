AIUsageProviders.register({
  id: 'opencode',
  label: 'OpenCode',
  plan: 'Go',
  needs: 'key',
  openUrl: 'https://opencode.ai',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">Loading…</div>';
    const { opencodeApiKey = '' } = await chrome.storage.local.get('opencodeApiKey');
    if (!opencodeApiKey.trim()) {
      if (!silent) body.innerHTML = errorHtml('OpenCode API key not configured.', 'Open Settings and paste your OpenCode Go API key.');
      return false;
    }

    try {
      const data = await jsonFetch('https://opencode.ai/zen/go/v1/usage', {
        headers: {
          'Authorization': `Bearer ${opencodeApiKey.trim()}`,
          'Accept': 'application/json'
        }
      });

      const usage = data?.usage ?? data;
      const windows = [
        ['5 hour', usage?.rolling5h ?? usage?.rolling ?? usage?.five_hour ?? usage?.fiveHour],
        ['Weekly', usage?.weekly ?? usage?.seven_day ?? usage?.sevenDay],
        ['Monthly', usage?.monthly ?? usage?.thirty_day ?? usage?.month]
      ];

      const html = windows.map(([label, w]) => {
        if (!w) return '';
        const used = firstNumber(w.usageDollars, w.usage_dollars, w.used, w.usage);
        const limit = firstNumber(w.limitDollars, w.limit_dollars, w.limit, w.allowance);
        const pctRaw = firstNumber(w.usagePercent, w.usage_percent, w.utilization, w.percent);
        const pct = pctRaw != null ? clampPercent(pctRaw) : (limit && used != null ? clampPercent((used / limit) * 100) : null);
        const reset = resetMeta(w.resetsAt ?? w.resetAt ?? w.reset_at ?? w.resetInSec ?? w.reset_in_sec ?? w.resets_at);
        const detail = used != null && limit != null ? `${money(used)} / ${money(limit)}` : '';
        return metricHtml(label, pct, reset, detail || null);
      }).join('');

      if (!html) throw new Error('Unexpected OpenCode usage response format');
      body.innerHTML = html;
      return true;
    } catch (error) {
      if (!silent) body.innerHTML = errorHtml(`Could not load OpenCode Go: ${error.message}`, 'Verify the API key in Settings.');
      return false;
    }
  },
  settingsHtml() {
    return `
      <label for="cfg-opencode-key">API key</label>
      <div class="input-row">
        <input id="cfg-opencode-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" />
        <button type="button" id="cfg-opencode-toggle">Show</button>
      </div>
      <p class="help">Stored with <code>chrome.storage.local</code> in your Chrome profile. It is only sent to <code>https://opencode.ai/zen/go/v1/usage</code>.</p>`;
  },
  async readSettings() {
    const key = document.getElementById('cfg-opencode-key').value.trim();
    await chrome.storage.local.set({ opencodeApiKey: key });
  }
});
