/**
 * Statistical Agent — DB-powered financial insight engine
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ACCURACY CONTRACT  (must mirror Overview.jsx exactly)             ║
 * ║  Income  = CREDIT transactions on INCOME-type accounts             ║
 * ║  Expense = DEBIT  transactions on EXPENSE-type accounts            ║
 * ║  Assets / Liabilities = journal_entries cumulative balances         ║
 * ║  Reversals (debit on INCOME / credit on EXPENSE) → excluded        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const supabase = require('../config/supabaseClient');
// const logger   = require('../utils/logger');
const logger   = require('../utils/logger');
// ─── Catch-all account name filter ──────────────────────────────────
const CATCH_ALL_EXACT = new Set([
  'uncategorized','uncategorised','unclassified expenses','unclassified assets',
  'unclassified','suspense','suspense account','opening balance','opening bal',
  'temporary','temp','temp account','other','others','miscellaneous','misc',
  'undefined','unknown','general','assets','liabilities','income','expenses',
  'equity','current assets','fixed assets','non-current assets',
  'current liabilities','long-term liabilities','non-current liabilities',
]);

function isCatchAll(name) {
  if (!name) return true;
  const l = name.toLowerCase().trim();
  if (CATCH_ALL_EXACT.has(l)) return true;
  return l.includes('uncategor') || l.includes('unclassif') ||
         l.includes('suspense')  || l.includes('opening bal') ||
         l.includes('temp');
}

// Skip contra + uncategorised rows (same as dashboard)
function baseFilter(q) {
  return q.neq('is_contra', true).neq('is_uncategorised', true);
}

// ─── Month map ────────────────────────────────────────────────────────
const MON = {
  january:0,jan:0,february:1,feb:1,march:2,mar:2,april:3,apr:3,
  may:4,june:5,jun:5,july:6,jul:6,august:7,aug:7,
  september:8,sep:8,sept:8,october:9,oct:9,november:10,nov:10,december:11,dec:11,
};

function pad2(n) { return String(n).padStart(2,'0'); }
function dateStr(y,m1,d) { return `${y}-${pad2(m1)}-${pad2(d)}`; }

// ─── Currency formatters ─────────────────────────────────────────────
const INR    = v => `₹${Math.abs(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const INRr   = v => `₹${Math.abs(v).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
const INRsig = v => (v < 0 ? `-₹` : `₹`) + Math.abs(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});

// ════════════════════════════════════════════════════════════════════════
// DATE FILTER — supports every natural language date form
// ════════════════════════════════════════════════════════════════════════
function extractDateFilter(q) {
  if (!q) return { from:null, to:null, label:'Overall' };
  const s = q.toLowerCase().trim();
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth();

  // "jan 2025", "january 2025", "jan month 2025"
  const mnRe = /(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s*(?:month)?\s*(\d{4})/i;
  const mn = s.match(mnRe);
  if (mn) {
    const mi = MON[mn[1].toLowerCase()], yr = +mn[2], m1 = mi+1;
    const ld = new Date(yr,mi+1,0).getDate();
    const isCur = cy===yr && cm===mi;
    const fullN = Object.keys(MON).find(k=>MON[k]===mi&&k.length>3)||mn[1];
    return { from:dateStr(yr,m1,1), to:dateStr(yr,m1,isCur?now.getDate():ld),
             label: isCur?'This Month':`${fullN[0].toUpperCase()+fullN.slice(1)} ${yr}` };
  }

  // "04/2025"
  const mmyy = s.match(/\b(\d{1,2})\/(\d{4})\b/);
  if (mmyy) {
    const mi=+mmyy[1]-1, yr=+mmyy[2];
    if (mi>=0&&mi<=11) {
      const m1=mi+1, ld=new Date(yr,mi+1,0).getDate(), isCur=cy===yr&&cm===mi;
      return { from:dateStr(yr,m1,1), to:dateStr(yr,m1,isCur?now.getDate():ld),
               label:isCur?'This Month':`${pad2(m1)}/${yr}` };
    }
  }

  // "2025-04"
  const yymm = s.match(/\b(\d{4})-(\d{1,2})\b/);
  if (yymm) {
    const yr=+yymm[1], mi=+yymm[2]-1;
    if (yr>2000&&mi>=0&&mi<=11) {
      const m1=mi+1, ld=new Date(yr,mi+1,0).getDate(), isCur=cy===yr&&cm===mi;
      return { from:dateStr(yr,m1,1), to:dateStr(yr,m1,isCur?now.getDate():ld),
               label:isCur?'This Month':`${yr}-${pad2(m1)}` };
    }
  }

  // "15/04/2025"
  const dmy = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmy) {
    const d=+dmy[1],m=+dmy[2],y=+dmy[3];
    if (m>=1&&m<=12&&d>=1&&d<=31) { const ds=dateStr(y,m,d); return {from:ds,to:ds,label:ds}; }
  }

  // Relative keywords (ordered longest→shortest)
  if (/this\s*month/i.test(s)) {
    const m1=cm+1;
    return {from:dateStr(cy,m1,1),to:dateStr(cy,m1,now.getDate()),label:'This Month'};
  }
  if (/last\s*month/i.test(s)) {
    const lm=cm===0?11:cm-1, ly=cm===0?cy-1:cy, m1=lm+1, ld=new Date(ly,lm+1,0).getDate();
    const fn=Object.keys(MON).find(k=>MON[k]===lm&&k.length>3)||String(m1);
    return {from:dateStr(ly,m1,1),to:dateStr(ly,m1,ld),label:`Last Month (${fn[0].toUpperCase()+fn.slice(1)} ${ly})`};
  }
  if (/this\s*week/i.test(s)||/last\s*7\s*days/i.test(s)||/past\s*7\s*days/i.test(s)) {
    return {from:new Date(Date.now()-7*864e5).toISOString().slice(0,10),to:null,label:'Last 7 Days'};
  }
  if (/last\s*30\s*days/i.test(s)||/past\s*30\s*days/i.test(s)) {
    return {from:new Date(Date.now()-30*864e5).toISOString().slice(0,10),to:null,label:'Last 30 Days'};
  }
  if (/last\s*3\s*months/i.test(s)||/past\s*3\s*months/i.test(s)||/last\s*90\s*days/i.test(s)) {
    return {from:new Date(Date.now()-90*864e5).toISOString().slice(0,10),to:null,label:'Last 3 Months'};
  }
  if (/last\s*6\s*months/i.test(s)||/past\s*6\s*months/i.test(s)||/last\s*180\s*days/i.test(s)) {
    return {from:new Date(Date.now()-180*864e5).toISOString().slice(0,10),to:null,label:'Last 6 Months'};
  }
  if (/last\s*year/i.test(s)) {
    const ly=cy-1;
    return {from:dateStr(ly,1,1),to:dateStr(ly,12,31),label:`Last Year (${ly})`};
  }
  if (/this\s*year/i.test(s)||/last\s*12\s*months/i.test(s)) {
    return {from:dateStr(cy,1,1),to:null,label:'This Year'};
  }
  if (/last\s*quarter/i.test(s)||/this\s*quarter/i.test(s)) {
    return {from:new Date(Date.now()-90*864e5).toISOString().slice(0,10),to:null,label:'Last Quarter'};
  }

  // Standalone year "2024", "in 2024"
  const yrOnly = s.match(/\b(20\d{2})\b/);
  if (yrOnly) {
    const yr=+yrOnly[1];
    return {from:dateStr(yr,1,1),to:yr===cy?null:dateStr(yr,12,31),label:yr===cy?'This Year':`Year ${yr}`};
  }

  return {from:null,to:null,label:'Overall'};
}

// ════════════════════════════════════════════════════════════════════════
// CORE: computePnL — mirrors Overview.jsx logic exactly
// ════════════════════════════════════════════════════════════════════════
async function computePnL(userId, from, to) {
  let q = supabase
    .from('transactions')
    .select('transaction_id,amount,details,transaction_date,transaction_type,accounts!transactions_offset_account_id_fkey(account_name,account_type,parent_account:parent_account_id(account_name))')
    .eq('user_id', userId);
  if (from) q = q.gte('transaction_date', from);
  if (to)   q = q.lte('transaction_date', to);
  q = baseFilter(q);

  const { data, error } = await q;
  if (error) throw error;

  let totalIncome = 0, totalExpense = 0;
  const incomeMap = {}, expenseMap = {};
  const incomeParentMap = {}, expenseParentMap = {}; // New maps for parent aggregation
  const incomeTxns = [], expenseTxns = [];

  (data || []).forEach(txn => {
    const name = txn.accounts?.account_name;
    const pName = txn.accounts?.parent_account?.account_name;
    const aType = txn.accounts?.account_type;
    if (isCatchAll(name)) return;
    const amt = Number(txn.amount || 0);

    const parentKey = pName && !isCatchAll(pName) ? pName : name; // Fallback to child if no parent

    if (aType === 'INCOME' && txn.transaction_type === 'INCOME') {
      totalIncome += amt;
      incomeMap[name] = (incomeMap[name]||0) + amt;
      incomeParentMap[parentKey] = (incomeParentMap[parentKey]||0) + amt;
      incomeTxns.push(txn);
    } else if (aType === 'EXPENSE' && txn.transaction_type === 'EXPENSE') {
      totalExpense += amt;
      expenseMap[name] = (expenseMap[name]||0) + amt;
      expenseParentMap[parentKey] = (expenseParentMap[parentKey]||0) + amt;
      expenseTxns.push(txn);
    }
  });

  return { totalIncome, totalExpense, incomeMap, expenseMap, incomeParentMap, expenseParentMap, incomeTxns, expenseTxns, raw: data||[] };
}

// ════════════════════════════════════════════════════════════════════════
// CORE: computeBalanceSheet — Assets & Liabilities from journal_entries
// ════════════════════════════════════════════════════════════════════════

const formatDate = (dateStringOrDate) => {
  if (!dateStringOrDate) return '';
  let date;
  if (typeof dateStringOrDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStringOrDate)) {
    const [year, month, day] = dateStringOrDate.split('-');
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(dateStringOrDate);
  }
  if (isNaN(date.getTime())) return dateStringOrDate;
  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
};

const formatMonthYear = (dateStringOrDate) => {
  if (!dateStringOrDate) return '';
  let date;
  if (typeof dateStringOrDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStringOrDate)) {
    const [year, month, day] = dateStringOrDate.split('-');
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(dateStringOrDate);
  }
  if (isNaN(date.getTime())) return dateStringOrDate;
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${month}-${year}`;
};

async function computeBalanceSheet(userId) {
  const { data: entries, error } = await supabase
    .from('journal_entries')
    .select('debit_amount,credit_amount,account:account_id(account_id,account_name,account_type,balance_nature)')
    .eq('user_id', userId);
  if (error) throw error;

  const map = {};
  (entries||[]).forEach(e => {
    if (!e.account) return;
    const { account_id:id, account_name:name, account_type:type, balance_nature:bn } = e.account;
    if (!['ASSET','LIABILITY'].includes(type)) return;
    if (!map[id]) map[id] = { name, type, bn, dr:0, cr:0 };
    map[id].dr += e.debit_amount  || 0;
    map[id].cr += e.credit_amount || 0;
  });

  let totalAssets=0, totalLiabilities=0;
  const assets=[], liabilities=[];

  Object.values(map).forEach(a => {
    const bal = a.bn==='DEBIT' ? a.dr-a.cr : a.cr-a.dr;
    if (a.type==='ASSET') { totalAssets+=bal; if(Math.abs(bal)>0) assets.push({name:a.name,amount:bal}); }
    else { totalLiabilities+=bal; if(Math.abs(bal)>0) liabilities.push({name:a.name,amount:bal}); }
  });

  assets.sort((a,b)=>b.amount-a.amount);
  liabilities.sort((a,b)=>b.amount-a.amount);
  return { totalAssets, totalLiabilities, assets, liabilities };
}

// ════════════════════════════════════════════════════════════════════════
// HANDLER DISPATCH
// ════════════════════════════════════════════════════════════════════════
async function handleStatisticalQuery(subIntent, userId, originalQuery) {
  logger.info('StatAgent', { subIntent, userId: userId?.slice(0,8) });
  switch (subIntent) {
    case 'ACCOUNT_COUNT':           return hAccountCount(userId);
    case 'ACCOUNT_LIST':            return hAccountList(userId);
    case 'BANK_ACCOUNT_SUMMARY':    return hBankSummary(userId);
    case 'INCOME_VS_EXPENSE':       return hIncomeVsExpense(userId, originalQuery);
    case 'TOTAL_INCOME':            return hTotalIncome(userId, originalQuery);
    case 'TOTAL_EXPENSE':           return hTotalExpense(userId, originalQuery);
    case 'TOTAL_SAVINGS':           return hTotalSavings(userId, originalQuery);
    case 'SAVINGS_TREND':           return hSavingsTrend(userId, originalQuery);
    case 'BUDGET_INSIGHT':          return hBudgetInsight(userId, originalQuery);
    case 'NET_WORTH':               return hNetWorth(userId);
    case 'ASSETS_ONLY':             return hAssetsOnly(userId);
    case 'LIABILITIES_ONLY':        return hLiabilitiesOnly(userId);
    case 'BALANCE_OVERVIEW':        return hBalanceOverview(userId);
    case 'TOP_SPENDING_CATEGORY':   return hTopCategories(userId, originalQuery);
    case 'SPECIFIC_CATEGORY_SPEND': return hSpecificCategory(userId, originalQuery);
    case 'MAX_TRANSACTION':         return hMaxTransaction(userId, originalQuery);
    case 'MIN_TRANSACTION':         return hMinTransaction(userId, originalQuery);
    case 'MAX_CREDIT':              return hMaxCredit(userId, originalQuery);
    case 'AVG_TRANSACTION':         return hAvgTransaction(userId, originalQuery);
    case 'TRANSACTION_COUNT':       return hTransactionCount(userId, originalQuery);
    case 'MONTHLY_SUMMARY':         return hMonthlySummary(userId, originalQuery);
    case 'YEARLY_SUMMARY':          return hYearlySummary(userId);
    case 'RECENT_TRANSACTIONS':     return hRecentTransactions(userId, originalQuery);
    case 'UNIVERSAL_QUERY':
    default:                        return hUniversalQuery(userId, originalQuery);
  }
}

// ════════════════════════════════════════════════════════════════════════
// HANDLERS
// ════════════════════════════════════════════════════════════════════════

async function hAccountCount(userId) {
  const { data:accs, error:e1 } = await supabase
    .from('accounts').select('account_id').eq('user_id',userId).eq('account_type','ASSET').eq('is_active',true);
  if (e1) throw e1;
  const ids = (accs||[]).map(a=>a.account_id);
  if (!ids.length) return {text:"You haven't linked any bank accounts yet. Head to the **Accounts** page! 🏦", data:{count:0}};

  const { data:idents, error:e2 } = await supabase
    .from('account_identifiers').select('institution_name,account_number_last4,card_last4,wallet_id')
    .eq('user_id',userId).eq('is_active',true).in('account_id',ids);
  if (e2) throw e2;

  const count = (idents||[]).length;
  const insts = [...new Set((idents||[]).map(i=>i.institution_name).filter(Boolean))];
  const banks = (idents||[]).filter(i=>i.account_number_last4).length;
  const cards = (idents||[]).filter(i=>i.card_last4).length;
  const wallets=(idents||[]).filter(i=>i.wallet_id).length;

  let text = `🏦 You have **${count} linked account${count!==1?'s':''}**.`;
  if (insts.length) text += `\n\n📋 Institutions: ${insts.join(', ')}`;
  const bd=[]; if(banks) bd.push(`${banks} Bank${banks>1?'s':''}`); if(cards) bd.push(`${cards} Card${cards>1?'s':''}`); if(wallets) bd.push(`${wallets} Wallet${wallets>1?'s':''}`);
  if(bd.length) text += `\n📊 Breakdown: ${bd.join(' • ')}`;
  return {text, data:{count,institutions:insts,banks,cards,wallets}};
}

async function hAccountList(userId) {
  const { data:accs, error:e1 } = await supabase
    .from('accounts').select('account_id,account_name').eq('user_id',userId).eq('account_type','ASSET').eq('is_active',true);
  if (e1) throw e1;
  if (!accs?.length) return {text:"No accounts found. Add some from the **Accounts** page! 🏦", data:[]};

  const ids = accs.map(a=>a.account_id);
  const { data:idents } = await supabase
    .from('account_identifiers').select('account_id,institution_name,account_number_last4,card_last4,wallet_id')
    .eq('user_id',userId).in('account_id',ids);

  const imap = {}; (idents||[]).forEach(i=>{ imap[i.account_id]=i; });
  const lines = accs.map((a,i) => {
    const id=imap[a.account_id];
    const inst=id?.institution_name||a.account_name;
    const last4=id?.account_number_last4?`····${id.account_number_last4}`:id?.card_last4?`····${id.card_last4} (Card)`:id?.wallet_id?`Wallet`:'-';
    return `  ${i+1}. 🏦 **${inst}** — ${last4}`;
  });
  return {text:`📋 **Your Linked Accounts (${accs.length}):**\n\n${lines.join('\n')}`, data:accs};
}

async function hBankSummary(userId) {
  const { data:accs } = await supabase
    .from('accounts').select('account_id,account_name,balance_nature').eq('user_id',userId).eq('account_type','ASSET').eq('is_active',true);
  if (!accs?.length) return {text:"No asset accounts found.", data:[]};

  const ids=accs.map(a=>a.account_id);
  const [{ data:idents },{ data:ledger }] = await Promise.all([
    supabase.from('account_identifiers').select('account_id,institution_name,account_number_last4,card_last4').eq('user_id',userId).in('account_id',ids),
    supabase.from('journal_entries').select('account_id,debit_amount,credit_amount').eq('user_id',userId).in('account_id',ids),
  ]);

  const imap={},lmap={};
  (idents||[]).forEach(i=>{ imap[i.account_id]=i; });
  (ledger||[]).forEach(e=>{ if(!lmap[e.account_id])lmap[e.account_id]={dr:0,cr:0}; lmap[e.account_id].dr+=e.debit_amount||0; lmap[e.account_id].cr+=e.credit_amount||0; });

  let total=0;
  const lines=accs.map((a,i)=>{
    const l=lmap[a.account_id]||{dr:0,cr:0};
    const bal=a.balance_nature==='DEBIT'?l.dr-l.cr:l.cr-l.dr;
    total+=bal;
    const id=imap[a.account_id];
    const inst=id?.institution_name||a.account_name;
    const last4=id?.account_number_last4?` ····${id.account_number_last4}`:id?.card_last4?` ····${id.card_last4}`:'';
    return `  ${i+1}. ${bal>=0?'🟢':'🔴'} **${inst}**${last4}: **${INR(bal)}**`;
  });

  return {text:`🏦 **Bank Account Summary:**\n\n${lines.join('\n')}\n\n💰 **Total Assets: ${INR(total)}**`, data:{accounts:accs.length,totalBalance:total}};
}

async function hIncomeVsExpense(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  const {totalIncome:inc,totalExpense:exp}=await computePnL(userId,from,to);
  if(!inc&&!exp) return {text:`No categorized transactions found for **${label}**.`, data:null};
  const net=inc-exp, rate=inc>0?((net/inc)*100).toFixed(1):'0.0';
  return {
    text:`💰 **Income vs Expense (${label}):**\n\n  🟢 Income: **${INR(inc)}**\n  🔴 Expenses: **${INR(exp)}**\n  ${net>=0?'✅':'⚠️'} Net: **${INR(net)}**\n  📈 Savings Rate: **${rate}%**`,
    data:{income:inc,expense:exp,net,savingsRate:rate}
  };
}

async function hTotalIncome(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  const {totalIncome,incomeMap}=await computePnL(userId,from,to);
  if(!totalIncome) return {text:`No categorized income found for **${label}**.`, data:null};
  const sorted=Object.entries(incomeMap).sort((a,b)=>b[1]-a[1]);
  const lines=sorted.slice(0,5).map(([c,a],i)=>`  ${i+1}. **${c}** — ${INRr(a)} (${((a/totalIncome)*100).toFixed(1)}%)`);
  return {
    text:`🟢 **Total Income (${label}): ${INR(totalIncome)}**\n\n**Sources:**\n${lines.join('\n')}\n\n_${sorted.length} income categor${sorted.length===1?'y':'ies'}_`,
    data:{totalIncome,breakdown:sorted}
  };
}

async function hTotalExpense(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  const {totalExpense,expenseMap}=await computePnL(userId,from,to);
  if(!totalExpense) return {text:`No categorized expenses found for **${label}**.`, data:null};
  const sorted=Object.entries(expenseMap).sort((a,b)=>b[1]-a[1]);
  const lines=sorted.slice(0,5).map(([c,a],i)=>`  ${i+1}. **${c}** — ${INRr(a)} (${((a/totalExpense)*100).toFixed(1)}%)`);
  return {
    text:`🔴 **Total Expense (${label}): ${INR(totalExpense)}**\n\n**Top Categories:**\n${lines.join('\n')}\n\n_${sorted.length} expense categor${sorted.length===1?'y':'ies'}_`,
    data:{totalExpense,breakdown:sorted}
  };
}

async function hTotalSavings(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  const {totalIncome:inc,totalExpense:exp}=await computePnL(userId,from,to);
  const sav=inc-exp;
  const rate=inc>0?((sav/inc)*100).toFixed(1):'0.0';

  // No data at all
  if(!inc && !exp) {
    return {text:`No categorized financial data found for **${label}**.\n\n_Upload or categorize your transactions to track savings._`, data:null};
  }

  // Build header line with SIGNED value (not absolute)
  const savLine = sav >= 0
    ? `✅ **Net Savings: ${INR(sav)}**`
    : `⚠️ **Net Savings: -${INR(Math.abs(sav))}** _(Overspending)_`;

  let text = `💰 **Your Savings (${label}):**\n\n`;
  if (inc > 0) {
    text += `  🟢 Income: **${INR(inc)}**\n`;
  } else {
    text += `  🟡 Income: **₹0.00** _(No income transactions tracked)_\n`;
  }
  text += `  🔴 Expense: **${INR(exp)}**\n`;
  text += `  ${savLine}\n`;
  text += `  📈 Savings Rate: **${rate}%**\n\n`;

  if (inc === 0) {
    text += `_💡 No income has been recorded yet. Add your income transactions to calculate savings rate accurately._`;
  } else if (sav > 0) {
    text += `_Great! You're saving **${rate}%** of your income._`;
  } else if (sav === 0) {
    text += `_Breaking even — income equals expenses._`;
  } else {
    text += `_⚠️ You're spending **${INR(Math.abs(sav))}** more than your income. Review your top expense categories._`;
  }
  return {text, data:{income:inc,expense:exp,savings:sav,savingsRate:rate}};
}

async function hNetWorth(userId) {
  const bs=await computeBalanceSheet(userId);
  const nw=bs.totalAssets-bs.totalLiabilities;
  let text=`🏛️ **Net Worth:**\n\n  🏦 Total Assets: **${INR(bs.totalAssets)}**\n  📋 Total Liabilities: **${INR(bs.totalLiabilities)}**\n  ${nw>=0?'✅':'⚠️'} **Net Worth: ${INR(nw)}**\n\n`;
  text+=nw>0?`_Assets exceed liabilities — you're in a strong position!_`:nw===0?`_Assets equal liabilities._`:`_⚠️ Liabilities exceed assets by ${INR(Math.abs(nw))}._`;
  return {text, data:{totalAssets:bs.totalAssets,totalLiabilities:bs.totalLiabilities,netWorth:nw}};
}

async function hAssetsOnly(userId) {
  const bs=await computeBalanceSheet(userId);
  let text=`🏦 **Total Assets: ${INR(bs.totalAssets)}**\n\n`;
  if(bs.assets.length){
    text+=`**Breakdown:**\n`;
    bs.assets.forEach((a,i)=>{ const p=bs.totalAssets>0?((a.amount/bs.totalAssets)*100).toFixed(1):0; text+=`  ${i+1}. ${a.name}: **${INR(a.amount)}** (${p}%)\n`; });
  } else text+=`_No asset accounts found._`;
  return {text, data:{totalAssets:bs.totalAssets,breakdown:bs.assets}};
}

async function hLiabilitiesOnly(userId) {
  const bs=await computeBalanceSheet(userId);
  let text=`📋 **Total Liabilities: ${INR(bs.totalLiabilities)}**\n\n`;
  if(bs.liabilities.length){ text+=`**Breakdown:**\n`; bs.liabilities.forEach((l,i)=>{ text+=`  ${i+1}. ${l.name}: **${INR(l.amount)}**\n`; }); }
  else text+=`_No liabilities found. You're debt-free! 🎉_`;
  return {text, data:{totalLiabilities:bs.totalLiabilities,breakdown:bs.liabilities}};
}

async function hBalanceOverview(userId) {
  const [{totalIncome:inc,totalExpense:exp}, bs] = await Promise.all([
    computePnL(userId,null,null),
    computeBalanceSheet(userId),
  ]);
  const net=inc-exp;
  let text=`📊 **Financial Overview:**\n\n`;
  text+=`  🟢 Total Income: **${INR(inc)}**\n`;
  text+=`  🔴 Total Expense: **${INR(exp)}**\n`;
  text+=`  💰 Net Savings: **${INR(net)}** ${net>=0?'✅':'⚠️'}\n\n`;
  text+=`  🏦 Total Assets: **${INR(bs.totalAssets)}**\n`;
  text+=`  📋 Total Liabilities: **${INR(bs.totalLiabilities)}**\n`;
  text+=`  🏛️ Net Worth: **${INR(bs.totalAssets-bs.totalLiabilities)}**\n`;
  if(bs.assets.length){ text+=`\n**Top Assets:**\n`; bs.assets.slice(0,3).forEach(a=>{ text+=`  • ${a.name}: ${INR(a.amount)}\n`; }); }
  if(bs.liabilities.length){ text+=`\n**Top Liabilities:**\n`; bs.liabilities.slice(0,3).forEach(l=>{ text+=`  • ${l.name}: ${INR(l.amount)}\n`; }); }
  return {text, data:{totalIncome:inc,totalExpense:exp,netSavings:net,totalAssets:bs.totalAssets,totalLiabilities:bs.totalLiabilities}};
}

async function hTopCategories(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  const {totalExpense,expenseMap}=await computePnL(userId,from,to);
  if(!Object.keys(expenseMap).length) return {text:`No categorized expense data found for **${label}**.`, data:[]};
  const sorted=Object.entries(expenseMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const lines=sorted.map(([c,a],i)=>`  ${i+1}. **${c}** — ${INRr(a)} (${((a/totalExpense)*100).toFixed(1)}%)`);
  return {
    text:`🔥 **Top Spending Categories (${label}):**\n\n${lines.join('\n')}\n\n💰 Total: ${INRr(totalExpense)}`,
    data:sorted
  };
}

async function hSpecificCategory(userId, q) {
  const {from, to, label} = extractDateFilter(q);
  const {expenseMap, expenseParentMap} = await computePnL(userId, from, to);

  if (!Object.keys(expenseMap).length) {
    return {text: `No categorized expenses found for **${label}**.`, data: []};
  }

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 1: Regex patterns (direct extraction)
  // Handles: "how much did i spend in subscriptions", "expense on food"
  // ══════════════════════════════════════════════════════════════════════
  const escAmp = String.fromCharCode(38); // & — avoids encoding issues
  let catRaw =
    (q.match(new RegExp(`(?:spend(?:ing)?|spent|expense|paid|pay|spendings?)\\s+(?:on|in|for|at|towards?)\\s+([a-z][a-z\\s${escAmp}\\/,'\\-]{1,40})`, 'i'))||[])[1] ||
    (q.match(/(?:how\s+much)\s+(?:did\s+i|have\s+i|i)\s+(?:spend|spent|paid|pay)\s+(?:on|in|for|at|towards?)\s+([a-z][a-z\s&\/,'\-]{1,40})/i)||[])[1] ||
    (q.match(/(?:how\s+much)\s+(?:do\s+i\s+)?(?:spend|spent|pay|paid)\s+(?:on|for|in|at|towards?)\s+([a-z][a-z\s&\/,'\-]{1,40})/i)||[])[1] ||
    (q.match(/(?:on|in|for|at|towards?)\s+([a-z][a-z\s&\/,'\-]{1,30})\s+(?:spend(?:ing)?|expense|payment)/i)||[])[1] ||
    (q.match(/(?:expense|spend(?:ing)?|spendings?)\s+(?:of|in|on)\s+([a-z][a-z\s&\/,'\-]{1,30})/i)||[])[1] ||
    (q.match(/(?:spend(?:ing)?|spendings?)\s+(?:in|on)?\s*([a-z][a-z\s&\/,'\-]{1,40})$/i)||[])[1];

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 2: Verb-strip fallback
  // Handles: "tell me about subscriptions", "my grocery bills", "rent this month"
  // ══════════════════════════════════════════════════════════════════════
  if (!catRaw) {
    const stripped = q.toLowerCase()
      .replace(/^(what(?:'s)?|how\s+much|show|tell|give|get|list|display|check|see)\s+(are|is|my|the|i|was|do\s+i|did\s+i|has|have|me|were|about|for)?\s*/i, '')
      .replace(/\b(spending|spendings|spend|spent|expense|expenses|expenditure|paid|payment|bills?|costs?|charges?)\b/ig, '')
      .replace(/\b(in|on|for|at|towards|overall|total|all|my|this|last|past|current|month|year|week|today|how|much|i|me|the|a|an)\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped && stripped.length > 1) catRaw = stripped;
  }

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 3: Direct DB category name scan
  // If query contains a word that directly matches a category token → use it
  // Handles: "my healthcare expenses", "food budget", "what about travel"
  // ══════════════════════════════════════════════════════════════════════
  if (!catRaw) {
    const ql = q.toLowerCase();
    let bestDirectMatch = null, bestDirectScore = 0;
    Object.entries(expenseMap).forEach(([name]) => {
      const catTokens = name.toLowerCase().split(/[\s&\/,'\-]+/).filter(w => w.length > 2);
      let score = 0;
      catTokens.forEach(ct => { if (ql.includes(ct)) score += ct.length; });
      if (score > bestDirectScore) { bestDirectScore = score; bestDirectMatch = name; }
    });
    if (bestDirectMatch && bestDirectScore >= 4) catRaw = bestDirectMatch;
  }

  if (!catRaw) return hTopCategories(userId, q);

  // Clean & normalize
  const catClean = catRaw.trim().toLowerCase()
    .replace(/\b(this|last|in|for|of|overall|total|all|my|past|20\d{2}|month|year|week|today|current)\b.*$/i, '')
    .trim();

  if (!catClean || catClean.length < 2) return hTopCategories(userId, q);

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 4: Semantic similarity scoring against DB category names
  // Token overlap + substring match + stem matching + synonym expansion
  // ══════════════════════════════════════════════════════════════════════
  const SYNONYMS = {
    'sub':          ['subscription','subscriptions'],
    'subs':         ['subscription','subscriptions'],
    'subscription': ['subscriptions'],
    'grocery':      ['groceries','food','supermarket','provisions'],
    'groceries':    ['grocery','food','supermarket'],
    'food':         ['dining','restaurant','grocery','groceries','meal','eating','swiggy','zomato'],
    'dining':       ['food','restaurant','eating','meal'],
    'medicine':     ['medical','healthcare','pharmacy','health','hospital','clinic','doctor'],
    'medical':      ['healthcare','health','medicine','hospital','clinic','doctor'],
    'phone':        ['mobile','telecom','telephone','communication','recharge','topup'],
    'mobile':       ['phone','telecom','telephone','communication','recharge'],
    'electricity':  ['electric','power','electricity','utilities','utility','bill'],
    'light':        ['electricity','electric','power','utilities','utility'],
    'water':        ['water','bill','utilities','utility'],
    'gas':          ['cylinder','gas','utilities','utility'],
    'dth':          ['utilities','utility','telecom','tv','cable'],
    'internet':     ['broadband','wifi','connection','utilities'],
    'clothes':      ['clothing','apparel','garments','shopping','myntra','fashion'],
    'clothing':     ['clothes','apparel','garments','fashion'],
    'petrol':       ['fuel','gas','diesel','transport','vehicle'],
    'fuel':         ['petrol','gas','diesel','transport','vehicle'],
    'cab':          ['taxi','uber','ola','ride','commute','transport','travel'],
    'taxi':         ['cab','uber','ola','ride','commute','transport','travel'],
    'ott':          ['netflix','prime','hotstar','streaming','subscription','entertainment'],
    'netflix':      ['streaming','subscription','ott','entertainment'],
    'amazon':       ['shopping','ecommerce','subscription'],
    'rent':         ['housing','accommodation','flat','apartment','house','maintenance'],
    'emi':          ['loan','mortgage','installment','debt','liability'],
    'gym':          ['fitness','exercise','health','wellness','yoga'],
    'school':       ['tuition','fees','college','learning','education'],
    'academic':     ['tuition','college','learning','school','education'],
    'insurance':    ['policy','premium','coverage','protection'],
    'refund':       ['refunds','cashback','reimbursement','reversal'],
    'cashback':     ['refund','rewards','reward','credit'],
    'donation':     ['donations','charity','gift','contribution'],
    'gift':         ['gifts','donation','charity'],
    'living':       ['lifestyle','domestic','essentials','household'],
  };

  const queryTokens = catClean.split(/\s+/).filter(w => w.length > 1);
  let bestMatch = null, bestScore = 0;

  // Search across BOTH child subcategories AND parent aggregates!
  const combinedMap = { ...expenseMap, ...expenseParentMap };

  Object.entries(combinedMap).forEach(([name, amt]) => {
    const dbTokens = name.toLowerCase().split(/[\s&\/,'\-]+/).filter(w => w.length > 1);
    let score = 0;

    // Exact token match (strongest)
    queryTokens.forEach(qt => { if (dbTokens.includes(qt)) score += 2; });

    // Synonym expansion - weighted by array position (index 0 is highest priority)
    queryTokens.forEach(qt => {
      (SYNONYMS[qt] || []).forEach((syn, index) => {
        if (dbTokens.some(dt => dt.includes(syn) || syn.includes(dt))) {
           score += Math.max(0.4, 1.5 - (index * 0.3)); // 1.5, 1.2, 0.9, 0.6... 
        }
      });
    });

    // Substring / stem match
    queryTokens.forEach(qt => {
      if (qt.length >= 3) {
        dbTokens.forEach(dt => {
          if (dt.includes(qt) || qt.includes(dt)) score += 0.8;
          // Stem: "subscription" ↔ "subscriptions"
          if (qt.length >= 5 && dt.length >= 5) {
            const stem = Math.min(qt.length, dt.length) - 2;
            if (qt.slice(0, stem) === dt.slice(0, stem)) score += 0.6;
          }
        });
      }
    });

    if (score > bestScore) { bestScore = score; bestMatch = {name, amt}; }
  });

  // Minimum confidence guard
  if (!bestMatch || bestScore < 0.5) {
    const catList = Object.entries(expenseParentMap)
      .sort((a,b)=>b[1]-a[1]).slice(0,5)
      .map(([c],i)=>`  ${i+1}. ${c}`).join('\n');
    return {
      text: `No expenses found matching **"${catClean}"** for **${label}**.\n\n**Your available categories:**\n${catList}\n\n_Try one of the names above._`,
      data: []
    };
  }

  // ── Rich response ─────────────────────────────────────────────────────
  const totalExp = Object.values(expenseParentMap).reduce((s,v)=>s+v, 0);
  const pct = totalExp > 0 ? ((bestMatch.amt / totalExp) * 100).toFixed(1) : '0';
  
  // Dynamically select the correct ranking pool (Parent map vs Subcategory map)
  const rankMap = expenseParentMap[bestMatch.name] ? expenseParentMap : expenseMap;
  const rank = Object.entries(rankMap).sort((a,b)=>b[1]-a[1]).findIndex(([n])=>n===bestMatch.name) + 1;
  const rankTotal = Object.keys(rankMap).length;

  let text = `📂 **"${bestMatch.name}" — Expenses (${label}):**\n\n`;
  text += `  🔴 Total Spent: **${INR(bestMatch.amt)}**\n`;
  text += `  📊 Share of total expenses: **${pct}%**\n`;

  if (rank > 0) text += `  🏆 Ranked **#${rank}** of ${rankTotal} categories\n`;

  return {
    text,
    data: {category: bestMatch.name, total: bestMatch.amt, percentOfTotal: pct, rank}
  };
}


async function hMaxTransaction(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  let query=supabase.from('transactions')
    .select('amount,details,transaction_date,transaction_type,accounts!transactions_offset_account_id_fkey(account_name,account_type)')
    .eq('user_id',userId).eq('transaction_type','EXPENSE');
  if(from) query=query.gte('transaction_date',from);
  if(to)   query=query.lte('transaction_date',to);
  query=baseFilter(query).order('amount',{ascending:false}).limit(30);
  const {data,error}=await query; if(error) throw error;
  const txn=(data||[]).find(t=>t.accounts?.account_type==='EXPENSE'&&!isCatchAll(t.accounts?.account_name));
  if(!txn) return {text:`No categorized expense found for **${label}**.`, data:null};
  const d = formatDate(txn.transaction_date);
  return {text:`💸 **Largest Single Expense (${label}):**\n\n  • Amount: **${INR(+txn.amount)}**\n  • Category: ${txn.accounts?.account_name||'N/A'}\n  • Details: ${txn.details||'N/A'}\n  • Date: ${d}`, data:txn};
}

async function hMaxCredit(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  let query=supabase.from('transactions')
    .select('amount,details,transaction_date,transaction_type,accounts!transactions_offset_account_id_fkey(account_name,account_type)')
    .eq('user_id',userId).eq('transaction_type','INCOME');
  if(from) query=query.gte('transaction_date',from);
  if(to)   query=query.lte('transaction_date',to);
  query=baseFilter(query).order('amount',{ascending:false}).limit(30);
  const {data,error}=await query; if(error) throw error;
  const txn=(data||[]).find(t=>t.accounts?.account_type==='INCOME'&&!isCatchAll(t.accounts?.account_name));
  if(!txn) return {text:`No categorized income found for **${label}**.`, data:null};
  const d = formatDate(txn.transaction_date);
  return {text:`💚 **Largest Income Transaction (${label}):**\n\n  • Amount: **${INR(+txn.amount)}**\n  • Category: ${txn.accounts?.account_name||'N/A'}\n  • Details: ${txn.details||'N/A'}\n  • Date: ${d}`, data:txn};
}

async function hMinTransaction(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  let query=supabase.from('transactions')
    .select('amount,details,transaction_date,transaction_type,accounts!transactions_offset_account_id_fkey(account_name,account_type)')
    .eq('user_id',userId).eq('transaction_type','EXPENSE').gt('amount',0);
  if(from) query=query.gte('transaction_date',from);
  if(to)   query=query.lte('transaction_date',to);
  query=baseFilter(query).order('amount',{ascending:true}).limit(30);
  const {data,error}=await query; if(error) throw error;
  const txn=(data||[]).find(t=>t.accounts?.account_type==='EXPENSE'&&!isCatchAll(t.accounts?.account_name));
  if(!txn) return {text:`No categorized expense found for **${label}**.`, data:null};
  const d = formatDate(txn.transaction_date);
  return {text:`🔍 **Smallest Expense (${label}):**\n\n  • Amount: **${INR(+txn.amount)}**\n  • Category: ${txn.accounts?.account_name||'N/A'}\n  • Details: ${txn.details||'N/A'}\n  • Date: ${d}`, data:txn};
}

async function hAvgTransaction(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  const {totalExpense,expenseTxns}=await computePnL(userId,from,to);
  if(!expenseTxns.length) return {text:`No categorized expenses found for **${label}**.`, data:null};
  const avg=totalExpense/expenseTxns.length;
  return {text:`📈 **Average Expense (${label}): ${INR(avg)}**\n\nBased on **${expenseTxns.length.toLocaleString()}** expense transactions.`, data:{average:avg,count:expenseTxns.length}};
}

async function hTransactionCount(userId, q) {
  const {from,to,label}=extractDateFilter(q);
  const {incomeTxns,expenseTxns}=await computePnL(userId,from,to);
  const total=incomeTxns.length+expenseTxns.length;
  if(!total) return {text:`No categorized transactions found for **${label}**.`, data:{total:0,label}};
  return {
    text:`📊 **Transaction Count (${label}):**\n\n  • Total: **${total.toLocaleString()}**\n  • 🔴 Expenses: ${expenseTxns.length.toLocaleString()}\n  • 🟢 Income: ${incomeTxns.length.toLocaleString()}`,
    data:{total,debits:expenseTxns.length,credits:incomeTxns.length,label}
  };
}

async function hMonthlySummary(userId, q) {
  let {from, to, label} = extractDateFilter(q);
  
  // If month is not explicitly mentioned, default to current month
  // Note: extractDateFilter returns from=null for 'Overall'
  if (!from) {
    const lg = q.toLowerCase();
    // If not "last 3 months" or similar explicit range
    if (!/last\s*\d|past\s*\d|quarter|year/i.test(lg)) {
      const now = new Date();
      const cy = now.getFullYear();
      const m1 = now.getMonth() + 1;
      from = dateStr(cy, m1, 1);
      to = dateStr(cy, m1, now.getDate());
      label = 'This Month';
    }
  }

  const dispLabel = from ? label : 'Last 3 Months';
  const filterFrom = from || new Date(Date.now()-90*864e5).toISOString().slice(0,10);

  // Fallback to month-by-month if explicit multi-month range requested
  if (dispLabel === 'Last 3 Months' || /last\s*\d|past\s*\d|month\s*(?:by|on)\s*month|mom|monthly|quarter|year/i.test(q.toLowerCase())) {
     let query=supabase.from('transactions')
      .select('amount,transaction_date,transaction_type,accounts!transactions_offset_account_id_fkey(account_name,account_type)')
      .eq('user_id',userId).gte('transaction_date',filterFrom);
    if(to) query=query.lte('transaction_date',to);
    query=baseFilter(query);
    const {data,error}=await query; if(error) throw error;

    const monthMap={};
    (data||[]).forEach(txn=>{
      const name=txn.accounts?.account_name, aType=txn.accounts?.account_type;
      if(isCatchAll(name)) return;
      const month=formatMonthYear(txn.transaction_date);
      if(!monthMap[month]) monthMap[month]={income:0,expense:0};
      if(aType==='INCOME'&&txn.transaction_type==='INCOME') monthMap[month].income+=+(txn.amount||0);
      else if(aType==='EXPENSE'&&txn.transaction_type==='EXPENSE') monthMap[month].expense+=+(txn.amount||0);
    });

    if(!Object.keys(monthMap).length) return {text:`No categorized transactions in **${dispLabel}**.`, data:null};

    const lines=Object.entries(monthMap).map(([m,{income,expense}])=>{
      const net=income-expense;
      return `  📅 **${m}:** Income: ${INRr(income)} | Expense: ${INRr(expense)} | Net: ${net>=0?'✅':'⚠️'} ${INRr(net)}`;
    });
    return {text:`📊 **Monthly Summary (${dispLabel}):**\n\n${lines.join('\n')}`, data:monthMap};
  }

  // Normal current/specific month logic - full breakdown
  const {totalIncome, totalExpense, expenseMap} = await computePnL(userId, from, to);
  
  if (!totalIncome && !totalExpense) {
    return {text:`No categorized transactions found in **${label}**.`, data:null};
  }

  const net = totalIncome - totalExpense;
  const sortedExpenses = Object.entries(expenseMap).sort((a,b) => b[1] - a[1]);
  
  let text = `📊 **Monthly Summary (${label}):**\n\n`;
  text += `  🟢 Income: **${INR(totalIncome)}**\n`;
  text += `  🔴 Expense: **${INR(totalExpense)}**\n`;
  text += `  💰 Net: ${net >= 0 ? '✅' : '⚠️'} **${INR(net)}**\n`;

  if (sortedExpenses.length > 0) {
    text += `\n**All Expenses Breakdown:**\n`;
    sortedExpenses.forEach(([c, a], i) => {
      const pct = totalExpense > 0 ? ((a / totalExpense) * 100).toFixed(1) : 0;
      text += `  ${i+1}. **${c}** — ${INRr(a)} (${pct}%)\n`;
    });
  }

  return {text, data: {totalIncome, totalExpense, net, breakdown: sortedExpenses}};
}

async function hYearlySummary(userId) {
  const {incomeTxns,expenseTxns}=await computePnL(userId,null,null);
  const all=[...incomeTxns,...expenseTxns];
  if(!all.length) return {text:`No categorized transactions found.`, data:null};

  const yearMap={};
  all.forEach(txn=>{
    const yr=new Date(txn.transaction_date).getFullYear();
    if(!yearMap[yr]) yearMap[yr]={income:0,expense:0};
    if(txn.accounts?.account_type==='INCOME'&&txn.transaction_type==='INCOME') yearMap[yr].income+=+(txn.amount||0);
    else if(txn.accounts?.account_type==='EXPENSE'&&txn.transaction_type==='EXPENSE') yearMap[yr].expense+=+(txn.amount||0);
  });

  const lines=Object.keys(yearMap).sort().map(yr=>{
    const {income,expense}=yearMap[yr], net=income-expense;
    return `  📅 **${yr}:** Income: ${INRr(income)} | Expense: ${INRr(expense)} | Net: ${net>=0?'✅':'⚠️'} ${INRr(net)}`;
  });
  return {text:`📊 **Yearly Summary:**\n\n${lines.join('\n')}`, data:yearMap};
}

async function hRecentTransactions(userId, q) {
  const {from, to, label} = extractDateFilter(q);

  // If a date range is specified, show ALL transactions in that period (up to 50).
  // If no date range, fall back to last N (default 10, up to 50).
  const numMatch = q.match(/\b(last|recent|show)\s+(\d+)\b/i) || q.match(/\b(\d+)\b/);
  const explicitNum = numMatch ? +numMatch[numMatch.length - 1] : null;
  const hasPeriod = !!(from); // has an explicit date range

  // "last 3 months" without explicit count → show up to 50 transactions
  const limit = hasPeriod ? (explicitNum || 50) : Math.min(explicitNum || 10, 50);

  let query = supabase.from('transactions')
    .select('amount,details,transaction_date,transaction_type,accounts!transactions_offset_account_id_fkey(account_name,account_type)')
    .eq('user_id', userId);

  if (from) query = query.gte('transaction_date', from);
  if (to)   query = query.lte('transaction_date', to);

  query = baseFilter(query).order('transaction_date', {ascending: false}).limit(limit * 3);
  const {data, error} = await query; if (error) throw error;

  const valid = (data || []).filter(t => !isCatchAll(t.accounts?.account_name)).slice(0, limit);
  if (!valid.length) return {text: `No categorized transactions found for **${label}**.`, data: []};

  const lines = valid.map((t, i) => {
    const d = formatDate(t.transaction_date);
    const icon = t.transaction_type === 'INCOME' ? '🟢' : '🔴';
    return `  ${i+1}. ${icon} **${INR(+t.amount)}** — ${t.details || t.accounts?.account_name || 'N/A'} (${d})`;
  });

  const periodNote = hasPeriod ? ` (${label})` : '';
  const countNote = valid.length >= limit
    ? `\n\n_Showing ${limit} transactions. Ask for a specific count like "show last 20 transactions" for more._`
    : '';
  return {
    text: `📋 **Transactions${periodNote} — ${valid.length} records:**\n\n${lines.join('\n')}${countNote}`,
    data: valid
  };
}

async function hSavingsTrend(userId, q) {
  // Determine lookback window
  let lookbackDays = 180; // default 6 months
  if (/3\s*month|90\s*day|quarter/i.test(q)) lookbackDays = 90;
  else if (/1\s*year|12\s*month|annual/i.test(q)) lookbackDays = 365;
  else if (/3\s*month/i.test(q)) lookbackDays = 90;

  const fromDate = new Date(Date.now() - lookbackDays * 864e5).toISOString().slice(0, 10);
  const label = lookbackDays === 365 ? 'Last 12 Months' : lookbackDays === 90 ? 'Last 3 Months' : 'Last 6 Months';

  let query = supabase.from('transactions')
    .select('amount,transaction_date,transaction_type,accounts!transactions_offset_account_id_fkey(account_name,account_type)')
    .eq('user_id', userId).gte('transaction_date', fromDate);
  query = baseFilter(query);
  const {data, error} = await query;
  if (error) throw error;

  const monthMap = {};
  (data || []).forEach(txn => {
    const name = txn.accounts?.account_name, aType = txn.accounts?.account_type;
    if (isCatchAll(name)) return;
    const d = new Date(txn.transaction_date);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const monthLabel = formatMonthYear(d);
    if (!monthMap[key]) monthMap[key] = {label: monthLabel, income:0, expense:0};
    const amt = Number(txn.amount || 0);
    if (aType==='INCOME' && txn.transaction_type==='INCOME') monthMap[key].income += amt;
    else if (aType==='EXPENSE' && txn.transaction_type==='EXPENSE') monthMap[key].expense += amt;
  });

  if (!Object.keys(monthMap).length) return {text:`No categorized transactions found in **${label}**.`, data:null};

  let totalSaved = 0;
  const lines = Object.keys(monthMap).sort().map(k => {
    const {label:ml, income, expense} = monthMap[k];
    const net = income - expense;
    totalSaved += net;
    const icon = net >= 0 ? '📈' : '📉';
    const netStr = net >= 0 ? `+${INRr(net)}` : `-${INRr(Math.abs(net))}`;
    return `  ${icon} **${ml}:** Income ${INRr(income)} | Expense ${INRr(expense)} | Saved **${netStr}**`;
  });

  const totalIcon = totalSaved >= 0 ? '✅' : '⚠️';
  const totalStr  = totalSaved >= 0 ? `+${INR(totalSaved)}` : `-${INR(Math.abs(totalSaved))}`;

  return {
    text: `📊 **Savings Trend (${label}):**\n\n${lines.join('\n')}\n\n${totalIcon} **Net Cumulative: ${totalStr}**`,
    data: { monthMap, totalSaved, label }
  };
}

// ════════════════════════════════════════════════════════════════════════
// BUDGET INSIGHT — uses past spending as a proxy "budget" reference
// Handles: "budget breakdown", "budget for entertainment", "suggest a budget",
//          "what categories to reduce", "planned vs actual", "allocate income"
// ════════════════════════════════════════════════════════════════════════
async function hBudgetInsight(userId, q) {
  const ql = q.toLowerCase();

  // Detect if user is asking about a specific category budget
  const catMatch = q.match(/budget\s+(?:for|on|in|of)\s+([a-z][a-z\s&/,'-]{1,35})/i) ||
                   q.match(/(?:remaining|left)\s+(?:budget|money)\s+(?:for|in|on)\s+([a-z][a-z\s&/,'-]{1,35})/i) ||
                   q.match(/([a-z][a-z\s&/,'-]{1,35})\s+budget/i);

  // Always fetch this month's spending as the baseline
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth();
  const m1 = cm + 1;
  const fromThis = dateStr(cy, m1, 1);
  const toThis   = dateStr(cy, m1, now.getDate());

  // Also fetch last 3 months for average
  const from3m = new Date(Date.now() - 90 * 864e5).toISOString().slice(0,10);

  const [thisMonth, last3m] = await Promise.all([
    computePnL(userId, fromThis, toThis),
    computePnL(userId, from3m, null),
  ]);

  // ── Case 1: Specific category budget ────────────────────────────────
  if (catMatch) {
    const catRaw = (catMatch[1] || '').trim().toLowerCase()
      .replace(/\b(this|last|month|year|my|overall|total)\b.*/i, '').trim();
    if (catRaw && catRaw.length > 1) {
      const queryTokens = new Set(catRaw.split(/\s+/).filter(w => w.length > 1));
      let bestMatch = null, bestScore = 0;
      Object.entries(thisMonth.expenseMap).forEach(([name, amt]) => {
        const dbTokens = new Set(name.toLowerCase().split(/[\s&/,'-]+/).filter(w => w.length > 1));
        let overlap = 0;
        queryTokens.forEach(t => { if (dbTokens.has(t)) overlap++; });
        queryTokens.forEach(t => {
          if (t.length >= 3) dbTokens.forEach(d => { if (d.includes(t)||t.includes(d)) overlap += 0.5; });
        });
        if (overlap > bestScore) { bestScore = overlap; bestMatch = {name, amt}; }
      });

      if (bestMatch && bestScore >= 0.5) {
        // estimate avg from last 3 months
        const avg3m = (last3m.expenseMap[bestMatch.name] || 0) / 3;
        const pct = avg3m > 0 ? ((bestMatch.amt / avg3m) * 100).toFixed(0) : null;
        const statusIcon = bestMatch.amt <= avg3m ? '✅' : '⚠️';
        let text = `💳 **Budget Insight — ${bestMatch.name}:**\n\n`;
        text += `  🔴 Spent this month: **${INR(bestMatch.amt)}**\n`;
        text += `  📊 3-month avg (reference budget): **${INRr(avg3m)}**\n`;
        if (pct) text += `  ${statusIcon} You're at **${pct}%** of your average spending for this category.\n`;
        if (bestMatch.amt > avg3m) {
          text += `\n_⚠️ You're spending above your usual amount in **${bestMatch.name}**. Consider reducing by ${INRr(bestMatch.amt - avg3m)}._`;
        } else {
          text += `\n_✅ You're within your usual spending range for **${bestMatch.name}**._`;
        }
        return {text, data:{category:bestMatch.name,spentThisMonth:bestMatch.amt,avgMonthly:avg3m}};
      }
    }
  }

  // ── Case 2: Suggest a budget / allocate income ────────────────────────
  if (/suggest|recommend|plan|allocat|how\s+much\s+should|ideal/i.test(ql)) {
    const inc = last3m.totalIncome / 3;  // avg monthly income
    const exp = last3m.totalExpense / 3; // avg monthly expense
    const sav = inc - exp;

    // 50/30/20 rule suggestion
    const needs = inc * 0.50, wants = inc * 0.30, savings = inc * 0.20;
    let text = `💡 **Suggested Budget Based on Your Data:**\n\n`;

    if (inc > 0) {
      text += `📊 Based on your avg 3-month income of **${INRr(inc)}/month:**\n\n`;
      text += `  🏠 **Needs (50%):** ${INRr(needs)} — rent, groceries, utilities, transport\n`;
      text += `  🎉 **Wants (30%):** ${INRr(wants)} — dining, entertainment, shopping\n`;
      text += `  💰 **Savings (20%):** ${INRr(savings)} — emergency fund, investments\n\n`;
      text += `📌 **Your current avg monthly expense:** ${INRr(exp)}\n`;
      text += `📌 **Your current avg monthly savings:** ${sav >= 0 ? '' : '-'}${INRr(Math.abs(sav))}\n\n`;
    } else {
      text += `⚠️ No income transactions found yet. Once you add income, I can give a personalized budget allocation.\n\n`;
      text += `In the meantime, here's a general 50/30/20 framework:\n`;
      text += `  🏠 50% → Needs (rent, groceries, utilities)\n`;
      text += `  🎉 30% → Wants (entertainment, dining)\n`;
      text += `  💰 20% → Savings & investments\n\n`;
    }

    // Top spending categories to reduce
    const sorted = Object.entries(thisMonth.expenseMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
    if (sorted.length) {
      text += `**Your top spending this month (areas to review):**\n`;
      sorted.forEach(([c,a],i) => { text += `  ${i+1}. ${c}: ${INRr(a)}\n`; });
    }
    return {text, data:{avgMonthlyIncome:inc, avgMonthlyExpense:exp, currentSavings:sav, suggestion:{needs,wants,savings}}};
  }

  // ── Case 3: What categories to reduce / overspending ─────────────────
  if (/reduc|cut|overhead|oversp|limit|control|less/i.test(ql) || /categories?\s+(?:to|i\s+should)/i.test(ql)) {
    const sorted3m = Object.entries(last3m.expenseMap)
      .map(([name, total3]) => ({name, avg3: total3/3, thisMonth: thisMonth.expenseMap[name] || 0}))
      .filter(x => x.thisMonth > x.avg3 * 1.1)  // overspending by >10%
      .sort((a,b) => (b.thisMonth - b.avg3) - (a.thisMonth - a.avg3));

    if (!sorted3m.length) {
      // No overspending, just show top categories
      const top = Object.entries(thisMonth.expenseMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
      let text = `✅ **Good news!** You're not significantly overspending in any category this month.\n\n`;
      text += `**Your top spending categories this month:**\n`;
      top.forEach(([c,a],i) => { text += `  ${i+1}. **${c}**: ${INRr(a)}\n`; });
      return {text, data:{categories:top,overspending:[]}};
    }

    let text = `⚠️ **Categories to Reduce Spending This Month:**\n\n`;
    sorted3m.slice(0,5).forEach((x, i) => {
      const excess = x.thisMonth - x.avg3;
      text += `  ${i+1}. 🔴 **${x.name}**\n`;
      text += `     This month: ${INRr(x.thisMonth)} | 3-month avg: ${INRr(x.avg3)} | Over by: **${INRr(excess)}**\n`;
    });
    text += `\n_💡 Reducing these categories to your historical average could save you **${INRr(sorted3m.reduce((s,x)=>s+(x.thisMonth-x.avg3),0))}** this month._`;
    return {text, data:{overspending:sorted3m}};
  }

  // ── Case 4: Planned vs Actual / Track budget ──────────────────────────
  if (/planned|actual|track|progress|vs|versus|compare/i.test(ql) || /next\s+3\s*month/i.test(ql)) {
    // Show month-by-month using last 3 months data
    return hSavingsTrend(userId, 'last 3 months');
  }

  // ── Default: This month's budget breakdown ────────────────────────────
  const {totalExpense, expenseMap, totalIncome} = thisMonth;
  if (!totalExpense && !totalIncome) {
    return {text:`No transactions found for this month yet. Start by uploading or categorizing your bank statements.`, data:null};
  }

  const sorted = Object.entries(expenseMap).sort((a,b)=>b[1]-a[1]);
  let text = `📊 **Budget Breakdown — This Month:**\n\n`;
  if (totalIncome > 0) {
    text += `  🟢 Income: **${INR(totalIncome)}**\n`;
    text += `  🔴 Total Spent: **${INR(totalExpense)}**\n`;
    const rem = totalIncome - totalExpense;
    text += `  ${rem >= 0 ? '✅' : '⚠️'} Remaining: **${rem >= 0 ? '' : '-'}${INR(Math.abs(rem))}**\n\n`;
  } else {
    text += `  🔴 Total Spent: **${INR(totalExpense)}** _(No income tracked yet)_\n\n`;
  }
  text += `**Spending by Category:**\n`;
  sorted.forEach(([c,a],i) => {
    const pct = totalExpense > 0 ? ((a/totalExpense)*100).toFixed(1) : 0;
    text += `  ${i+1}. **${c}** — ${INRr(a)} (${pct}%)\n`;
  });
  return {text, data:{totalIncome, totalExpense, breakdown:sorted}};
}

// ════════════════════════════════════════════════════════════════════════
// UNIVERSAL QUERY — the intelligent catch-all
//
// When none of the specific intents match, this handler:
//   1. Extracts any date context from the query
//   2. Detects what the user wants (income, expense, savings, category, etc.)
//   3. Fetches all P&L data for that period
//   4. Returns the most relevant answer
//
// This means the user can ask in ANY phrasing and still get accurate data.
// ════════════════════════════════════════════════════════════════════════
async function hUniversalQuery(userId, q) {
  const {from, to, label} = extractDateFilter(q);
  const ql = q.toLowerCase();

  // ── Detect what the user wants ──────────────────────────────────────
  const wantsIncome   = /\b(income|earn(?:ed|ing|s)?|receiv(?:ed|ing)|salary|salaries|inflow|revenue|got paid|credit(?:s|ed)?)\b/i.test(ql);
  const wantsExpense  = /\b(expense|spend(?:ing|t)?|paid|pay(?:ment|ments)?|outflow|debit(?:s|ed)?|expenditure|cost(?:s)?|bill(?:s)?|purchase(?:s)?)\b/i.test(ql);
  const wantsSavings  = /\b(sav(?:ing|ings|ed)?|net|left(?:\s+over)?|remaining|profit|surplus|after\s+expenses?)\b/i.test(ql);
  const wantsCategory = /\b(categor(?:y|ies)|breakdown|split|distribution|where|which)\b/i.test(ql);
  const wantsCount    = /\b(how\s*many|count|number\s*of|total\s*number|volume)\b/i.test(ql);
  const wantsMax      = /\b(biggest|largest|highest|maximum|max(?:imum)?|most\s+expensive|costliest)\b/i.test(ql);
  const wantsMin      = /\b(smallest|lowest|minimum|min(?:imum)?|least|cheapest)\b/i.test(ql);
  const wantsAvg      = /\b(average|avg|mean|per\s+month|monthly\s+average)\b/i.test(ql);
  const wantsRecent   = /\b(recent|latest|last\s+\d+|just|today)\b/i.test(ql);
  const wantsBalance  = /\b(balance|how\s*much\s*(?:do\s*i\s*)?have|worth|net\s*worth|asset|liabilit)\b/i.test(ql);

  // Try to fetch PnL data for the detected period
  const {totalIncome, totalExpense, incomeMap, expenseMap, incomeTxns, expenseTxns} = await computePnL(userId, from, to);
  const total = totalIncome + totalExpense;

  // ── Route to specific answer based on signals ───────────────────────

  // Balance / net worth requested
  if (wantsBalance && !wantsIncome && !wantsExpense) {
    const bs = await computeBalanceSheet(userId);
    const nw = bs.totalAssets - bs.totalLiabilities;
    return {
      text: `🏦 **Financial Position (${label}):**\n\n  🏦 Assets: **${INR(bs.totalAssets)}**\n  📋 Liabilities: **${INR(bs.totalLiabilities)}**\n  ${nw>=0?'✅':'⚠️'} Net Worth: **${INR(nw)}**\n\n  🟢 P&L Income: **${INR(totalIncome)}**\n  🔴 P&L Expense: **${INR(totalExpense)}**\n  💰 Savings: **${INR(totalIncome-totalExpense)}**`,
      data: {totalAssets:bs.totalAssets,totalLiabilities:bs.totalLiabilities,netWorth:nw,totalIncome,totalExpense}
    };
  }

  // Just income requested
  if (wantsIncome && !wantsExpense && !wantsSavings) {
    if (!totalIncome) return {text:`No categorized income found for **${label}**.`, data:null};
    const sorted=Object.entries(incomeMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const lines=sorted.map(([c,a],i)=>`  ${i+1}. **${c}** — ${INRr(a)}`);
    return {text:`🟢 **Income (${label}): ${INR(totalIncome)}**\n\n${lines.join('\n')}`, data:{totalIncome,breakdown:sorted}};
  }

  // Just expense requested
  if (wantsExpense && !wantsIncome && !wantsSavings) {
    if (!totalExpense) return {text:`No categorized expenses found for **${label}**.`, data:null};
    const sorted=Object.entries(expenseMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const lines=sorted.map(([c,a],i)=>`  ${i+1}. **${c}** — ${INRr(a)}`);
    return {text:`🔴 **Expense (${label}): ${INR(totalExpense)}**\n\n${lines.join('\n')}`, data:{totalExpense,breakdown:sorted}};
  }

  // Category breakdown
  if (wantsCategory) {
    return hTopCategories(userId, q);
  }

  // Transaction count
  if (wantsCount) {
    return hTransactionCount(userId, q);
  }

  // Max expense
  if (wantsMax) {
    return hMaxTransaction(userId, q);
  }

  // Min expense
  if (wantsMin) {
    return hMinTransaction(userId, q);
  }

  // Average
  if (wantsAvg) {
    return hAvgTransaction(userId, q);
  }

  // Recent
  if (wantsRecent) {
    return hRecentTransactions(userId, q);
  }

  // Savings specifically
  if (wantsSavings) {
    return hTotalSavings(userId, q);
  }

  // No data at all
  if (!total) {
    return {
      text: `No categorized financial data found for **${label}**.\n\nHere are some things you can ask:\n  • _"What's my total income this year?"_\n  • _"How much did I spend last month?"_\n  • _"What's my biggest expense?"_\n  • _"Show my savings"_\n  • _"Top spending categories"_`,
      data: null
    };
  }

  // Default: complete summary for the period
  const net = totalIncome - totalExpense;
  const rate = totalIncome > 0 ? ((net/totalIncome)*100).toFixed(1) : '0.0';
  const topExp = Object.entries(expenseMap).sort((a,b)=>b[1]-a[1]).slice(0,3);

  let text = `📊 **Financial Summary (${label}):**\n\n`;
  text += `  🟢 Income: **${INR(totalIncome)}**\n`;
  text += `  🔴 Expense: **${INR(totalExpense)}**\n`;
  text += `  💰 Net Savings: **${INR(net)}** ${net>=0?'✅':'⚠️'}\n`;
  text += `  📈 Savings Rate: **${rate}%**\n`;
  if (topExp.length) {
    text += `\n**Top Expenses:**\n`;
    topExp.forEach(([c,a],i)=>{ text+=`  ${i+1}. ${c}: ${INRr(a)}\n`; });
  }
  return {text, data:{income:totalIncome,expense:totalExpense,savings:net,savingsRate:rate}};
}

/**
 * Gather a comprehensive financial persona for the user.
 * Used by the AI to provide personalized tax tips and smart insights.
 */
async function getFinancialPersona(userId) {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const [pnl, bs] = await Promise.all([
      computePnL(userId, ninetyDaysAgo, null),
      computeBalanceSheet(userId)
    ]);

    const income = pnl.totalIncome;
    const expense = pnl.totalExpense;
    const topCategories = Object.entries(pnl.expenseMap)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 5)
      .map(([name, val]) => `${name}: ${INRr(val)}`);

    // Detect specific tax-saving indicators
    const rentScan = pnl.expenseTxns.filter(t => /rent|house|accommodation|flat|apartment/i.test(t.details || '') || t.accounts?.account_name?.toLowerCase().includes('rent'));
    const rentAmount = rentScan.reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const investmentScan = pnl.expenseTxns.filter(t => /elss|ppf|nps|mutual fund|insurance|premium|investment|lic/i.test(t.details || '') || /investment|insurance/i.test(t.accounts?.account_name?.toLowerCase()));
    const investmentAmount = investmentScan.reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const recurringScan = pnl.expenseTxns.reduce((acc, t) => {
      const key = (t.details || '').slice(0, 15);
      if (key.length > 3) {
        acc[key] = (acc[key] || 0) + 1;
      }
      return acc;
    }, {});
    const commonRecurring = Object.entries(recurringScan)
      .filter(([_, count]) => count >= 2)
      .slice(0, 5)
      .map(([name]) => name.trim());

    return {
      period: "Last 90 Days",
      income: INRr(income),
      expense: INRr(expense),
      savingsRate: income > 0 ? (( (income-expense)/income ) * 100).toFixed(1) + "%" : "0%",
      netWorth: INRr(bs.totalAssets - bs.totalLiabilities),
      topSpending: topCategories,
      potentialTaxLeaks: {
        rentPaid: INRr(rentAmount),
        investmentsLogged: INRr(investmentAmount),
        suggestHRA: rentAmount > 0,
        suggest80C: investmentAmount < 37500, // 37.5k in 3 months is ~1.5L annual
      },
      recurringPatterns: commonRecurring,
      insightsCount: pnl.expenseTxns.length
    };
  } catch (err) {
    logger.error('getFinancialPersona error:', err);
    return null;
  }
}

module.exports = { handleStatisticalQuery, getFinancialPersona };
