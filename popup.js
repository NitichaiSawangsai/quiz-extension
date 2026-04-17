// popup.js — จัดการ 2 state: saved / editing
// ข้อมูลเก็บใน chrome.storage.local — ไม่หายจนกว่าจะลบเอง

const apiKeyInput  = document.getElementById('apiKey');
const modelSelect  = document.getElementById('model');
const saveBtn      = document.getElementById('save');
const editKeyBtn   = document.getElementById('edit-key');
const clearKeyBtn  = document.getElementById('clear-key');
const savedState   = document.getElementById('saved-state');
const editState    = document.getElementById('edit-state');
const keyPreview   = document.getElementById('key-preview');
const statusEl     = document.getElementById('status');

// ===================================================================
// โหลดค่าที่บันทึกไว้ตอนเปิด popup
// ===================================================================
chrome.storage.local.get(['apiKey', 'model'], (data) => {
  if (data.model) {
    modelSelect.value = data.model;
  } else {
    modelSelect.value = 'gpt-4o'; // default ใหม่
  }
  if (data.apiKey) {
    showSavedState(data.apiKey);
  } else {
    showEditState();
  }
});

// ===================================================================
// บันทึก
// ===================================================================
saveBtn.addEventListener('click', () => {
  const rawKey = apiKeyInput.value.trim();
  const model  = modelSelect.value;

  if (!rawKey) {
    showStatus('กรุณาใส่ API Key', 'err');
    return;
  }
  if (!rawKey.startsWith('sk-')) {
    showStatus('API Key ต้องขึ้นต้นด้วย sk-', 'err');
    return;
  }

  chrome.storage.local.set({ apiKey: rawKey, model }, () => {
    apiKeyInput.value = '';
    showSavedState(rawKey);
    showStatus('บันทึกสำเร็จ ✓', 'ok');
  });
});

// ===================================================================
// แก้ไข Key — กลับไปหน้ากรอก
// ===================================================================
editKeyBtn.addEventListener('click', () => {
  showEditState();
  apiKeyInput.focus();
});

// ===================================================================
// ลบ Key ออกทั้งหมด
// ===================================================================
clearKeyBtn.addEventListener('click', () => {
  if (!confirm('ลบ API Key ออก?')) return;
  chrome.storage.local.remove('apiKey', () => {
    showEditState();
    showStatus('ลบ Key แล้ว', 'ok');
  });
});

// ===================================================================
// Model เปลี่ยน → บันทึกทันทีโดยไม่ต้องกดปุ่ม
// ===================================================================
modelSelect.addEventListener('change', () => {
  chrome.storage.local.set({ model: modelSelect.value }, () => {
    showStatus('บันทึก model แล้ว ✓', 'ok');
  });
});

// ===================================================================
// Helpers
// ===================================================================
function showSavedState(key) {
  // แสดงแค่ prefix + masked เช่น sk-proj-xxxx••••••••••••••••••abcd
  const preview = key.length > 12
    ? key.slice(0, 10) + '••••••••••••••••' + key.slice(-4)
    : '••••••••••••';
  keyPreview.textContent = preview;

  savedState.style.display = 'block';
  editState.style.display  = 'none';
  saveBtn.style.display    = 'none';
  editKeyBtn.style.display = 'block';
  clearKeyBtn.style.display = 'block';
}

function showEditState() {
  savedState.style.display  = 'none';
  editState.style.display   = 'block';
  saveBtn.style.display     = 'block';
  editKeyBtn.style.display  = 'none';
  clearKeyBtn.style.display = 'none';
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className   = type;
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className   = '';
  }, 3000);
}
