/* ---------- تاریخ شمسی و ابزارهای تاریخ ---------- */
/** تاریخ محلی را به صورت YYYY-MM-DD برمی‌گرداند (هماهنگ با input[type=date] و ذخیره‌سازی) */
const toLocalISO = d => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};
const todayISO = () => toLocalISO(new Date());
const jDate = iso => {
  try{ return new Date(iso+'T12:00:00').toLocaleDateString('fa-IR-u-ca-persian',{year:'numeric',month:'long',day:'numeric'}); }
  catch(e){ return iso; }
};
const jMonthKey = iso => {
  try{
    const p=new Intl.DateTimeFormat('en-u-ca-persian-nu-latn',{year:'numeric',month:'numeric'}).formatToParts(new Date(iso+'T12:00:00'));
    const y = p.find(x=>x.type==='year').value;
    const m = String(parseInt(p.find(x=>x.type==='month').value, 10));
    return y + '-' + m;
  }catch(e){ return ''; }
};
const jMonthName = iso => {
  try{ return new Date(iso+'T12:00:00').toLocaleDateString('fa-IR-u-ca-persian',{year:'numeric',month:'long'}); }
  catch(e){ return ''; }
};

/* تبدیل میلادی ⇄ شمسی (الگوریتم استاندارد) */
function gregorianToJalali(gy, gm, gd){
  const g_d_m = [0,31,59,90,120,151,181,212,243,273,304,334];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if(days > 365){ jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}
function jalaliToGregorian(jy, jm, jd){
  let gy = (jy <= 979) ? 621 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  const days = (365 * jy) + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30 + 186));
  gy += 400 * Math.floor(days / 146097);
  let d = days % 146097;
  if(d > 36524){ gy += 100 * Math.floor(--d / 36524); d %= 36524; if(d >= 365) d++; }
  gy += 4 * Math.floor(d / 1461);
  d %= 1461;
  if(d > 365){ gy += Math.floor((d - 1) / 365); d = (d - 1) % 365; }
  const gd = d + 1;
  const sal_a = [0,31,(gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0) ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  let gm = 0, v = gd;
  for(gm = 1; gm <= 12 && v > sal_a[gm]; gm++) v -= sal_a[gm];
  return [gy, gm, v];
}
function isoToJalaliParts(iso){
  const [y,m,d] = (iso || todayISO()).split('-').map(Number);
  return gregorianToJalali(y, m, d);
}
function jalaliPartsToIso(jy, jm, jd){
  const [gy, gm, gd] = jalaliToGregorian(+jy, +jm, +jd);
  return gy + '-' + String(gm).padStart(2,'0') + '-' + String(gd).padStart(2,'0');
}
function endOfJalaliMonthISO(iso){
  const [jy, jm] = isoToJalaliParts(iso || todayISO());
  let njy = jy, njm = jm + 1;
  if(njm > 12){ njm = 1; njy++; }
  const nextFirst = jalaliPartsToIso(njy, njm, 1);
  const d = new Date(nextFirst + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return toLocalISO(d);
}
function jalaliMonthKeysBack(count){
  const keys = [];
  let [jy, jm] = isoToJalaliParts(todayISO());
  for(let i = 0; i < count; i++){
    keys.push(jy + '-' + jm);
    jm--;
    if(jm < 1){ jm = 12; jy--; }
  }
  return keys;
}
const J_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
/** کبیسه بودن سال شمسی (الگوریتم استاندارد) */
function isJalaliLeap(jy){
  const a = ((jy - (jy > 0 ? 474 : 473)) % 2820 + 2820) % 2820 + 474;
  return (((a + 38) * 682) % 2816) < 682;
}
function jalaliMonthLength(jy, jm){
  if(jm <= 6) return 31;
  if(jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}
/**
 * فیلد تاریخ شمسی
 * opts.optional: اگر true، تیک «بدون تاریخ» و امکان خالی گذاشتن
 * opts.hint: متن راهنما
 */
/** ارقام فارسی بدون جداکننده هزارگان (برای سال/روز در select) */
function faDigits(n){
  return String(Math.round(Number(n)||0)).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

function jalaliDateField(iso, opts){
  opts = opts || {};
  const optional = !!opts.optional;
  const hasDate = !optional || (iso && iso.length >= 8);
  const [jy, jm, jd] = isoToJalaliParts(hasDate ? iso : todayISO());
  const [todayJy] = isoToJalaliParts(todayISO());
  // حداکثر ۲ سال قبل تا ۱۵ سال بعد (برای موعد اهداف آینده)
  let yMin = todayJy - 2;
  let yMax = todayJy + 15;
  if(jy < yMin) yMin = jy; // تاریخ ذخیره‌شده قدیمی‌تر همچنان قابل نمایش/ویرایش
  if(jy > yMax) yMax = jy;
  const years = [];
  for(let y = yMax; y >= yMin; y--) years.push(y);
  const dayMax = jalaliMonthLength(jy, jm);
  const days = [];
  for(let d = 1; d <= 31; d++) days.push(d);
  const disabled = optional && !hasDate;
  return `${optional?`<label class="flex items-center gap-2 text-sm mb-2"><input type="checkbox" name="j_no_date" ${hasDate?'':'checked'} data-jdate-optional> بدون تاریخ مشخص</label>`:''}
  <div class="flex gap-2 flex-wrap" data-jdate-wrap ${disabled?'style="opacity:.45;pointer-events:none"':''}>
    <select class="inp" name="j_day" style="flex:1;min-width:4.5rem" aria-label="روز" ${disabled?'disabled':''}>${days.map(d=>`<option value="${d}" ${d===jd?'selected':''} ${d>dayMax?'disabled':''}>${faDigits(d)}</option>`).join('')}</select>
    <select class="inp" name="j_month" style="flex:1.4;min-width:7rem" aria-label="ماه" ${disabled?'disabled':''}>${J_MONTHS.map((n,i)=>`<option value="${i+1}" ${i+1===jm?'selected':''}>${n}</option>`).join('')}</select>
    <select class="inp" name="j_year" style="flex:1;min-width:5rem" aria-label="سال" ${disabled?'disabled':''}>${years.map(y=>`<option value="${y}" ${y===jy?'selected':''}>${faDigits(y)}</option>`).join('')}</select>
  </div>
  <p class="muted text-xs mt-1">${opts.hint || 'می‌توانید تاریخ روزهای قبل را برای تراکنش فراموش‌شده انتخاب کنید.'}</p>`;
}
function readJalaliDate(fd){
  if(fd.get('j_no_date')) return null;
  const jy = +fd.get('j_year'), jm = +fd.get('j_month'), jd = +fd.get('j_day');
  if(!jy || !jm || !jd) return null;
  const max = jalaliMonthLength(jy, jm);
  if(jd < 1 || jd > max) return null;
  return jalaliPartsToIso(jy, jm, jd);
}
function bindJalaliDate(root){
  const scope = root || document;
  scope.querySelectorAll('[data-jdate-wrap]').forEach(wrap => {
    if(wrap._bound) return;
    wrap._bound = true;
    const daySel = wrap.querySelector('[name="j_day"]');
    const monSel = wrap.querySelector('[name="j_month"]');
    const yearSel = wrap.querySelector('[name="j_year"]');
    const syncDays = () => {
      const jy = +(yearSel && yearSel.value) || isoToJalaliParts(todayISO())[0];
      const jm = +monSel.value;
      const max = jalaliMonthLength(jy, jm);
      [...daySel.options].forEach(o => { o.disabled = +o.value > max; });
      if(+daySel.value > max) daySel.value = String(max);
    };
    monSel.addEventListener('change', syncDays);
    if(yearSel) yearSel.addEventListener('change', syncDays);
    syncDays();
  });
  const opt = scope.querySelector('[data-jdate-optional]');
  if(opt && !opt._bound){
    opt._bound = true;
    const wrap = scope.querySelector('[data-jdate-wrap]');
    const toggle = () => {
      const off = opt.checked;
      if(wrap){
        wrap.style.opacity = off ? '.45' : '';
        wrap.style.pointerEvents = off ? 'none' : '';
        wrap.querySelectorAll('select').forEach(s => { s.disabled = off; });
      }
    };
    opt.addEventListener('change', toggle);
    toggle();
  }
}
