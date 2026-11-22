/* ---------- مدیریت هزینه‌های آینده (فاز تکمیل) ---------- */
/* وابستگی: core/*, توابع سراسری app در زمان اجرا */

const INTERVAL_LABELS = {1:'هر ماه', 2:'هر ۲ ماه', 3:'هر ۳ ماه', 6:'هر ۶ ماه', 12:'هر سال'};
const PRIORITY_LABELS = {high:'بالا', medium:'متوسط', low:'پایین'};
const STATUS_LABELS = {
  overdue:'عقب‌افتاده', upcoming:'نزدیک به موعد', funded:'تأمین‌شده',
  funding:'در حال تأمین', paid:'پرداخت‌شده', paused:'متوقف'
};
const STATUS_CLASS = {
  overdue:'status-red', upcoming:'status-yellow', funded:'status-green',
  funding:'', paid:'status-green', paused:''
};

function monthsBetweenISO(fromISO, toISO){
  if(!fromISO || !toISO) return 0;
  const [y1, m1] = isoToJalaliParts(fromISO);
  const [y2, m2] = isoToJalaliParts(toISO);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
}
function addJalaliMonthsISO(iso, n){
  const [jy, jm, jd] = isoToJalaliParts(iso || todayISO());
  let y = jy, m = jm + Math.round(Number(n)||0);
  while(m > 12){ m -= 12; y++; }
  while(m < 1){ m += 12; y--; }
  const max = jalaliMonthLength(y, m);
  return jalaliPartsToIso(y, m, Math.min(jd, max));
}
function daysUntilISO(iso){
  if(!iso) return null;
  const a = new Date(todayISO() + 'T12:00:00');
  const b = new Date(iso + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

function linkedFundForPeriodic(p){
  if(!p || !p.linkedFundId) return null;
  return (state.sinkingFunds || []).find(f => f.id === p.linkedFundId) || null;
}
function periodicFundedAmount(p){
  const fund = linkedFundForPeriodic(p);
  if(fund) return Math.max(0, Number(fund.currentAmount)||0);
  return Math.max(0, Number(p.fundedAmount)||0);
}
function periodicStatus(p){
  if(!p) return 'funding';
  if(p.paused) return 'paused';
  const due = p.nextDueDate;
  const days = due ? daysUntilISO(due) : null;
  const funded = periodicFundedAmount(p);
  const need = Number(p.amount)||0;
  if(due && days !== null && days < 0) return 'overdue';
  if(need > 0 && funded >= need) return 'funded';
  if(due && days !== null && days <= 30) return 'upcoming';
  if(p.lastPaidAt && jMonthKey(p.lastPaidAt) === jMonthKey(todayISO())) return 'paid';
  return 'funding';
}

/**
 * سهم ماهانه پیشنهادی.
 * بدون موعد → null (پیشنهاد خودکار نداریم).
 * با monthlyOverride → همان مقدار.
 */
function calcMonthlyShare(targetAmount, currentAmount, dueISO, override){
  if(override !== null && override !== undefined && override !== '' && Number.isFinite(Number(override))){
    return Math.max(0, Math.round(Number(override)));
  }
  if(!dueISO) return null; // بدون موعد: پیشنهاد خودکار نداریم
  const target = Math.max(0, Number(targetAmount)||0);
  const current = Math.max(0, Number(currentAmount)||0);
  const remaining = Math.max(0, target - current);
  if(remaining <= 0) return 0;
  let months = Math.max(1, monthsBetweenISO(todayISO(), dueISO));
  if(dueISO < todayISO()) months = 1;
  return Math.ceil(remaining / months);
}

function monthlyForPeriodic(p){
  if(!p || p.paused) return 0;
  const rem = Math.max(0, (Number(p.amount)||0) - periodicFundedAmount(p));
  if(rem <= 0) return 0; // fully funded → share zero even if override set
  const v = calcMonthlyShare(p.amount, periodicFundedAmount(p), p.nextDueDate, p.monthlyOverride);
  return v === null ? 0 : v;
}
function monthlyForFund(f){
  if(!f) return 0;
  const rem = Math.max(0, (Number(f.targetAmount)||0) - (Number(f.currentAmount)||0));
  if(rem <= 0) return 0;
  const v = calcMonthlyShare(f.targetAmount, f.currentAmount, f.targetDate, f.monthlyOverride);
  return v === null ? 0 : v;
}
function hasAutoMonthly(pOrF, isFund){
  const due = isFund ? pOrF.targetDate : pOrF.nextDueDate;
  const ov = pOrF.monthlyOverride;
  if(ov !== null && ov !== undefined && ov !== '' && Number.isFinite(Number(ov))) return true;
  return !!due;
}

function totalMonthlyFutureCommitments(){
  const periodics = (state.periodicExpenses || []).filter(p => !p.paused);
  const linkedFundIds = new Set(periodics.map(p => p.linkedFundId).filter(Boolean));
  let total = 0;
  periodics.forEach(p => { total += monthlyForPeriodic(p); });
  (state.sinkingFunds || []).forEach(f => {
    if(linkedFundIds.has(f.id)) return;
    if(Math.max(0, (Number(f.targetAmount)||0) - (Number(f.currentAmount)||0)) <= 0) return;
    total += monthlyForFund(f);
  });
  return total;
}

function commitmentRows(){
  const periodics = (state.periodicExpenses || []).filter(p => !p.paused);
  const linkedFundIds = new Set(periodics.map(p => p.linkedFundId).filter(Boolean));
  const rows = [];
  periodics.forEach(p => {
    const m = monthlyForPeriodic(p);
    const auto = hasAutoMonthly(p, false);
    rows.push({
      id: p.id, name: p.title, amount: m, kind: 'دوره‌ای',
      kindKey: 'periodic', hasMonthly: auto || m > 0,
      remaining: Math.max(0, (Number(p.amount)||0) - periodicFundedAmount(p)),
      override: p.monthlyOverride
    });
  });
  (state.sinkingFunds || []).forEach(f => {
    if(linkedFundIds.has(f.id)) return;
    const rem = Math.max(0, (Number(f.targetAmount)||0) - (Number(f.currentAmount)||0));
    if(rem <= 0) return;
    const m = monthlyForFund(f);
    rows.push({
      id: f.id, name: f.name, amount: m, kind: 'صندوق',
      kindKey: 'fund', hasMonthly: hasAutoMonthly(f, true) || m > 0,
      remaining: rem, override: f.monthlyOverride
    });
  });
  return rows;
}

function upcomingPeriodics(limitDays){
  const lim = limitDays == null ? 45 : limitDays;
  return (state.periodicExpenses || [])
    .filter(p => !p.paused && p.nextDueDate)
    .map(p => ({p, days: daysUntilISO(p.nextDueDate)}))
    .filter(x => x.days !== null && x.days <= lim)
    .sort((a,b) => a.days - b.days);
}
function sumFuturePeriodicAmounts(){
  return (state.periodicExpenses || [])
    .filter(p => !p.paused)
    .reduce((s,p) => s + Math.max(0, (Number(p.amount)||0) - periodicFundedAmount(p)), 0);
}

/** قطع همه لینک‌های یک صندوق */
function clearFundLinks(fundId){
  (state.periodicExpenses || []).forEach(p => {
    if(p.linkedFundId === fundId) p.linkedFundId = null;
  });
  const f = (state.sinkingFunds || []).find(x => x.id === fundId);
  if(f) f.linkedPeriodicId = null;
}

/** تنظیم اتصال یک‌به‌یک هزینه → صندوق */
function setPeriodicFundLink(periodicId, fundId){
  const p = (state.periodicExpenses || []).find(x => x.id === periodicId);
  if(!p) return;
  // پاک کردن لینک قبلی این هزینه
  if(p.linkedFundId && p.linkedFundId !== fundId){
    const old = (state.sinkingFunds || []).find(x => x.id === p.linkedFundId);
    if(old && old.linkedPeriodicId === periodicId) old.linkedPeriodicId = null;
  }
  if(!fundId){
    p.linkedFundId = null;
    return;
  }
  const f = (state.sinkingFunds || []).find(x => x.id === fundId);
  if(!f){ p.linkedFundId = null; return; }
  // اگر صندوق به هزینه دیگری وصل است، آن را قطع کن
  if(f.linkedPeriodicId && f.linkedPeriodicId !== periodicId){
    const other = (state.periodicExpenses || []).find(x => x.id === f.linkedPeriodicId);
    if(other) other.linkedFundId = null;
  }
  p.linkedFundId = fundId;
  f.linkedPeriodicId = periodicId;
}

function availableFundsForPeriodic(periodicId){
  return (state.sinkingFunds || []).filter(f =>
    !f.linkedPeriodicId || f.linkedPeriodicId === periodicId
  );
}

/* ---------- صفحه هزینه‌های دوره‌ای ---------- */
function renderPeriodic(){
  const list = Array.isArray(state.periodicExpenses) ? state.periodicExpenses : [];
  const active = list.filter(p => !p.paused);
  const paused = list.filter(p => p.paused);
  const monthlySum = active.reduce((s,p) => s + monthlyForPeriodic(p), 0);
  const futureSum = sumFuturePeriodicAmounts();
  const near = upcomingPeriodics(30);

  const card = (p) => {
    const st = periodicStatus(p);
    const fund = linkedFundForPeriodic(p);
    const funded = periodicFundedAmount(p);
    const monthly = monthlyForPeriodic(p);
    const pct = Math.min(100, Math.round(funded / Math.max(1, Number(p.amount)) * 100));
    const cls = STATUS_CLASS[st] || '';
    const noDue = !p.nextDueDate && (p.monthlyOverride === null || p.monthlyOverride === undefined || p.monthlyOverride === '');
    return `<article class="card ${cls}">
      <div class="flex justify-between items-start gap-3">
        <div class="min-w-0">
          <h2 class="font-bold text-lg break-words">${esc(p.title)}</h2>
          <p class="muted text-xs mt-1">${INTERVAL_LABELS[p.intervalMonths]||('هر '+fa(p.intervalMonths)+' ماه')}
            · اولویت ${PRIORITY_LABELS[p.priority]||p.priority}
            ${p.nextDueDate ? ' · موعد: '+jDate(p.nextDueDate) : ' · بدون موعد مشخص'}</p>
        </div>
        <span class="pill"><span>${STATUS_LABELS[st]||st}</span></span>
      </div>
      <div class="mt-3 flex justify-between gap-2 text-sm">
        <span class="font-bold">${money(p.amount)}</span>
        <span class="muted">تأمین‌شده: ${money(funded)}${fund ? ' (صندوق)' : ''}</span>
      </div>
      <div class="bar mt-2"><i style="width:${pct}%"></i></div>
      <p class="muted text-xs mt-2">
        ${noDue
          ? 'بدون موعد — سهم خودکار محاسبه نمی‌شود. می‌توانید مبلغ ماهانه دلخواه تعیین کنید.'
          : (monthly > 0
              ? 'سهم ماهانه: <b>'+money(monthly)+'</b>'+(p.monthlyOverride!=null?' (تنظیم‌شده)':' (پیشنهادی)')
              : 'مبلغ هدف تأمین شده است.')}
        ${fund ? ' · متصل به صندوق «'+esc(fund.name)+'»' : ' · مستقل از صندوق'}
      </p>
      <div class="flex flex-wrap gap-2 mt-4">
        ${!p.paused ? `<button class="btn text-sm" data-act="periodic-pay" data-id="${esc(p.id)}">ثبت پرداخت</button>` : ''}
        <button class="btn-ghost text-sm" data-act="periodic-fund" data-id="${esc(p.id)}">تأمین جزئی</button>
        <button class="btn-ghost text-sm" data-act="periodic-edit" data-id="${esc(p.id)}">ویرایش</button>
        <button class="btn-ghost text-sm" data-act="periodic-toggle" data-id="${esc(p.id)}">${p.paused?'فعال‌سازی':'توقف'}</button>
        <button class="btn-ghost text-sm" data-act="periodic-delete" data-id="${esc(p.id)}" style="color:var(--danger)">حذف</button>
      </div>
    </article>`;
  };

  $('#app').innerHTML = `
  <section class="mb-5">
    <p class="text-sm font-bold" style="color:var(--primary)">هزینه‌های غیرماهانه قابل پیش‌بینی</p>
    <div class="flex flex-wrap items-center justify-between gap-3 mt-1">
      <div>
        <h1 class="text-2xl md:text-3xl font-bold">هزینه‌های دوره‌ای</h1>
        <p class="muted text-sm mt-2 leading-7">ثبت، تأمین و پرداخت مستقل — اتصال به صندوق فقط در صورت تمایل شما.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost text-sm" data-act="guide" data-guide="periodic">این بخش چطور کار می‌کند؟</button>
        <button class="btn-ghost text-sm" data-act="calc-big">ماشین‌حساب هزینه بزرگ</button>
        <button class="btn" data-act="periodic-new">＋ هزینه دوره‌ای</button>
      </div>
    </div>
  </section>

  <section class="grid sm:grid-cols-3 gap-3 mb-5">
    <div class="card"><p class="muted text-xs">تعداد فعال</p><p class="text-2xl font-bold mt-1">${fa(active.length)}</p></div>
    <div class="card"><p class="muted text-xs">مجموع باقی‌مانده آینده</p><p class="text-xl font-bold mt-1">${money(futureSum)}</p></div>
    <div class="card"><p class="muted text-xs">جمع سهم ماهانه</p><p class="text-xl font-bold mt-1">${money(monthlySum)}</p></div>
  </section>

  ${near.length ? `<section class="card mb-5 status-yellow">
    <h2 class="font-bold mb-2">نزدیک به موعد پرداخت</h2>
    <ul class="space-y-2 text-sm">
      ${near.map(({p,days}) => `<li class="flex justify-between gap-2"><span>${esc(p.title)}</span>
        <span>${days < 0 ? fa(-days)+' روز گذشته' : (days===0 ? 'امروز' : fa(days)+' روز مانده')} · ${money(p.amount)}</span></li>`).join('')}
    </ul>
  </section>` : ''}

  ${active.length ? `<section class="grid md:grid-cols-2 gap-4">${active.map(card).join('')}</section>`
    : `<section class="card text-center py-10">
        <div class="text-4xl">📅</div>
        <h2 class="font-bold text-lg mt-3">هنوز هزینه دوره‌ای ثبت نکرده‌اید</h2>
        <p class="muted text-sm mt-2 leading-7">بدون نیاز به صندوق می‌توانید هزینه را ثبت کنید و سهم ماهانه ببینید.</p>
        <button class="btn mt-4" data-act="periodic-new">ثبت اولین هزینه دوره‌ای</button>
      </section>`}

  ${paused.length ? `<section class="mt-6"><h2 class="font-bold mb-3 muted">متوقف‌شده</h2>
    <div class="grid md:grid-cols-2 gap-4 opacity-80">${paused.map(card).join('')}</div></section>` : ''}

  <p class="muted text-xs leading-6 mt-5">مسیر: هزینه آینده → سهم ماهانه → (اختیاری) صندوق → بودجه → تأمین → پرداخت.</p>
  <p class="muted text-xs mt-2"><a href="#funds" class="underline" style="color:var(--primary)">صندوق‌های هدفمند ←</a>
    · <a href="#guide" class="underline" style="color:var(--primary)">راهنمای همراه مالی ←</a></p>`;
}

function periodicDialog(editItem){
  const isEdit = !!editItem;
  const avail = availableFundsForPeriodic(isEdit ? editItem.id : null);
  const fundOpts = `<option value="">— بدون اتصال (مستقل) —</option>` +
    avail.map(f => `<option value="${esc(f.id)}" ${isEdit && editItem.linkedFundId===f.id?'selected':''}>${esc(f.name)}</option>`).join('');
  const intervalOpts = [1,2,3,6,12].map(n =>
    `<option value="${n}" ${isEdit && Number(editItem.intervalMonths)===n?'selected':(!isEdit && n===6?'selected':'')}>${INTERVAL_LABELS[n]}</option>`
  ).join('');
  const pri = isEdit ? editItem.priority : 'medium';
  const ov = isEdit && editItem.monthlyOverride != null ? editItem.monthlyOverride : '';
  openDialog(
    `<h3 class="font-bold text-lg">${isEdit?'ویرایش هزینه دوره‌ای':'هزینه دوره‌ای جدید'}</h3>
     <p class="muted text-sm leading-6">صندوق اختیاری است. می‌توانید فقط هزینه را ثبت کنید و پول را جداگانه تأمین کنید.</p>`
    + field('عنوان', `<input class="inp" name="title" required maxlength="80" value="${esc(isEdit?editItem.title:'')}" placeholder="مثلاً شهریه دانشگاه">`)
    + field('مبلغ تقریبی یا دقیق ('+state.settings.currency+')', num('amount', isEdit?editItem.amount:''))
    + field('بازه تکرار', `<select class="inp" name="interval">${intervalOpts}</select>`)
    + field('تاریخ پرداخت بعدی', jalaliDateField(isEdit && editItem.nextDueDate ? editItem.nextDueDate : '', {optional:true, hint:'بدون موعد، سهم ماهانه خودکار پیشنهاد نمی‌شود.'}))
    + field('اولویت', `<select class="inp" name="priority">
        <option value="high" ${pri==='high'?'selected':''}>بالا</option>
        <option value="medium" ${pri==='medium'?'selected':''}>متوسط</option>
        <option value="low" ${pri==='low'?'selected':''}>پایین</option>
      </select>`)
    + field('اتصال به صندوق (اختیاری — یک‌به‌یک)', `<select class="inp" name="linkedFundId">${fundOpts}</select>`)
    + field('مبلغ ماهانه دلخواه (اختیاری)', `<input class="inp money-inp" name="monthlyOverride" type="text" inputmode="numeric" dir="ltr" value="${ov!==''?formatMoneyTyping(String(ov)):''}" placeholder="خالی = محاسبه خودکار در صورت داشتن موعد">`)
    + field('مبلغ تأمین‌شده بدون صندوق', num('funded', isEdit && !editItem.linkedFundId ? (editItem.fundedAmount||0) : 0))
    + field('یادداشت (اختیاری)', `<input class="inp" name="notes" maxlength="200" value="${esc(isEdit?editItem.notes||'':'')}" placeholder="توضیح کوتاه">`),
    fd => {
      const title = String(fd.get('title')||'').trim();
      const amount = parseAmount(fd, 'amount');
      const interval = Math.round(Number(fd.get('interval'))||1);
      const nextDueDate = readJalaliDate(fd) || '';
      const priority = ['high','medium','low'].includes(fd.get('priority')) ? fd.get('priority') : 'medium';
      const linkedFundId = String(fd.get('linkedFundId')||'').trim() || null;
      let funded = parseAmount(fd, 'funded');
      if(funded === null) funded = 0;
      const ovRaw = String(fd.get('monthlyOverride')||'').trim();
      let monthlyOverride = null;
      if(ovRaw !== ''){
        const v = parseMoneyStr(ovRaw);
        if(v === null || v < 0){ showToast('مبلغ ماهانه دلخواه نامعتبر است.'); return false; }
        monthlyOverride = Math.round(v);
      }
      if(!title){ showToast('عنوان را وارد کنید.'); return false; }
      if(amount === null || amount <= 0){ showToast('مبلغ باید بزرگ‌تر از صفر باشد.'); return false; }
      const id = isEdit ? editItem.id : uid();
      const row = {
        id, title, amount,
        intervalMonths: PERIODIC_INTERVALS.includes(interval) ? interval : 1,
        nextDueDate, priority,
        paused: isEdit ? !!editItem.paused : false,
        linkedFundId: null, // بعد با setPeriodicFundLink
        fundedAmount: linkedFundId ? 0 : Math.max(0, funded),
        monthlyOverride,
        notes: String(fd.get('notes')||'').trim().slice(0,200),
        createdAt: isEdit ? editItem.createdAt : todayISO(),
        lastPaidAt: isEdit ? (editItem.lastPaidAt||'') : ''
      };
      if(isEdit){
        const i = state.periodicExpenses.findIndex(x => x.id === editItem.id);
        if(i >= 0) state.periodicExpenses[i] = row;
      } else {
        state.periodicExpenses.push(row);
      }
      setPeriodicFundLink(id, linkedFundId);
      save();
      showToast(isEdit ? 'هزینه دوره‌ای به‌روز شد.' : 'هزینه دوره‌ای ثبت شد.');
    },
    {wide: true}
  );
}

function periodicMarkPaid(id){
  const p = state.periodicExpenses.find(x => x.id === id);
  if(!p) return;
  const fund = linkedFundForPeriodic(p);
  const fundBal = fund ? Math.max(0, Number(fund.currentAmount)||0) : 0;
  const need = Number(p.amount)||0;
  const fromFund = fund ? Math.min(fundBal, need) : 0;
  const fromOther = Math.max(0, need - fromFund);
  const noteHtml = fund
    ? `<p class="text-sm leading-7 mt-2 ${fromOther>0?'status-yellow rounded-lg px-2 py-1':''}">
        از صندوق «${esc(fund.name)}»: ${money(fromFund)}
        ${fromOther>0 ? ' · از منابع دیگر: '+money(fromOther)+' (موجودی صندوق کافی نیست)' : ' · کل مبلغ از صندوق تأمین می‌شود'}
      </p>`
    : `<p class="muted text-sm mt-2">این هزینه به صندوق وصل نیست؛ پرداخت از منابع خودتان ثبت می‌شود.</p>`;

  openDialog(
    `<h3 class="font-bold text-lg">ثبت پرداخت · ${esc(p.title)}</h3>
     <p class="muted text-sm leading-6">موعد بعدی بر اساس بازه تکرار جلو می‌رود.</p>
     ${noteHtml}`
    + field('تاریخ پرداخت', jalaliDateField(todayISO()))
    + `<label class="flex items-center gap-2 text-sm mt-2"><input type="checkbox" name="asExpense" checked> ثبت به‌عنوان هزینه در تراکنش‌ها (کل ${money(need)})</label>`
    + field('دسته هزینه', `<select class="inp" name="cat">${
        state.categories.filter(c=>c.type==='expense'&&c.isActive).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')
      }</select>`),
    fd => {
      const date = readJalaliDate(fd) || todayISO();
      const asExpense = !!fd.get('asExpense');
      const cat = String(fd.get('cat')||'');
      p.lastPaidAt = date;
      p.fundedAmount = 0;
      if(p.nextDueDate) p.nextDueDate = addJalaliMonthsISO(p.nextDueDate, p.intervalMonths || 1);
      else p.nextDueDate = addJalaliMonthsISO(date, p.intervalMonths || 1);

      if(fund && fromFund > 0){
        fund.currentAmount = Math.max(0, (Number(fund.currentAmount)||0) - fromFund);
        if(!Array.isArray(fund.history)) fund.history = [];
        fund.history.push({
          id: uid(), type: 'withdraw', amount: fromFund, date,
          note: fromOther > 0
            ? 'پرداخت جزئی «'+p.title+'» از صندوق؛ باقی '+fromOther+' از منابع دیگر'
            : 'پرداخت «'+p.title+'»'
        });
      }
      if(asExpense){
        state.expenses.push({
          id: uid(), title: p.title, amount: need, date,
          categoryId: cat || (state.categories.find(c=>c.type==='expense')||{}).id || '',
          note: fund
            ? (fromOther > 0
                ? 'پرداخت دوره‌ای · از صندوق '+fromFund+' · از منابع دیگر '+fromOther
                : 'پرداخت دوره‌ای از صندوق')
            : 'پرداخت هزینه دوره‌ای'
        });
      }
      save();
      showToast(fromOther > 0
        ? 'پرداخت ثبت شد. بخشی از مبلغ از منابع دیگر تأمین شد.'
        : 'پرداخت ثبت شد و موعد بعدی به‌روز شد.');
    }
  );
}

function periodicAddFunding(id){
  const p = state.periodicExpenses.find(x => x.id === id);
  if(!p) return;
  const fund = linkedFundForPeriodic(p);
  if(fund){
    fundMovementDialog(fund, 'deposit');
    return;
  }
  const current = Number(p.fundedAmount)||0;
  const need = Math.max(0, (Number(p.amount)||0) - current);
  openDialog(
    `<h3 class="font-bold text-lg">تأمین جزئی · ${esc(p.title)}</h3>
     <p class="muted text-sm">بدون صندوق: مبلغ کنارگذاشته‌شده روی خود هزینه ثبت می‌شود. تاکنون ${money(current)} · باقی حدود ${money(need)}.</p>`
    + field('مبلغ اضافه ('+state.settings.currency+')', num('amount', need > 0 ? need : '')),
    fd => {
      const amount = parseAmount(fd, 'amount');
      if(amount === null || amount <= 0){ showToast('مبلغ معتبر نیست.'); return false; }
      p.fundedAmount = current + amount;
      save();
      showToast('مبلغ تأمین به‌روز شد.');
    }
  );
}

function periodicToggle(id){
  const p = state.periodicExpenses.find(x => x.id === id);
  if(!p) return;
  p.paused = !p.paused;
  save();
  showToast(p.paused ? 'هزینه متوقف شد.' : 'هزینه دوباره فعال شد.');
  render();
}

function periodicDelete(id){
  const p = state.periodicExpenses.find(x => x.id === id);
  if(!p) return;
  if(!confirm('هزینه دوره‌ای «'+p.title+'» حذف شود؟')) return;
  if(p.linkedFundId){
    const f = (state.sinkingFunds||[]).find(x => x.id === p.linkedFundId);
    if(f && f.linkedPeriodicId === id) f.linkedPeriodicId = null;
  }
  state.periodicExpenses = state.periodicExpenses.filter(x => x.id !== id);
  save();
  showToast('حذف شد.');
  render();
}

/* ---------- ماشین‌حساب هزینه بزرگ ---------- */
function bigExpenseCalcDialog(){
  openDialog(
    `<h3 class="font-bold text-lg">ماشین‌حساب تأمین ماهانه</h3>
     <p class="muted text-sm leading-6">مبلغ هدف، موجودی فعلی و موعد را وارد کنید تا سهم ماهانه محاسبه شود. ذخیره نمی‌شود مگر خودتان هزینه/صندوق بسازید.</p>`
    + field('مبلغ هدف', num('target', ''))
    + field('موجودی فعلی', num('current', 0))
    + field('موعد پرداخت', jalaliDateField('', {optional:true, hint:'بدون موعد، فقط باقی‌مانده نمایش داده می‌شود.'}))
    + `<div id="calcResult" class="card mt-3 text-sm leading-7" style="background:var(--soft)">نتیجه پس از ذخیره موقت در همین پنجره با زدن محاسبه… از دکمه‌های پایین استفاده کنید یا مقادیر را وارد و ذخیره را بزنید تا نتیجه دیده شود.</div>`,
    fd => {
      const target = parseAmount(fd, 'target');
      const current = parseAmount(fd, 'current');
      const due = readJalaliDate(fd) || '';
      if(target === null || target <= 0){ showToast('مبلغ هدف معتبر نیست.'); return false; }
      if(current === null || current < 0){ showToast('موجودی معتبر نیست.'); return false; }
      const rem = Math.max(0, target - current);
      const share = calcMonthlyShare(target, current, due, null);
      const el = document.getElementById('calcResult');
      let html = `<b>باقی‌مانده:</b> ${money(rem)}<br>`;
      if(share === null) html += 'موعد مشخص نیست — سهم ماهانه خودکار پیشنهاد نمی‌شود. یک موعد بگذارید یا مبلغ ماهانه را خودتان انتخاب کنید.';
      else if(share === 0) html += 'هدف از نظر موجودی تأمین شده است.';
      else html += `<b>سهم ماهانه پیشنهادی:</b> ${money(share)}` + (due ? ` (تا ${jDate(due)})` : '');
      if(el){ el.innerHTML = html; return false; } // نگه داشتن دیالوگ
      showToast(share === null ? 'بدون موعد سهم خودکار نداریم.' : 'سهم ماهانه: '+money(share));
      return false;
    },
    {wide: true}
  );
  // دکمه ذخیره را به «محاسبه» تغییر بده
  setTimeout(() => {
    const btn = form.querySelector('button[value="ok"]');
    if(btn) btn.textContent = 'محاسبه';
  }, 0);
}

/* ---------- راهنماهای contextual، آموزش کار با سایت، مرکز ابزارها ---------- */

/** فهرست همه ابزارهای سایت — برای مرکز ابزار و آموزش تخصصی */
const SITE_TOOLS = [
  {
    id: 'home',
    icon: '🏠',
    name: 'خانه',
    href: '#home',
    short: 'معرفی کوتاه برنامه و میان‌بر شروع.',
    what: 'صفحهٔ شروع برای آشنایی با همراه مالی و رفتن سریع به بخش‌های اصلی.',
    steps: [
      'از لینک‌های صفحه یا منوی پایین به داشبورد، تراکنش‌ها یا تنظیمات بروید.',
      'اگر تازه‌وارد هستید، از «مرکز ابزارها» یا «آموزش کار با سایت» شروع کنید.',
      'دکمه + شناور برای ثبت سریع هزینه یا درآمد است.'
    ]
  },
  {
    id: 'dashboard',
    icon: '📊',
    name: 'داشبورد',
    href: '#dashboard',
    short: 'نمای کلی موجودی، بودجه، هزینه‌ها و تعهدات آینده.',
    what: 'مرکز کنترل ماه جاری: درآمد، هزینه، بودجه، صندوق اضطراری، تعهدات آینده و میان‌برها.',
    steps: [
      'موجودی = موجودی اولیه + درآمدها − هزینه‌ها (موجودی ابتدای ماه جداست و درآمد نیست).',
      'بودجه ماهانه را با «تعیین بودجه» تنظیم کنید؛ فقط دسته‌هایی که می‌خواهید را پر کنید.',
      'سقف کل را می‌توانید بالاتر از جمع دسته‌ها بگذارید تا اختلاف حفظ شود.',
      'بخش «هزینه‌ها بر اساس دسته» ماه جاری و تا سه ماه قبل را نشان می‌دهد.',
      '«تعهدات آینده» سهم ماهانه دوره‌ای و صندوق‌ها را بدون دوباره‌شماری نشان می‌دهد.',
      'در ابتدای ماه، یادآوری ثبت موجودی نقدی ظاهر می‌شود؛ آن را با درآمد قاطی نکنید.'
    ]
  },
  {
    id: 'transactions',
    icon: '📋',
    name: 'تراکنش‌ها',
    href: '#transactions',
    short: 'فهرست درآمدها و هزینه‌ها با فیلتر ماه.',
    what: 'همه ثبت‌های درآمد و هزینه برای مرور، ویرایش و حذف.',
    steps: [
      'با دکمه‌های ثبت یا دکمه + شناور، تراکنش جدید بسازید.',
      'برای هزینه: مبلغ، تاریخ شمسی، عنوان و دسته‌بندی کافی است.',
      'فیلتر ماه و نوع (همه / درآمد / هزینه) را برای مرور استفاده کنید.',
      'کنار هر مورد می‌توانید ویرایش یا حذف کنید؛ اشتباه را اصلاح کنید نه پنهان.'
    ]
  },
  {
    id: 'periodic',
    icon: '📅',
    name: 'هزینه‌های دوره‌ای',
    href: '#periodic',
    short: 'شهریه، بیمه و اشتراک‌ها با سهم ماهانه.',
    what: 'هزینه‌های تکرارشونده غیرروزانه؛ ثبت، تأمین و پرداخت — بدون اجبار به ساخت صندوق.',
    steps: [
      'هزینه جدید: نام، مبلغ، بازه تکرار، موعد بعدی و اولویت را وارد کنید.',
      'سهم ماهانه پیشنهادی با باقی‌مانده و موعد حساب می‌شود؛ می‌توانید مبلغ دلخواه بگذارید.',
      'تأمین تدریجی بدون صندوق ممکن است؛ پول را در حساب عادی هم می‌توانید نگه دارید.',
      'در موعد، پرداخت را ثبت کنید؛ در صورت کمبود موجودی صندوق، باقی از منابع دیگر تأمین می‌شود.',
      'اتصال به صندوق هدفمند اختیاری و یک‌به‌یک است؛ قطع اتصال هزینه را پاک نمی‌کند.',
      'اگر هزینه کاملاً تأمین شده باشد، سهم ماهانه صفر می‌شود.'
    ]
  },
  {
    id: 'funds',
    icon: '🎯',
    name: 'صندوق‌های هدفمند',
    href: '#funds',
    short: 'پس‌انداز جدا برای هر هدف مشخص.',
    what: 'صندوق مستقل برای هدفی مثل سفر یا خرید؛ واریز، برداشت، پیشرفت و تاریخچه.',
    steps: [
      'صندوق جدید با نام، هدف مبلغ و در صورت تمایل تاریخ هدف بسازید.',
      'واریز و برداشت را ثبت کنید تا موجودی و درصد پیشرفت به‌روز شود.',
      'اختیاری: یک هزینه دوره‌ای را به یک صندوق وصل کنید (هر صندوق فقط یک اتصال).',
      'حذف صندوق هزینه دوره‌ای متصل را پاک نمی‌کند؛ فقط پیوند را قطع می‌کند.',
      'صندوق اضطراری در داشبورد جدا از این صندوق‌هاست و با آن‌ها قاطی نمی‌شود.'
    ]
  },
  {
    id: 'reports',
    icon: '📈',
    name: 'گزارش‌ها',
    href: '#reports',
    short: 'خلاصه چندماهه درآمد و هزینه.',
    what: 'مرور روند مالی ماه‌های اخیر برای دیدن الگوی خرج.',
    steps: [
      'به صفحه گزارش‌ها بروید و اعداد ماه‌های موجود را مقایسه کنید.',
      'فقط ماه‌هایی که داده دارند نمایش داده می‌شوند؛ عدد ساختگی ساخته نمی‌شود.',
      'برای جزئیات دسته در یک ماه مشخص، از داشبورد و انتخاب ماه استفاده کنید.'
    ]
  },
  {
    id: 'budget',
    icon: '🧭',
    name: 'بودجه ماهانه',
    href: '#dashboard',
    short: 'سقف هزینه ماه و تخصیص اختیاری به دسته‌ها.',
    what: 'ابزار برنامه‌ریزی سقف خرج ماه جاری از داخل داشبورد.',
    steps: [
      'از داشبورد «تعیین بودجه» را باز کنید.',
      'سقف کل را وارد کنید یا فقط چند دسته را پر کنید تا جمع خودکار ساخته شود.',
      'دسته‌های خالی خطا نیستند و در جمع حساب نمی‌شوند.',
      'اگر از ماه قبل فقط سقف کل دارید، بدون پر کردن دسته همان را به ماه جدید منتقل کنید.',
      'رنگ سبز/زرد/قرمز نزدیکی هزینه واقعی به سقف را نشان می‌دهد.'
    ]
  },
  {
    id: 'advisor',
    icon: '🤖',
    name: 'تحلیل با هوش مصنوعی',
    href: '#dashboard',
    short: 'ساخت پرامپت ساختاریافته از داده‌های شما برای ChatGPT.',
    what: 'خلاصه داده‌ها را به متن پرامپت تبدیل می‌کند؛ چیزی به سرور همراه مالی فرستاده نمی‌شود.',
    steps: [
      'از داشبورد «دریافت پرامپت» را بزنید.',
      'بازه (این ماه / سه ماه / همه) را انتخاب کنید.',
      'متن را کپی کنید یا TXT/PDF بگیرید و در ChatGPT بچسبانید.',
      'تحلیل بر اساس دسته و مبلغ است؛ برچسب‌های قدیمی ضروری/ارزش خرید دیگر معیار اصلی نیستند.',
      'پاسخ هوش مصنوعی فقط پیشنهاد است، نه مشاوره رسمی.'
    ]
  },
  {
    id: 'education',
    icon: '📚',
    name: 'مسیر آموزشی ۱۲ قدمی',
    href: '#education',
    short: 'یادگیری مفهومی مدیریت مالی قدم‌به‌قدم.',
    what: 'مسیر آموزشی عمومی درباره عادت‌های مالی (جدا از آموزش کار با خودِ سایت).',
    steps: [
      'قدم‌ها به‌ترتیب باز می‌شوند؛ هر قدم را پس از تمرین علامت بزنید.',
      'پس از تکمیل، به‌صورت خودکار به قدم بعدی هدایت می‌شوید.',
      'نوار شماره قدم‌ها در بالا برای پرش به قدم‌های باز است.',
      'این بخش با «آموزش کار با سایت» فرق دارد: اینجا مفاهیم مالی است، آنجا نحوه استفاده از ابزارها.'
    ]
  },
  {
    id: 'guide',
    icon: '🛠️',
    name: 'آموزش کار با سایت',
    href: '#guide',
    short: 'آموزش تخصصی اینکه هر بخش سایت چیست و چطور استفاده شود.',
    what: 'راهنمای عملی کار با همراه مالی: هر ابزار برای چه کاری است و گام‌های استفاده.',
    steps: [
      'فصل‌ها را به ترتیب بخوانید یا از مرکز ابزارها وارد توضیح همان ابزار شوید.',
      'پس از خواندن هر فصل می‌توانید آن را علامت «خوانده‌شده» بزنید.',
      'برای رفتن مستقیم به ابزار، از دکمه‌های «رفتن به ابزار» استفاده کنید.'
    ]
  },
  {
    id: 'tools',
    icon: '🧰',
    name: 'مرکز ابزارها',
    href: '#tools',
    short: 'فهرست همه قابلیت‌ها با لینک و توضیح.',
    what: 'یک صفحه برای دیدن همه ابزارها، رفتن سریع به آن‌ها و باز کردن آموزش تخصصی همان ابزار.',
    steps: [
      'روی «رفتن به ابزار» بزنید تا همان بخش باز شود.',
      'روی «آموزش این ابزار» بزنید تا توضیح تخصصی همان مورد را ببینید.',
      'از این صفحه می‌توانید بدون گشتن در منو به هر قابلیت برسید.'
    ]
  },
  {
    id: 'help',
    icon: '❓',
    name: 'پرسش‌های متداول',
    href: '#help',
    short: 'پاسخ کوتاه به سوال‌های رایج.',
    what: 'FAQ برای گیرهای متداول مثل پشتیبان، موجودی اولیه و بودجه‌بندی.',
    steps: [
      'سوال مرتبط را باز کنید و پاسخ کوتاه را بخوانید.',
      'برای آموزش گام‌به‌گام ابزارها به «آموزش کار با سایت» یا «مرکز ابزارها» بروید.'
    ]
  },
  {
    id: 'settings',
    icon: '⚙️',
    name: 'تنظیمات',
    href: '#settings',
    short: 'تم، پین، پشتیبان و مدیریت داده.',
    what: 'تنظیم ظاهر، قفل پین، خروجی/ورود پشتیبان و پاک‌سازی داده‌ها.',
    steps: [
      'تم روشن/تیره را عوض کنید.',
      'پشتیبان JSON یا رمزدار بگیرید؛ روی دستگاه دیگر «ورود پشتیبان» کنید.',
      'پین اختیاری فقط روی همین مرورگر است؛ رمز پشتیبان را جدا یادداشت کنید.',
      'پاک‌سازی همه داده‌ها برگشت‌ناپذیر است؛ قبلش پشتیبان بگیرید.'
    ]
  },
  {
    id: 'backup',
    icon: '💾',
    name: 'پشتیبان‌گیری',
    href: '#settings',
    short: 'خروجی و بازیابی اطلاعات روی دستگاه.',
    what: 'حفظ داده‌ها هنگام تعویض مرورگر یا دستگاه؛ همگام‌سازی ابری ندارد.',
    steps: [
      'از تنظیمات یا پایین صفحات، خروجی پشتیبان بگیرید.',
      'فایل را در جای امن نگه دارید؛ در صورت رمزگذاری، رمز را فراموش نکنید.',
      'ورود پشتیبان داده‌های فعلی را جایگزین می‌کند؛ نسخه ساختار داده هنگام ورود یکسان‌سازی می‌شود.'
    ]
  }
];

const GUIDES = {
  periodic: {
    title: 'هزینه‌های دوره‌ای چطور کار می‌کنند؟',
    body: [
      'هزینه‌هایی مثل شهریه یا بیمه هر ماه نیستند اما تکرارشان مشخص است.',
      'ثبت هزینه، تأمین پول و پرداخت سه کار جدا هستند؛ مجبور به ساخت صندوق نیستید.',
      'با موعد مشخص، سهم ماهانه پیشنهادی حساب می‌شود؛ بدون موعد فقط خودتان مبلغ ماهانه تعیین می‌کنید.',
      'اختیاری: هزینه را به یک صندوق وصل کنید تا موجودی جدا ردیابی شود (هر صندوق فقط یک هزینه).',
      'بعد از پرداخت، موعد بعدی جلو می‌رود و می‌توانید تراکنش هزینه هم ثبت کنید.'
    ]
  },
  funds: {
    title: 'صندوق هدفمند چیست؟',
    body: [
      'هر صندوق برای یک هدف مشخص است و با پس‌انداز عمومی قاطی نمی‌شود.',
      'واریز، برداشت، درصد پیشرفت و در صورت موعد، سهم ماهانه پیشنهادی را می‌بینید.',
      'می‌توانید صندوق را مستقل نگه دارید یا به یک هزینه دوره‌ای وصل کنید.',
      'حذف صندوق، اتصال هزینه‌های مرتبط را قطع می‌کند؛ خودِ هزینه دوره‌ای پاک نمی‌شود.'
    ]
  },
  budgetFuture: {
    title: 'سهم آینده در بودجه ماهانه',
    body: [
      'جمع سهم ماهانه هزینه‌های دوره‌ای و صندوق‌های مستقل (بدون دوباره‌شماری متصل‌ها) اینجا دیده می‌شود.',
      'مانده پیشنهادی = درآمد ماه − هزینه‌های ثبت‌شده − تعهدات آینده.',
      'اگر مانده منفی باشد — حتی بدون تعهد آینده — وضعیت کسری نشان داده می‌شود.',
      'مبلغ ماهانه دلخواه را روی هر هزینه یا صندوق می‌توانید تنظیم کنید.'
    ]
  }
};

/** فصل‌های آموزش کار با سایت (نه مسیر ۱۲ قدمی مفهومی) */
const GUIDE_CHAPTERS = [
  {id:'start', title:'شروع کار با همراه مالی', body:'خانه، داشبورد، منوی پایین و دکمه + شناور را بشناسید. داده‌ها فقط روی همین دستگاه‌اند. از یک ثبت کوچک یا از «مرکز ابزارها» شروع کنید.'},
  {id:'tx', title:'ثبت درآمد و هزینه', body:'مبلغ، تاریخ شمسی، عنوان و برای هزینه دسته‌بندی را وارد کنید. ویرایش و حذف از فهرست تراکنش‌ها ممکن است. نیازی به برچسب ضروری یا ارزش خرید نیست.'},
  {id:'budget', title:'تنظیم بودجه ماهانه', body:'از داشبورد سقف کل یا چند دسته را تعیین کنید. دسته‌های خالی مجازند. اختلاف سقف کل با جمع دسته‌ها حفظ می‌شود مگر خودتان عمداً کمش کنید. انتقال سقف ماه قبل بدون دسته ممکن است.'},
  {id:'periodic', title:'مدیریت هزینه‌های دوره‌ای', body:'هزینه غیرماهانه را ثبت کنید، سهم ماهانه ببینید، تأمین و پرداخت کنید — با یا بدون صندوق. اتصال به صندوق اختیاری و یک‌به‌یک است.'},
  {id:'funds', title:'ساخت و مدیریت صندوق‌ها', body:'برای هر هدف یک صندوق بسازید، واریز/برداشت کنید و پیشرفت را ببینید. حذف صندوق هزینه دوره‌ای را پاک نمی‌کند.'},
  {id:'future', title:'تعهدات آینده در بودجه', body:'در داشبورد جمع سهم ماهانه دوره‌ای و صندوق‌ها را کنار درآمد و هزینه ببینید. کسری حتی بدون تعهد آینده هم نشان داده می‌شود.'},
  {id:'reports', title:'گزارش‌ها و الگوی خرج', body:'گزارش‌ها و انتخاب ماه در داشبورد برای دیدن هزینه واقعی بر اساس دسته است؛ ماه بدون داده پر نمی‌شود.'},
  {id:'backup', title:'پشتیبان‌گیری و امنیت', body:'خروجی JSON یا رمزدار از تنظیمات. پین اختیاری است. پاک کردن داده مرورگر اطلاعات را از بین می‌برد.'}
];

function findTool(id){
  return SITE_TOOLS.find(t => t.id === id) || null;
}

function showGuide(key){
  const g = GUIDES[key];
  if(g){
    const read = state.educationProgress.readGuides || [];
    if(!read.includes(key)){
      state.educationProgress.readGuides = read.concat([key]);
      save();
    }
    openDialog(
      `<h3 class="font-bold text-lg">${esc(g.title)}</h3>
       <ul class="text-sm leading-7 mt-2 space-y-2 list-disc pr-5">${g.body.map(t=>'<li>'+esc(t)+'</li>').join('')}</ul>`,
      () => {},
      {wide: true, info: true}
    );
    return;
  }
  showToolGuide(key);
}

function showToolGuide(id){
  const t = findTool(id);
  if(!t){ showToast('آموزش این بخش پیدا نشد.'); return; }
  const read = state.educationProgress.readGuides || [];
  const key = 'tool:'+t.id;
  if(!read.includes(key)){
    state.educationProgress.readGuides = read.concat([key]);
    save();
  }
  openDialog(
    `<h3 class="font-bold text-lg">${t.icon} ${esc(t.name)}</h3>
     <p class="text-sm leading-7 mt-2"><b>این ابزار چیست؟</b> ${esc(t.what)}</p>
     <p class="text-sm font-bold mt-3">چطور استفاده کنیم؟</p>
     <ol class="text-sm leading-7 mt-1 space-y-2 list-decimal pr-5">${t.steps.map(s=>'<li>'+esc(s)+'</li>').join('')}</ol>
     <p class="mt-4"><button type="button" class="btn text-sm" data-act="tool-go" data-href="${esc(t.href)}">رفتن به ${esc(t.name)}</button></p>`,
    () => {},
    {wide: true, info: true}
  );
}

/** مرکز همه ابزارها */
function renderToolsHub(){
  $('#app').innerHTML = `
  <section class="mb-6">
    <p class="text-sm font-bold" style="color:var(--primary)">همه قابلیت‌ها یک‌جا</p>
    <h1 class="text-2xl md:text-3xl font-bold mt-2">🧰 مرکز ابزارها</h1>
    <p class="muted mt-3 leading-8">روی هر ابزار بزنید تا همان بخش باز شود، یا آموزش تخصصی همان ابزار را بخوانید.</p>
    <div class="flex flex-wrap gap-2 mt-3">
      <a href="#guide" class="btn-ghost text-sm">آموزش کار با سایت</a>
      <a href="#help" class="btn-ghost text-sm">پرسش‌های متداول</a>
      <a href="#education" class="btn-ghost text-sm">مسیر ۱۲ قدمی (مفاهیم مالی)</a>
    </div>
  </section>
  <div class="grid gap-3 sm:grid-cols-2">
    ${SITE_TOOLS.map(t => `
      <article class="card flex flex-col">
        <div class="flex items-start gap-3">
          <span class="text-2xl" aria-hidden="true">${t.icon}</span>
          <div class="min-w-0 flex-1">
            <h2 class="font-bold text-lg">${esc(t.name)}</h2>
            <p class="muted text-sm mt-1 leading-7">${esc(t.short)}</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mt-4">
          <a href="${t.href}" class="btn text-sm">رفتن به ابزار</a>
          <button type="button" class="btn-ghost text-sm" data-act="tool-guide" data-id="${esc(t.id)}">آموزش این ابزار</button>
        </div>
      </article>
    `).join('')}
  </div>`;
}

/** آموزش تخصصی کار با بخش‌های سایت */
function renderGuideBook(){
  const done = state.educationProgress.guideChapters || [];
  const pct = Math.round(done.length / GUIDE_CHAPTERS.length * 100);
  $('#app').innerHTML = `
  <section class="mb-6">
    <p class="text-sm font-bold" style="color:var(--primary)">آموزش استفاده از همراه مالی</p>
    <h1 class="text-2xl md:text-3xl font-bold mt-2">آموزش کار با سایت</h1>
    <p class="muted mt-3 leading-8">اینجا یاد می‌گیرید هر بخش یا ابزار برای چیست و چطور از آن استفاده کنید. این صفحه با «مسیر آموزشی ۱۲ قدمی» (مفاهیم مالی) فرق دارد.</p>
    <div class="bar mt-4"><i style="width:${pct}%"></i></div>
    <p class="text-xs muted mt-1">${fa(done.length)} از ${fa(GUIDE_CHAPTERS.length)} فصل · ${fa(pct)}٪</p>
    <div class="flex flex-wrap gap-2 mt-3">
      <a href="#tools" class="btn text-sm">🧰 مرکز ابزارها</a>
      <a href="#education" class="btn-ghost text-sm">مسیر ۱۲ قدمی</a>
      <a href="#help" class="btn-ghost text-sm">پرسش‌های متداول</a>
    </div>
  </section>
  <div class="space-y-3">
    ${GUIDE_CHAPTERS.map((c,i) => {
      const on = done.includes(c.id);
      const tool = findTool(c.id) || findTool(c.id === 'future' ? 'dashboard' : c.id);
      return `<article class="card" id="guide-${esc(c.id)}">
        <div class="flex justify-between gap-2 items-start">
          <div><p class="text-xs muted">فصل ${fa(i+1)}</p>
            <h2 class="font-bold text-lg">${esc(c.title)}</h2></div>
          ${on ? '<span class="text-xs status-green rounded-full px-2 py-1">خوانده‌شده</span>' : ''}
        </div>
        <p class="text-sm leading-7 mt-2">${esc(c.body)}</p>
        <div class="flex flex-wrap gap-2 mt-3">
          <button type="button" class="btn-ghost text-sm" data-act="guide-chapter" data-id="${esc(c.id)}">${on?'علامت به‌عنوان نخوانده':'علامت به‌عنوان خوانده‌شده'}</button>
          ${tool ? `<button type="button" class="btn-ghost text-sm" data-act="tool-guide" data-id="${esc(tool.id)}">توضیح تخصصی‌تر</button>
          <a href="${tool.href}" class="btn text-sm">رفتن به ابزار</a>` : ''}
        </div>
      </article>`;
    }).join('')}
  </div>
  <section class="card mt-6">
    <h2 class="font-bold mb-2">همه ابزارها</h2>
    <p class="muted text-sm mb-3">اگر می‌خواهید فقط فهرست قابلیت‌ها را ببینید:</p>
    <a href="#tools" class="btn text-sm">باز کردن مرکز ابزارها</a>
  </section>`;
}

function toggleGuideChapter(id){
  let done = state.educationProgress.guideChapters || [];
  if(done.includes(id)) done = done.filter(x => x !== id);
  else done = done.concat([id]);
  state.educationProgress.guideChapters = done;
  save();
  render();
}

/* ---------- بودجه آینده‌نگر ---------- */
function futureBudgetSummaryHtml(mInc, mExpSum){
  const monthly = totalMonthlyFutureCommitments();
  const rows = commitmentRows();
  const income = Number(mInc)||0;
  const spent = Number(mExpSum)||0;
  const afterCurrent = income - spent;
  const remaining = afterCurrent - monthly;
  // کسری اگر مانده نهایی منفی باشد — مستقل از وجود تعهد آینده
  const shortfall = remaining < 0;
  const cashShort = afterCurrent < 0; // هزینه‌های جاری از درآمد بیشتر
  const ratio = income > 0 ? monthly / income : null;

  let suggestHtml = '';
  if(shortfall && monthly > 0 && rows.length){
    const needCut = Math.min(monthly, Math.abs(remaining)); // کاهش نباید از مجموع تعهدات بیشتر شود
    const withShare = rows.filter(r => r.amount > 0).sort((a,b) => b.amount - a.amount);
    if(withShare.length && needCut > 0){
      // توزیع کاهش متناسب روی تعهدات بزرگ‌تر
      let left = needCut;
      const proposals = [];
      for(const r of withShare){
        if(left <= 0) break;
        const cut = Math.min(r.amount, Math.ceil(left * (r.amount / monthly)));
        if(cut <= 0) continue;
        const reduced = Math.max(0, r.amount - cut);
        proposals.push({...r, reduced, cut});
        left -= cut;
      }
      // اگر هنوز کسری پوشش داده نشده، از بزرگ‌ترین‌ها کم کن
      if(left > 0){
        for(const p of proposals){
          if(left <= 0) break;
          const extra = Math.min(p.reduced, left);
          p.reduced -= extra;
          p.cut += extra;
          left -= extra;
        }
      }
      if(proposals.length){
        const totalCut = proposals.reduce((s,p)=>s+(p.cut||0),0);
        const list = proposals.map(p =>
          `«${esc(p.name)}»: ${money(p.amount)} → ${money(p.reduced)}`
        ).join(' · ');
        // payload برای اعمال یک‌جا: kind|id|amount;...
        const payload = proposals.map(p => p.kindKey+':'+p.id+':'+p.reduced).join(';');
        suggestHtml = `<div class="mt-3 text-sm leading-7 status-yellow rounded-lg px-2 py-2">
          <b>پیشنهاد پوشش کسری (حدود ${money(needCut)}):</b>
          <p class="mt-1">${list}</p>
          <button type="button" class="btn text-xs mt-2" data-act="apply-shortfall-plan" data-plan="${esc(payload)}">اعمال همه کاهش‌های پیشنهادی</button>
          <p class="text-xs muted mt-1">پس از اعمال، مانده دوباره محاسبه می‌شود. فقط اگر مانده منفی نباشد، برنامه مناسب اعلام می‌شود.</p>
        </div>`;
      }
    }
  } else if(cashShort && monthly <= 0){
    suggestHtml = `<div class="mt-3 text-sm leading-7 status-red rounded-lg px-2 py-2">
      هزینه‌های ثبت‌شده این ماه از درآمد بیشتر است. تعهد آینده‌ای ثبت نشده؛ ابتدا جریان نقدی جاری را بازبینی کنید.
    </div>`;
  }

  const planOk = !shortfall;
  return `
    <div class="mt-2 space-y-2">
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div class="rounded-lg p-2" style="background:var(--bg)"><p class="muted text-xs">درآمد ماه</p><p class="font-bold">${money(income)}</p></div>
        <div class="rounded-lg p-2" style="background:var(--bg)"><p class="muted text-xs">هزینه ثبت‌شده</p><p class="font-bold">${money(spent)}</p></div>
        <div class="rounded-lg p-2" style="background:var(--bg)"><p class="muted text-xs">تعهدات آینده</p><p class="font-bold">${rows.length?money(monthly):'—'}</p></div>
        <div class="rounded-lg p-2 ${planOk?'status-green':'status-red'}"><p class="text-xs opacity-80">مانده پس از تعهدات</p><p class="font-bold">${money(remaining)}</p></div>
      </div>
      <p class="text-xs ${planOk?'muted':''}">${planOk
        ? (rows.length
            ? 'برنامه این ماه از نظر تعهدات آینده با داده‌های ثبت‌شده قابل اجرا به نظر می‌رسد.'
            : 'تعهد آینده‌ای ثبت نشده. مانده بالا بر اساس درآمد و هزینه‌های ثبت‌شده است.')
        : 'برنامه مالی این ماه تحت فشار است (مانده منفی).'}</p>
      ${ratio != null && monthly > 0 ? `<p class="muted text-xs">تعهدات آینده ≈ ${fa(Math.round(ratio*100))}٪ درآمد ثبت‌شده</p>` : ''}
      ${rows.length ? `<ul class="mt-2 space-y-1.5 text-xs">
        ${rows.slice(0,10).map(r => `<li class="flex justify-between gap-2">
          <span class="truncate">${esc(r.name)} <span class="muted">(${r.kind})</span></span>
          <span class="nw">${r.amount>0||r.hasMonthly?money(r.amount):'—'}${r.override!=null?' *':''}</span>
        </li>`).join('')}
      </ul>
      ${rows.some(r=>r.override!=null) ? '<p class="muted text-xs">* سهم تنظیم‌شده توسط شما</p>' : ''}`
      : `<p class="muted text-xs mt-2">هنوز هزینه دوره‌ای یا صندوقی با سهم ماهانه ندارید. در صورت تمایل از بخش دوره‌ای یا صندوق‌ها اضافه کنید.</p>`}
      ${suggestHtml}
      <div class="flex flex-wrap gap-2 mt-2">
        <button type="button" class="btn-ghost text-xs" data-act="guide" data-guide="budgetFuture">این بخش چطور کار می‌کند؟</button>
        <a href="#guide" class="btn-ghost text-xs">راهنمای همراه مالی</a>
      </div>
    </div>`;
}

function setOverrideDialog(kind, id, presetAmount){
  const isFund = kind === 'fund';
  const item = isFund
    ? (state.sinkingFunds||[]).find(x => x.id === id)
    : (state.periodicExpenses||[]).find(x => x.id === id);
  if(!item) return;
  const name = isFund ? item.name : item.title;
  const cur = item.monthlyOverride != null ? item.monthlyOverride : '';
  const suggested = presetAmount != null ? presetAmount : '';
  openDialog(
    `<h3 class="font-bold text-lg">سهم ماهانه دلخواه</h3>
     <p class="muted text-sm">${esc(name)}</p>
     <p class="muted text-xs leading-6">خالی بگذارید تا در صورت داشتن موعد، محاسبه خودکار استفاده شود.</p>`
    + field('مبلغ ماهانه ('+state.settings.currency+')',
      `<input class="inp money-inp" name="ov" type="text" inputmode="numeric" dir="ltr" value="${formatMoneyTyping(String(suggested!==''?suggested:cur))}" placeholder="خالی = خودکار">`),
    fd => {
      const raw = String(fd.get('ov')||'').trim();
      if(raw === ''){
        item.monthlyOverride = null;
      } else {
        const v = parseMoneyStr(raw);
        if(v === null || v < 0){ showToast('مبلغ نامعتبر است.'); return false; }
        item.monthlyOverride = Math.round(v);
      }
      save();
      showToast('سهم ماهانه ذخیره شد.');
    }
  );
}

function handleFutureAction(a, b){
  if(a === 'periodic-new'){ periodicDialog(); return true; }
  if(a === 'periodic-edit'){
    const p = state.periodicExpenses.find(x => x.id === b.dataset.id);
    if(p) periodicDialog(p);
    return true;
  }
  if(a === 'periodic-pay'){ periodicMarkPaid(b.dataset.id); return true; }
  if(a === 'periodic-fund'){ periodicAddFunding(b.dataset.id); return true; }
  if(a === 'periodic-toggle'){ periodicToggle(b.dataset.id); return true; }
  if(a === 'periodic-delete'){ periodicDelete(b.dataset.id); return true; }
  if(a === 'guide'){ showGuide(b.dataset.guide); return true; }
  if(a === 'tool-guide'){
    showToolGuide(b.dataset.id);
    return true;
  }
  if(a === 'tool-go'){
    try{ dlg.close(); }catch(e){}
    const href = b.dataset.href || '#home';
    if(location.hash === href){ render(); }
    else location.hash = href.replace(/^#/, '#') === href ? href : href;
    return true;
  }
  if(a === 'dlg-close'){ try{ dlg.close(); }catch(e){} return true; }
  if(a === 'guide-chapter'){ toggleGuideChapter(b.dataset.id); return true; }
  if(a === 'calc-big'){ bigExpenseCalcDialog(); return true; }
  if(a === 'set-override'){
    setOverrideDialog(b.dataset.kind, b.dataset.id, b.dataset.amount != null ? Number(b.dataset.amount) : null);
    return true;
  }
  if(a === 'apply-shortfall-plan'){
    const plan = String(b.dataset.plan||'');
    if(!plan){ showToast('پیشنهادی برای اعمال نیست.'); return true; }
    let changed = 0;
    plan.split(';').forEach(part => {
      const [kind, id, amountStr] = part.split(':');
      if(!kind || !id) return;
      const amount = Math.max(0, Math.round(Number(amountStr)||0));
      if(kind === 'fund'){
        const f = (state.sinkingFunds||[]).find(x => x.id === id);
        if(f){ f.monthlyOverride = amount; changed++; }
      } else {
        const p = (state.periodicExpenses||[]).find(x => x.id === id);
        if(p){ p.monthlyOverride = amount; changed++; }
      }
    });
    if(!changed){ showToast('موردی برای به‌روزرسانی پیدا نشد.'); return true; }
    save();
    showToast(fa(changed)+' سهم ماهانه طبق پیشنهاد به‌روز شد. مانده را دوباره ببینید.');
    render();
    return true;
  }
  return false;
}
