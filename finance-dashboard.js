/* Reference-inspired overview. All figures come from the existing finance store. */
(() => {
  const hub = document.querySelector('.financeHub');
  const editor = document.getElementById('financeEditorPanel');
  const overview = document.createElement('section');
  overview.id = 'calmDashboard';
  const sidebar = document.createElement('aside');
  sidebar.className = 'financeSidebar';
  const nav = [['⌂','Dashboard','dashboard'],['↗','Income','income'],['↙','Expenses','expenses'],['▣','Pots & Accounts','pots'],['⌂','Home Payments','home'],['▤','Debts','debts'],['⚑','Goals','goals'],['▦','Calendar','calendar'],['▥','Reports','reports']];
  sidebar.innerHTML = `<a class="calmBrand" href="dashboard.html">pace<span>A calmer you<br>A brighter tomorrow</span></a><nav aria-label="Finance">${nav.map(([icon,label,key])=>`<button data-finance-view="${key}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav><p class="sidebarQuote">Good money habits<br>create the life you want ♡</p><a class="backPace" href="dashboard.html">← Back to Pace</a>`;
  document.body.prepend(sidebar);
  hub.before(overview);
  const toolbar = document.createElement('div');
  toolbar.className = 'calmToolbar';
  toolbar.innerHTML = '<button data-finance-view="dashboard">← Dashboard</button><span>Manage your finances</span>';
  overview.after(toolbar);
  let currentView = 'dashboard';
  function show(view) {
    currentView = view;
    overview.hidden = view !== 'dashboard';
    toolbar.hidden = view === 'dashboard';
    hub.hidden = true;
    editor.hidden = true;
    editor.querySelectorAll(':scope > section').forEach(section => section.hidden = true);
    let target;
    const field = {income:'incomeInput',expenses:'spendNameInput',home:'billNameInput',reports:'spendList'}[view];
    if (field) {
      editor.hidden = false;
      target = document.getElementById(field).closest('section');
      target.hidden = false;
      if(view === 'expenses') document.getElementById('spendList').closest('section').hidden = false;
      if(view === 'home') document.getElementById('standingOrderList').closest('section').hidden = false;
    } else if(view !== 'dashboard') {
      hub.hidden = false;
      hub.querySelectorAll('.hubBoard .hubCard').forEach(card=>card.hidden=true);
      const ids = {pots:'hubPotsList',goals:'hubPotsList',home:'hubPaymentList',debts:'hubScheduleList',calendar:'hubPaymentList',planning:'hubWeekPlanList'};
      target = document.getElementById(ids[view] || 'hubPaymentList').closest('.hubCard');
      target.hidden = false;
      if(view === 'debts') document.getElementById('hubPaymentList').closest('.hubCard').hidden = false;
    }
    sidebar.querySelectorAll('button').forEach(button => {
      const active = button.dataset.financeView === view;
      button.classList.toggle('active',active);
      if(active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
    toolbar.querySelector('span').textContent = nav.find(item=>item[2]===view)?.[1] || 'Payment planning';
    window.scrollTo({top:0,behavior:'smooth'});
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-finance-view]');
    if(button) show(button.dataset.financeView);
  });
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
    const groups = Object.entries(spends.reduce((out,item)=>{const key=item.category || 'Other';out[key]=(out[key]||0)+numberValue(item.amount);return out;},{})).sort((a,b)=>b[1]-a[1]);
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
    const home = getMonthBills().filter(b=>/rent|mortgage|council|water|energy|utility|house/i.test(b.name));
    const debt = getMonthTrickles().filter(b=>/debt|bnpl|klarna|clearpay|loan|credit|finance/i.test(`${b.name} ${b.pot} ${b.source}`));
    const goals = pots.filter(p=>['savings','emergency','move','furniture','homeSetup'].includes(p.key));
    const stat=(icon,title,amount,note)=>`<article class="calmStat"><span class="calmIcon">${icon}</span><div><span>${title}</span><strong>${money(amount)}</strong><small>${note}</small></div></article>`;
    const hour=new Date().getHours();
    overview.innerHTML = `<header class="calmHeading"><div><h1>Good ${hour<12?'morning':hour<18?'afternoon':'evening'}!</h1><p>${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p></div><p class="calmQuote">“Small steps add up to big freedom.” ♡</p></header><div class="calmCycle"><span>${escapeHtml(formatCycleRangeLabel(state.selectedMonth))} · Pay cycle</span><div><button data-cycle="-1" aria-label="Previous pay cycle">‹</button><input type="month" aria-label="Dashboard pay cycle" value="${state.selectedMonth}"><button data-cycle="1" aria-label="Next pay cycle">›</button></div></div><div class="calmStats">${stat('▣','Starting balance',numberValue(snapshot.monthData.startingBalance),'Recorded balance · edit in Income')}${stat('↗','This cycle’s income',snapshot.income,'Your planned income')}${stat('↙','This cycle’s spending',spent,'Recorded expenses')}${stat('▧','Left to allocate',left,'After expenses, HSBC bills & pot targets')}</div><div class="calmBoard">${card('Spending Overview',donut,action('Add expense','expenses'))}${card('Budget vs Actual',budget,action('Edit budgets','pots'))}${card('Reminders',reminders.map(item=>row(item.name,item.dueDate?friendlyDueText(item.dueDate):'No due date',money(item.amount),'▦')).join('')||empty('No outstanding payments this cycle.'),action('See all','calendar'))}${card('Your Pots (Revolut)',pots.map(p=>row(p.label,'Planned allocation',money(snapshot.effectiveAllocation[p.key]))).join('')||empty('Create your first pot allocation.'),action('Manage pots','pots'))}${card('Home Payments',`<div class="calmHomeTotal"><span class="calmIcon">⌂</span><div><strong>${money(home.reduce((sum,b)=>sum+numberValue(b.amount),0))}</strong><small>Planned home bills this cycle</small></div></div>${home.map(b=>row(b.name,isBillPaid(b.id)?'Paid':`Due ${formatShortDate(getBillDueDate(b))}`,money(b.amount),'⌂')).join('')||empty('No home bills added for this cycle.')}`,action('Manage','home'))}${card('Debt Payments',debt.slice(0,5).map(b=>row(b.name,b.paid?'Paid':b.dueDate?friendlyDueText(b.dueDate):'Upcoming',money(b.amount),'▤')).join('')||empty('No debt payments recorded this cycle.'),action('Manage','debts'))}${card('Recent Transactions',spends.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(s=>row(s.name,`${s.category} · ${formatShortDate(s.date)}`,`− ${money(s.amount)}`,'↙')).join('')||empty('Add an expense to start your transaction history.'),action('See all','reports'))}${card('Financial Goals',goals.map(p=>row(p.label,'Allocated this cycle',money(snapshot.effectiveAllocation[p.key]),'⚑')).join('')||empty('Allocate money to Savings or Emergency to get started.'),action('Manage','goals'))}<div class="calmFinal"><div class="calmInspiration">Discipline today<br><span>Freedom tomorrow ♡</span><div class="calmLandscape"></div></div>${card('Quick Actions',`<div class="calmQuick">${action('+ Add Transaction','expenses')}${action('⇄ Plan Pot Transfer','pots')}${action('▥ Update Budget','pots')}${action('▤ View Reports','reports')}</div>`)}</div></div>`;
    overview.querySelectorAll('[data-cycle]').forEach(b=>b.onclick=()=>openMonth(shiftMonth(state.selectedMonth,Number(b.dataset.cycle))));
    overview.querySelector('input[type=month]').onchange=e=>{if(e.target.value)openMonth(e.target.value);};
  }
  const originalRender = render;
  render = function(){ originalRender(); draw(); };
  draw();
  show(currentView);
})();
