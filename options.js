const input = document.getElementById('opencodeApiKey');
const status = document.getElementById('status');

chrome.storage.local.get('opencodeApiKey').then(({ opencodeApiKey = '' }) => {
  input.value = opencodeApiKey;
});

document.getElementById('toggleKey').addEventListener('click', (event) => {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'Hide' : 'Show';
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ opencodeApiKey: input.value.trim() });
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 1500);
});
