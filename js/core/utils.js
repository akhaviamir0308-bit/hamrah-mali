/* ---------- ابزارهای پایه ---------- */
const $ = s => document.querySelector(s);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
const fa = n => Math.round(Number(n)||0).toLocaleString('fa-IR');
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SESSION_UNLOCK = 'hamrah-mali:unlocked';

async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}
async function deriveKey(password, salt){
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:120000, hash:'SHA-256'},
    base,
    {name:'AES-GCM', length:256},
    false,
    ['encrypt','decrypt']
  );
}
function b64encode(buf){
  const bytes = new Uint8Array(buf);
  let s = '';
  for(let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(str){
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for(let i=0;i<s.length;i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
async function encryptJson(obj, password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, plain);
  return {
    version: 1,
    encrypted: true,
    algo: 'AES-GCM-PBKDF2',
    salt: b64encode(salt),
    iv: b64encode(iv),
    data: b64encode(cipher)
  };
}
async function decryptJson(payload, password){
  const salt = new Uint8Array(b64decode(payload.salt));
  const iv = new Uint8Array(b64decode(payload.iv));
  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, b64decode(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
function isSessionUnlocked(){
  try{ return sessionStorage.getItem(SESSION_UNLOCK) === '1'; }catch(e){ return false; }
}
function setSessionUnlocked(v){
  try{
    if(v) sessionStorage.setItem(SESSION_UNLOCK, '1');
    else sessionStorage.removeItem(SESSION_UNLOCK);
  }catch(e){}
}

function showToast(msg, ms=3200){
  const t = $('#toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove('show'), ms);
}
