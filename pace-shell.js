/* Consistent navigation without touching each tool's forms or storage. */
(() => {
  const page = location.pathname.split('/').pop() || 'index.html';
  document.body.dataset.pacePage = page.replace(/(?:-test)?\.html$/, '');
  if(page === 'index.html') { document.body.classList.add('paceAuth'); return; }
  // Finance has its own section navigation in the shared visual language.
  if(page === 'finance-test.html') return;
  document.body.classList.add('paceApp');
  const sections = [
    ['Everyday', [['⌂','Dashboard','dashboard.html'],['✓','To Do','life-test.html'],['▦','Reminders','reminders-test.html'],['▤','Lists','lists-test.html'],['▣','Finance','finance-test.html'],['⌂','The Move','move-test.html'],['□','Purchases','purchases-test.html']]],
    ['Your spaces', [['♡','Health','health-reset-test.html'],['☼','Quiet Time','quiet-time-test.html'],['✎','Church Notes','church-notes-test.html'],['▥','Attendance','attendance-test.html'],['▦','Weekly Plan','weekly-test.html'],['◇','Creators','creators-test.html'],['✉','Email','email-command-test.html']]]
  ];
  const creatorPages = ['shoot-day-test.html','bookings-test.html','creator-income-test.html','creator-day-test.html'];
  const aside = document.createElement('aside');
  aside.className='paceSidebar';
  aside.innerHTML='<a class="paceBrand" href="dashboard.html">pace</a><p class="paceMotto">A calmer you<br>A brighter tomorrow</p><nav aria-label="Pace">'+sections.map(([label,links])=>'<div class="paceNavLabel">'+label+'</div>'+links.map(([icon,title,href])=>`<a href="${href}"${page===href || href==='creators-test.html' && creatorPages.includes(page)?' aria-current="page"':''}><span aria-hidden="true">${icon}</span>${title}</a>`).join('')).join('')+'</nav><p class="paceSidebarFooter">Small steps today.<br>A little more freedom tomorrow. ♡</p>';
  document.body.prepend(aside);
  const main=document.querySelector('main') || document.querySelector('.wrap,.page,.app');
  if(main){if(!main.id)main.id='paceMain';main.setAttribute('tabindex','-1');const skip=document.createElement('a');skip.className='paceSkip';skip.href='#'+main.id;skip.textContent='Skip to content';document.body.prepend(skip);}
})();
