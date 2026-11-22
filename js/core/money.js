/* ---------- پول و ورودی مبلغ ---------- */
const toEnDigits = s => String(s||'').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const parseMoneyStr = s => {
  const cleaned = toEnDigits(s).replace(/,/g,'').replace(/،/g,'').replace(/[^\d.-]/g,'').trim();
  if(cleaned === '' || cleaned === '-') return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
};
const formatMoneyTyping = s => {
  const raw = toEnDigits(s).replace(/[^\d]/g,'');
  if(!raw) return '';
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
const moneyInput = (name, val='') => {
  const display = (val===''||val===undefined||val===null) ? '' : formatMoneyTyping(String(Math.round(Number(val)||0)));
  return `<input class="inp money-inp" name="${name}" type="text" inputmode="numeric" dir="ltr" autocomplete="off" required value="${display}" placeholder="مثلاً 150,000">`;
};
function bindMoneyInputs(root){
  (root || document).querySelectorAll('.money-inp').forEach(inp => {
    if(inp._moneyBound) return;
    inp._moneyBound = true;
    inp.addEventListener('input', () => {
      const cur = inp.selectionStart;
      const old = inp.value;
      const next = formatMoneyTyping(old);
      if(next === old) return;
      inp.value = next;
      const diff = next.length - old.length;
      try{ inp.setSelectionRange(Math.max(0, cur + diff), Math.max(0, cur + diff)); }catch(e){}
    });
  });
}
const sum = a => a.reduce((t,x)=>t+(Number(x.amount)||0),0);
