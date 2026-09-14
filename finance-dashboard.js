/* Reference-inspired overview. All figures come from the existing finance store. */
(() => {
  const app = document.querySelector('.app');
  const workspace = document.createElement('div');
  workspace.className = 'financeWorkspace';
  while(app.firstChild) workspace.appendChild(app.firstChild);
  app.appendChild(workspace);
  const overview = document.createElement('section');
  overview.id = 'calmDashboard';
  workspace.before(overview);
  const nav = [['⌂','Dashboard','dashboard'],['↗','Income','income'],['↙','Expenses','expenses'],['▣','Pots & Accounts','pots'],['⌂','Home Payments','home'],['▤','Debts','debts'],['⚑','Goals','goals'],['▦','Calendar','calendar'],['▥','Reports','reports']];
  const sidebar=document.createElement('aside');
  sidebar.className='financeSidebar';
  sidebar.innerHTML=`<a class="calmBrand" href="dashboard.html">pace<span>A calmer you<br>A brighter tomorrow</span></a><nav aria-label="Finance">${nav.map(([icon,label,key])=>`<button data-finance-view="${key}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav><p class="sidebarQuote">Good money habits<br>create the life you want ♡</p><a class="backPace" href="dashboard.html">← Back to Pace</a>`;
  document.body.prepend(sidebar);
  const toolbar=document.createElement('div');toolbar.className='calmToolbar';toolbar.innerHTML='<button data-finance-view="dashboard">← Dashboard</button><span>Manage your finances</span>';overview.after(toolbar);
  function show(view){
    overview.hidden=view!=='dashboard';toolbar.hidden=view==='dashboard';workspace.hidden=view==='dashboard';
    workspace.querySelectorAll('section.card,article.card').forEach(card=>card.hidden=true);
    const ids={income:['incomeInput','deliverooEarnedInput'],expenses:['spendNameInput'],pots:['potFood'],home:['paymentList','paymentNameInput'],debts:['debtList','paymentNameInput'],goals:['potEmergency'],calendar:['paymentList','paymentNameInput'],reports:['spendList','todayInstruction']};
    (ids[view]||[]).forEach(id=>document.getElementById(id).closest('.card').hidden=false);
    sidebar.querySelectorAll('button').forEach(b=>{const active=b.dataset.financeView===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
    toolbar.querySelector('span').textContent=nav.find(n=>n[2]===view)?.[1]||'Finance';window.scrollTo({top:0,behavior:'smooth'});
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-finance-view]');if(b)show(b.dataset.financeView)});
  const POT_CONFIG=[{key:'food',label:'Food'},{key:'transport',label:'Transport'},{key:'emergency',label:'Emergency'},{key:'business',label:'Business'},{key:'misc',label:'Miscellaneous'}];
  const getMonthSpends=()=>getCycle().spends;
  const totalSpending=getSpendTotal;
  const getMonthBills=()=>getCycle().payments;
  const getMonthTrickles=()=>getCycle().payments.filter(p=>['debt','bnpl'].includes(p.category));
  const isBillPaid=id=>getCycle().payments.find(p=>p.id===id)?.status==='paid';
  const getBillDueDate=b=>b.dueDate;
  const friendlyDueText=date=>date<getToday()?'Overdue · '+formatShortDate(date):'Due '+formatShortDate(date);
  const formatCycleRangeLabel=()=>formatCycleLabel(state.selectedCycle);
  const getHubMoneySnapshot=()=>({income:numberValue(getCycle().income),monthData:getCycle(),effectiveAllocation:getCycle().pots,remaining:getOutstandingPayments(),protectedBills:paymentTotal(getOutstandingPayments()),recommendedTransfer:getPotTotal()});
  const colors = ['#8ebf9e','#82a9c7','#dfc37e','#e69d82','#d991a5','#b7a4ce','#7ca3af','#a6a9ac'];
  const empty = text => `<p class="calmEmpty">${text}</p>`;
  const action = (label,view) => `<button class="calmLink" data-finance-view="${view}">${label}</button>`;
  const row = (name,detail,amount,icon='▣') => `<div class="calmRow"><span class="calmIcon" aria-hidden="true">${icon}</span><div><b>${escapeHtml(name)}</b><small>${escapeHtml(detail)}</small></div><strong>${amount}</strong></div>`;
  const card = (title,body,link='',cls='') => `<section class="calmCard ${cls}"><header><h3>${title}</h3>${link}</header>${body}</section>`;
  function draw() {
    const snapshot = getHubMoneySnapshot();
    const spends = getMonthSpends();
    const spent = totalSpending();
    const available = snapshot.income + numberValue(snapshot.monthData.startingBalance);
    const left = available - spent - snapshot.protectedBills - snapshot.recommendedTransfer;
    const groups = Object.entries(spends.reduce((out,item)=>{const key=POT_CONFIG.find(p=>p.key===item.pot)?.label || 'Unassigned';out[key]=(out[key]||0)+numberValue(item.amount);return out;},{})).sort((a,b)=>b[1]-a[1]);
    let offset=0;
    const gradient = groups.map(([,amount],i)=>{const start=offset;offset+=spent ? amount/spent*100 : 0;return `${colors[i%colors.length]} ${start}% ${offset}%`;}).join(',');
    const donut = `<div class="calmSpending"><div class="calmDonut" role="img" aria-label="Total recorded spending ${money(spent)}" style="background:${spent ? `conic-gradient(${gradient})`:'#e9ede8'}"><div><strong>${money(spent)}</strong><small>Total spent</small></div></div><div class="calmLegend">${groups.length ? groups.map(([label,amount],i)=>`<div><i style="background:${colors[i%colors.length]}"></i><span>${escapeHtml(label)}</span><b>${Math.round(amount/spent*100)}%</b></div>`).join('') : empty('Your spending breakdown will appear here.')}</div></div>`;
    const pots = POT_CONFIG.filter(p=>numberValue(snapshot.effectiveAllocation[p.key])>0);
    const budget = pots.map(p=>{
      const actual=spends.filter(s=>s.pot===p.key).reduce((sum,s)=>sum+numberValue(s.amount),0);
      const target=numberValue(snapshot.effectiveAllocation[p.key]);
      return `<div class="calmBudget"><span>${escapeHtml(p.label)}</span><div><small>${money(actual)} / ${money(target)}</small><progress max="${target}" value="${Math.min(actual,target)}"></progress></div><b>${Math.round(actual/target*100)}%</b></div>`;
    }).join('') || empty('Set pot budgets to compare your spending.');
    const reminders = snapshot.remaining.slice().sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,5);
    const home = getMonthBills().filter(b=>b.category==='home');
    const debt = state.debts;
    const goals = pots.filter(p=>['emergency'].includes(p.key));
    const stat=(icon,title,amount,note)=>`<article class="calmStat"><span class="calmIcon">${icon}</span><div><span>${title}</span><strong>${money(amount)}</strong><small>${note}</small></div></article>`;
    const hour=new Date().getHours();
    overview.innerHTML = `<header class="calmHeading"><div><h1>Good ${hour<12?'morning':hour<18?'afternoon':'evening'}!</h1><p>${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p></div><p class="calmQuote">“Small steps add up to big freedom.” ♡</p></header><div class="calmCycle"><span>${escapeHtml(formatCycleRangeLabel(state.selectedCycle))} · Pay cycle</span><div><button data-cycle="-1" aria-label="Previous pay cycle">‹</button><input type="month" aria-label="Dashboard pay cycle" value="${state.selectedCycle}"><button data-cycle="1" aria-label="Next pay cycle">›</button></div></div><div class="calmStats">${stat('▣','Starting balance',numberValue(snapshot.monthData.startingBalance),'Recorded balance · edit in Income')}${stat('↗','This cycle’s income',snapshot.income,'Your planned income')}${stat('↙','This cycle’s spending',spent,'Recorded expenses')}${stat('▧','Left to allocate',left,'After expenses, unpaid payments & pot targets')}</div><div class="calmBoard">${card('Spending Overview',donut,action('Add expense','expenses'))}${card('Budget vs Actual',budget,action('Edit budgets','pots'))}${card('Reminders',reminders.map(item=>row(item.name,item.dueDate?friendlyDueText(item.dueDate):'No due date',money(item.amount),'▦')).join('')||empty('No outstanding payments this cycle.'),action('See all','calendar'))}${card('Your Pots',pots.map(p=>row(p.label,'Planned allocation',money(snapshot.effectiveAllocation[p.key]))).join('')||empty('Create your first pot allocation.'),action('Manage pots','pots'))}${card('Home Payments',`<div class="calmHomeTotal"><span class="calmIcon">⌂</span><div><strong>${money(home.reduce((sum,b)=>sum+numberValue(b.amount),0))}</strong><small>Planned home bills this cycle</small></div></div>${home.map(b=>row(b.name,isBillPaid(b.id)?'Paid':`Due ${formatShortDate(getBillDueDate(b))}`,money(b.amount),'⌂')).join('')||empty('No home bills added for this cycle.')}`,action('Manage','home'))}${card('Debt Tracker',debt.slice(0,5).map(b=>row(b.name,`${money(b.monthlyPayment)} / month`,money(b.balance),'▤')).join('')||empty('No debt payments recorded this cycle.'),action('Manage','debts'))}${card('Recent Transactions',spends.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(s=>row(s.name,`${POT_CONFIG.find(p=>p.key===s.pot)?.label || 'Unassigned'} · ${formatShortDate(s.date)}`,`− ${money(s.amount)}`,'↙')).join('')||empty('Add an expense to start your transaction history.'),action('See all','reports'))}${card('Financial Goals',goals.map(p=>row(p.label,'Allocated this cycle',money(snapshot.effectiveAllocation[p.key]),'⚑')).join('')||empty('Allocate money to your Emergency pot to get started.'),action('Manage','goals'))}<div class="calmFinal"><div class="calmInspiration">Discipline today<br><span>Freedom tomorrow ♡</span><div class="calmLandscape"></div></div>${card('Quick Actions',`<div class="calmQuick">${action('+ Add Transaction','expenses')}${action('⇄ Plan Pot Transfer','pots')}${action('▥ Update Budget','pots')}${action('▤ View Reports','reports')}</div>`)}</div></div>`;
    overview.querySelectorAll('[data-cycle]').forEach(b=>b.onclick=()=>openCycle(shiftCycle(state.selectedCycle,Number(b.dataset.cycle))));
    overview.querySelector('input[type=month]').onchange=e=>{if(e.target.value)openCycle(e.target.value);};
  }
  const originalRender = render;
  render = function(){ originalRender(); draw(); };
  const originalSummary = renderSummary;
  renderSummary = function(){originalSummary();draw();};
  draw();
  show('dashboard');
})();
