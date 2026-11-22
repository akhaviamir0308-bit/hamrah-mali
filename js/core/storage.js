/* ---------- ذخیره‌سازی محلی و مدل داده ---------- */
const KEY = 'hamrah-mali:v1';
let mem = null;

const DEFAULT = () => ({
  schemaVersion: 5,
  settings:{currency:'تومان',dateFormat:'Jalali',initialBalance:0,theme:'system',lastBackupAt:'',pinHash:'',pinEnabled:false,autoLockMin:0},
  categories:[
    ...['خوراک','مسکن','حمل‌ونقل','قبوض','سلامت','تفریح','آموزش','سایر'].map((n,i)=>({id:'e'+i,name:n,type:'expense',isActive:true,isCustom:false})),
    ...['حقوق','کار آزاد','سایر'].map((n,i)=>({id:'i'+i,name:n,type:'income',isActive:true,isCustom:false}))],
  incomes:[],expenses:[],budgets:[],savingsGoals:[],debts:[],
  emergencyFund:{targetAmount:0,currentAmount:0},
  educationProgress:{completedSteps:[],readGuides:[],guideChapters:[]},
  achievements:{patternFinder:false,unlocked:{}},
  sinkingFunds:[],
  periodicExpenses:[],
  monthOpeningBalances:{}
});

function normAch(a){
  a = (a && typeof a==='object') ? a : {};
  return {patternFinder: !!a.patternFinder, unlocked: (a.unlocked && typeof a.unlocked==='object') ? a.unlocked : {}};
}

function normalizeSinkingFunds(list){
  if(!Array.isArray(list)) return [];
  return list.filter(f => f && typeof f === 'object' && String(f.name||'').trim() && Number.isFinite(Number(f.targetAmount)) && Number(f.targetAmount) > 0).map(f => {
    const history = Array.isArray(f.history) ? f.history.filter(h =>
      h && typeof h === 'object' && ['deposit','withdraw'].includes(h.type) &&
      Number.isFinite(Number(h.amount)) && Number(h.amount) > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(h.date||''))
    ).map(h => ({
      id: String(h.id||uid()).slice(0,80),
      type: h.type,
      amount: Math.round(Number(h.amount)),
      date: String(h.date),
      note: String(h.note||'').slice(0,160)
    })) : [];
    const historyBalance = history.reduce((sum,h)=>sum+(h.type==='deposit'?h.amount:-h.amount),0);
    const current = Math.max(0, Math.round(Number(f.currentAmount)||0));
    let monthlyOverride = null;
    if(pHasOverride(f.monthlyOverride)) monthlyOverride = Math.max(0, Math.round(Number(f.monthlyOverride)));
    return {
      id: String(f.id||uid()).slice(0,80),
      name: String(f.name).trim().slice(0,60),
      targetAmount: Math.max(1, Math.round(Number(f.targetAmount)||1)),
      currentAmount: history.length ? Math.max(0, historyBalance) : current,
      targetDate: /^\d{4}-\d{2}-\d{2}$/.test(String(f.targetDate||'')) ? String(f.targetDate) : '',
      linkedPeriodicId: f.linkedPeriodicId ? String(f.linkedPeriodicId).slice(0,80) : null,
      monthlyOverride,
      history,
      createdAt: /^\d{4}-\d{2}-\d{2}$/.test(String(f.createdAt||'')) ? String(f.createdAt) : todayISO()
    };
  });
}

function pHasOverride(v){
  if(v === null || v === undefined || v === '') return false;
  return Number.isFinite(Number(v)) && Number(v) >= 0;
}

const PERIODIC_INTERVALS = [1, 2, 3, 6, 12];
const PERIODIC_PRIORITIES = ['high', 'medium', 'low'];

function normalizePeriodicExpenses(list){
  if(!Array.isArray(list)) return [];
  const rows = list.filter(p => p && typeof p === 'object' && String(p.title||'').trim() && Number.isFinite(Number(p.amount)) && Number(p.amount) > 0).map(p => {
    let interval = Math.round(Number(p.intervalMonths)||1);
    if(!PERIODIC_INTERVALS.includes(interval)) interval = 1;
    const priority = PERIODIC_PRIORITIES.includes(p.priority) ? p.priority : 'medium';
    let monthlyOverride = null;
    if(pHasOverride(p.monthlyOverride)) monthlyOverride = Math.max(0, Math.round(Number(p.monthlyOverride)));
    return {
      id: String(p.id||uid()).slice(0,80),
      title: String(p.title).trim().slice(0,80),
      amount: Math.max(1, Math.round(Number(p.amount)||1)),
      intervalMonths: interval,
      nextDueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(p.nextDueDate||'')) ? String(p.nextDueDate) : '',
      priority,
      paused: !!p.paused,
      linkedFundId: p.linkedFundId ? String(p.linkedFundId).slice(0,80) : null,
      fundedAmount: Math.max(0, Math.round(Number(p.fundedAmount)||0)),
      monthlyOverride,
      notes: String(p.notes||'').slice(0,200),
      createdAt: /^\d{4}-\d{2}-\d{2}$/.test(String(p.createdAt||'')) ? String(p.createdAt) : todayISO(),
      lastPaidAt: /^\d{4}-\d{2}-\d{2}$/.test(String(p.lastPaidAt||'')) ? String(p.lastPaidAt) : ''
    };
  });
  // یک‌به‌یک: اگر چند هزینه به یک صندوق اشاره کنند، فقط اولین نگه داشته می‌شود
  const seenFunds = new Set();
  rows.forEach(p => {
    if(!p.linkedFundId) return;
    if(seenFunds.has(p.linkedFundId)) p.linkedFundId = null;
    else seenFunds.add(p.linkedFundId);
  });
  return rows;
}

/** همگام‌سازی لینک‌های دوطرفه پس از بارگذاری */
function reconcileLinks(data){
  const funds = data.sinkingFunds || [];
  const periodics = data.periodicExpenses || [];
  const fundById = Object.fromEntries(funds.map(f => [f.id, f]));
  funds.forEach(f => { f.linkedPeriodicId = null; });
  periodics.forEach(p => {
    if(!p.linkedFundId) return;
    const f = fundById[p.linkedFundId];
    if(!f){ p.linkedFundId = null; return; }
    if(f.linkedPeriodicId && f.linkedPeriodicId !== p.id){
      // صندوق قبلاً به هزینه دیگری وصل است
      p.linkedFundId = null;
      return;
    }
    f.linkedPeriodicId = p.id;
  });
  return data;
}

function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const d = JSON.parse(raw);
      const base = DEFAULT();
      const edu = Object.assign(base.educationProgress, d.educationProgress || {});
      if(!Array.isArray(edu.readGuides)) edu.readGuides = [];
      if(!Array.isArray(edu.guideChapters)) edu.guideChapters = [];
      const data = {
        schemaVersion: 5,
        settings: Object.assign(base.settings, d.settings||{}),
        categories: Array.isArray(d.categories) && d.categories.length ? d.categories : base.categories,
        incomes: Array.isArray(d.incomes) ? d.incomes : [],
        expenses: Array.isArray(d.expenses) ? d.expenses : [],
        budgets: Array.isArray(d.budgets) ? d.budgets.map(b => Object.assign({allocations:[]}, b, {allocations: Array.isArray(b.allocations)?b.allocations:[]})) : [],
        savingsGoals: Array.isArray(d.savingsGoals) ? d.savingsGoals : [],
        debts: Array.isArray(d.debts) ? d.debts : [],
        emergencyFund: Object.assign(base.emergencyFund, d.emergencyFund||{}),
        educationProgress: edu,
        achievements: normAch(d.achievements),
        sinkingFunds: normalizeSinkingFunds(d.sinkingFunds),
        periodicExpenses: normalizePeriodicExpenses(d.periodicExpenses),
        monthOpeningBalances: (d.monthOpeningBalances && typeof d.monthOpeningBalances==='object') ? d.monthOpeningBalances : {}
      };
      return reconcileLinks(data);
    }
  }catch(e){ console.warn('خواندن ناموفق', e); }
  return mem ? JSON.parse(mem) : DEFAULT();
}

function save(){
  const s = JSON.stringify(state);
  mem = s;
  try{ localStorage.setItem(KEY, s); }
  catch(e){
    console.warn('ذخیره ناموفق', e);
    showToast('ذخیره روی دستگاه ممکن نشد. ممکن است حافظه مرورگر پر باشد یا حالت خصوصی فعال باشد.');
  }
}

let state = load();

const catName = id => (state.categories.find(c=>c.id===id)||{name:'—'}).name;
const money = n => fa(n)+' '+state.settings.currency;

function needsLockScreen(){
  return !!(state.settings && state.settings.pinEnabled && state.settings.pinHash) && !isSessionUnlocked();
}
