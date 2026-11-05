/* HOMS TECH persistent left-side navigation drawer */
(function(){
 'use strict';
 var current=(location.pathname.split('/').pop()||'index.html').toLowerCase();
 var active={
  'product.html':'devices.html','client-area.html':'account.html','checkout.html':'cart.html'
 }[current]||current;
 var links=[
  ['⌂','Home','index.html'],['♙','Over ons','about.html'],['🛠','Reparaties','repair.html'],
  ['📱','Apparaten','devices.html'],['🛍','Shop','shop.html'],['€','Prijzen','prices.html'],
  ['♻','Uw toestel verkopen','uw-toestel-verkopen.html'],['🛒','Winkelwagen','cart.html'],
  ['♙','Mijn account','account.html']
 ];
 var style=document.createElement('style');
 style.textContent=`
 #homsMenuButton{position:static;flex:0 0 48px;width:48px;height:48px;margin:0 10px 0 0;padding:0;border:0;border-radius:8px;background:transparent;box-shadow:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;transition:background .18s ease}
 #homsMenuButton:hover{background:#f1f5f9}
 #homsMenuButton:active{transform:scale(.96)}
 #homsMenuButton span{width:28px;height:3px;background:#071d2d;border-radius:2px;display:block}
 #homsMenuBackdrop{position:fixed;inset:0;background:#06131e88;z-index:100003;opacity:0;visibility:hidden;transition:.22s}
 #homsMenuBackdrop.open{opacity:1;visibility:visible}
 #homsMenuDrawer{position:fixed;inset:0 auto 0 0;width:min(88vw,370px);background:#fff;z-index:100004;transform:translateX(-105%);transition:transform .25s ease;overflow:auto;box-shadow:15px 0 40px #0002;font-family:Arial,Helvetica,sans-serif}
 #homsMenuDrawer.open{transform:translateX(0)}
 #homsMenuDrawer .homs-menu-head{height:70px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5eaf0;font-size:20px;font-weight:900;color:#071d2d}
 #homsMenuDrawer .homs-menu-head span{color:#19a86b}
 #homsMenuDrawer .homs-menu-close{border:0;background:transparent;font-size:30px;color:#334155;cursor:pointer}
 #homsMenuDrawer .homs-menu-label{padding:18px 20px 8px;color:#87939e;font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
 #homsMenuDrawer a{min-height:54px;padding:0 20px;display:flex;align-items:center;gap:13px;border-bottom:1px solid #edf0f3;color:#263747;text-decoration:none;font-size:15px;font-weight:700}
 #homsMenuDrawer a .homs-menu-icon{width:25px;text-align:center;font-size:18px}
 #homsMenuDrawer a.active{background:#eaf2ff;color:#2563eb}
 body.homs-menu-open{overflow:hidden}
 header:has(#homsMenuButton),.ht-header:has(#homsMenuButton){position:relative!important;top:auto!important}\n @media(min-width:900px){#homsMenuButton{left:18px;right:auto}}
 `;
 document.head.appendChild(style);
 var headerFix=document.createElement('style');
 headerFix.textContent=`
 header.ht-header .ht-container,.homs-header-row{width:100%!important;max-width:none!important;box-sizing:border-box!important}
 header:not(.ht-header)>.container{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:12px!important;padding-right:12px!important;box-sizing:border-box!important}
 header .container:has(>.homs-header-row){width:100%!important;max-width:none!important;padding-left:24px!important;padding-right:24px!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box!important}
 .homs-header-row{position:relative!important;display:flex!important;align-items:center!important;flex-wrap:wrap!important;gap:8px!important;width:100%!important;padding:12px 20px!important;box-sizing:border-box!important;min-height:72px!important}
 .homs-header-row{justify-content:flex-start!important}
 .homs-header-row .logo,.homs-header-row .brand,.homs-header-row .ht-brand{margin-left:8px!important;margin-right:auto!important;flex:0 1 155px!important}
 .homs-header-row .header-actions{z-index:2!important}
 .homs-header-row #homsMenuButton{order:1!important;position:static!important;flex:0 0 42px!important;width:42px!important;height:42px!important;margin:0 4px 0 0!important;padding:0!important}
 .homs-header-row .brand,.homs-header-row .ht-brand,.homs-header-row .logo{order:2!important;display:flex!important;align-items:center!important;flex:0 1 150px!important;min-width:70px!important;max-width:170px!important;font-size:0!important;line-height:0!important}
 .homs-header-row .brand img,.homs-header-row .ht-brand img,.homs-header-row .logo img{display:block!important;width:100%!important;max-width:155px!important;height:auto!important;max-height:48px!important;object-fit:contain!important}
 .homs-header-row form.ht-search,.homs-header-row form.search,.homs-header-row .search{order:5!important;display:flex!important;align-items:center!important;gap:8px!important;flex:0 0 100%!important;width:100%!important;max-width:100%!important;min-width:0!important;height:46px!important;margin:8px 0 0!important;padding:0 6px 0 14px!important;box-sizing:border-box!important;border:1px solid #d8e2ee!important;border-radius:13px!important;background:linear-gradient(180deg,#fff,#f5f8fc)!important;box-shadow:0 4px 14px rgba(7,29,45,.07)!important}
 .homs-header-row form.ht-search input,.homs-header-row form.search input,.homs-header-row .search input{flex:1 1 auto!important;width:100%!important;min-width:0!important;height:100%!important;padding:0 3px!important;border:0!important;outline:0!important;background:transparent!important;box-shadow:none!important;font-size:14px!important;color:#14283b!important}
 .homs-header-row form.ht-search button,.homs-header-row form.search button,.homs-header-row .search button{flex:0 0 auto!important;height:36px!important;min-width:82px!important;padding:0 18px!important;border:0!important;border-radius:10px!important;background:linear-gradient(135deg,#1678f5,#0754c8)!important;color:white!important;font-size:13px!important;font-weight:800!important;box-shadow:0 4px 10px rgba(13,98,220,.24)!important}
 .homs-header-row .header-actions,.homs-header-row .ht-actions,.homs-header-row .headlinks,.homs-header-row .actions{order:4!important;display:flex!important;align-items:center!important;gap:10px!important;flex:0 0 auto!important;width:auto!important;min-width:0!important;margin-left:0!important;position:static!important;top:auto!important;right:auto!important}
 .homs-header-row .homs-icon-link{display:inline-flex!important;align-items:center!important;justify-content:center!important;position:relative!important;width:36px!important;height:42px!important;padding:0!important;color:#071d2d!important;font-size:0!important;text-decoration:none!important}
 .homs-header-row .homs-icon-link svg{display:block!important;width:29px!important;height:29px!important;fill:none!important;stroke:#071d2d!important;stroke-width:2.1!important;stroke-linecap:round!important;stroke-linejoin:round!important}
 .homs-header-row .homs-cart-badge{position:absolute!important;top:-2px!important;right:-5px!important;min-width:17px!important;height:17px!important;padding:0 4px!important;border-radius:99px!important;background:#2563eb!important;color:#fff!important;font-size:10px!important;font-weight:800!important;line-height:17px!important;text-align:center!important}
 @media(max-width:560px){
  .homs-header-row{padding:12px 20px!important;gap:6px!important}
  .homs-header-row .brand,.homs-header-row .ht-brand,.homs-header-row .logo{flex-basis:150px!important;max-width:170px!important}
  .homs-header-row .brand img,.homs-header-row .ht-brand img,.homs-header-row .logo img{max-width:155px!important;max-height:42px!important}
  .homs-header-row form.ht-search,.homs-header-row form.search,.homs-header-row .search{height:44px!important;margin-top:8px!important;padding-left:12px!important}
  .homs-header-row form.ht-search button,.homs-header-row form.search button,.homs-header-row .search button{height:34px!important;min-width:76px!important;padding:0 14px!important}
  .homs-header-row .header-actions,.homs-header-row .ht-actions,.homs-header-row .headlinks,.homs-header-row .actions{gap:5px!important;right:auto!important;position:static!important}
  .homs-header-row .homs-icon-link{width:32px!important}
 }
 `;

 document.head.appendChild(headerFix);

 function removeLegacyNavigation(){

  document.querySelectorAll('.homs-global-nav, header nav, .desktop-nav, .nav-inner, nav.nav, .navbar, .main-nav, .site-nav, .ht-nav').forEach(function(el){
   if(!el.closest('#homsMenuDrawer'))el.remove();
  });
 }
 removeLegacyNavigation();
 var navObserver=new MutationObserver(function(){removeLegacyNavigation()});
 navObserver.observe(document.documentElement,{childList:true,subtree:true});
 var button=document.createElement('button');button.id='homsMenuButton';button.type='button';button.setAttribute('aria-label','Menu openen');button.setAttribute('aria-expanded','false');button.innerHTML='<span></span><span></span><span></span>';
 var backdrop=document.createElement('div');backdrop.id='homsMenuBackdrop';
 var drawer=document.createElement('aside');drawer.id='homsMenuDrawer';drawer.setAttribute('aria-label','Hoofdnavigatie');drawer.setAttribute('aria-hidden','true');
 var head=document.createElement('div');head.className='homs-menu-head';head.innerHTML='HOMS <span>TECH</span>';
 var close=document.createElement('button');close.className='homs-menu-close';close.type='button';close.setAttribute('aria-label','Menu sluiten');close.textContent='×';head.appendChild(close);drawer.appendChild(head);
 var label=document.createElement('div');label.className='homs-menu-label';label.textContent='Alle afdelingen';drawer.appendChild(label);
 links.forEach(function(item){var a=document.createElement('a');a.href=item[2];if(item[2]===active){a.className='active';a.setAttribute('aria-current','page')}var icon=document.createElement('span');icon.className='homs-menu-icon';icon.textContent=item[0];var title=document.createElement('span');title.textContent=item[1];a.appendChild(icon);a.appendChild(title);drawer.appendChild(a)});
 function setOpen(v){
  var wasOpen=drawer.classList.contains('open');
  drawer.classList.toggle('open',v);
  backdrop.classList.toggle('open',v);
  document.body.classList.toggle('homs-menu-open',v);
  button.setAttribute('aria-expanded',String(v));
  drawer.setAttribute('aria-hidden',String(!v));
  if(v&&!wasOpen)close.focus();
  if(!v&&wasOpen)button.focus();
 }
 button.addEventListener('click',function(){setOpen(true)});close.addEventListener('click',function(){setOpen(false)});backdrop.addEventListener('click',function(){setOpen(false)});drawer.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setOpen(false)})});document.addEventListener('keydown',function(e){if(e.key==='Escape')setOpen(false)});
 var siteHeader=document.querySelector('header');
 var headerRow=siteHeader&&siteHeader.querySelector('.ht-header-main,.header-main,.head,.wrap');
 if(headerRow){
  headerRow.classList.add('homs-header-row');
  headerRow.style.setProperty('display','grid','important');
  headerRow.style.setProperty('grid-template-columns','42px minmax(0,1fr) auto','important');
  headerRow.style.setProperty('align-items','center','important');
  headerRow.style.setProperty('column-gap','10px','important');
  headerRow.style.setProperty('row-gap','8px','important');
  headerRow.style.setProperty('width','100%','important');
  headerRow.style.setProperty('box-sizing','border-box','important');
  var brand=headerRow.querySelector('.brand,.ht-brand,.logo');
  var search=headerRow.querySelector('form.search,form.ht-search,.search');
  var actions=headerRow.querySelector('.header-actions,.ht-actions,.headlinks,.actions');
  if(!actions){actions=document.createElement('div');actions.className='header-actions';headerRow.appendChild(actions)}
  headerRow.insertBefore(button,headerRow.firstChild);
  if(brand){brand.style.setProperty('grid-column','2','important');brand.style.setProperty('grid-row','1','important');brand.style.setProperty('min-width','0','important');brand.style.setProperty('width','100%','important');brand.style.setProperty('max-width','none','important');brand.style.setProperty('margin','0','important')}
  button.style.setProperty('grid-column','1','important');
  button.style.setProperty('grid-row','1','important');
  if(search){search.style.setProperty('grid-column','1 / -1','important');search.style.setProperty('grid-row','2','important');search.style.setProperty('order','5','important');search.style.setProperty('flex','0 0 100%','important');search.style.setProperty('width','100%','important');search.style.setProperty('max-width','100%','important');search.style.setProperty('min-width','0','important');search.style.setProperty('box-sizing','border-box','important')}
  actions.style.setProperty('grid-column','3','important');
  actions.style.setProperty('grid-row','1','important');
  actions.style.setProperty('order','4','important');
  actions.style.setProperty('display','flex','important');
  actions.style.setProperty('align-items','center','important');
  actions.style.setProperty('gap','12px','important');
  actions.style.setProperty('margin-left','auto','important');
  actions.style.setProperty('flex','0 0 auto','important');
  actions.style.setProperty('width','auto','important');
  actions.style.setProperty('min-width','0','important');
  actions.style.setProperty('flex-wrap','nowrap','important');
  actions.style.setProperty('position','static','important');
  actions.style.setProperty('top','auto','important');
  actions.style.setProperty('right','auto','important');
  actions.style.setProperty('margin-left','0','important');
  actions.style.setProperty('justify-self','end','important');
  headerRow.style.setProperty('position','relative','important');
  Array.from(actions.querySelectorAll('a')).forEach(function(link){
   if(!/account|cart/i.test(link.getAttribute('href')||''))link.remove();
  });
  var account=actions.querySelector('a[href*="account"]');
  if(!account){account=document.createElement('a');account.href='account.html';actions.appendChild(account)}
  var cart=actions.querySelector('a[href*="cart"]');
  if(!cart){cart=document.createElement('a');cart.href='cart.html';actions.appendChild(cart)}
  function makeIcon(link,type){
   var count=link.querySelector('.cart-count,#cartCount,.cart-count span');
   var countText=count?count.textContent.trim():'';
   link.classList.add('homs-icon-link');
   link.style.setProperty('display','inline-flex','important');
   link.style.setProperty('align-items','center','important');
   link.style.setProperty('justify-content','center','important');
   link.style.setProperty('width','36px','important');
   link.style.setProperty('height','42px','important');
   link.style.setProperty('font-size','0','important');
   link.style.setProperty('color','#071d2d','important');
   link.style.setProperty('text-decoration','none','important');
   link.setAttribute('aria-label',type==='account'?'Mijn account':'Winkelwagen');
   link.setAttribute('title',type==='account'?'Mijn account':'Winkelwagen');
   link.innerHTML=type==='account'
    ? '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#071d2d" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7.5" r="4" fill="none"></circle><path d="M4 21c.6-4.2 3.5-6.5 8-6.5s7.4 2.3 8 6.5" fill="none"></path></svg>'
    : '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#071d2d" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.5" fill="none"></circle><circle cx="19" cy="20" r="1.5" fill="none"></circle><path d="M2 3h2l2.6 12.2a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 1.9-1.4L22 8H6" fill="none"></path></svg>';
   if(type==='cart'&&countText){var badge=document.createElement('span');badge.className='homs-cart-badge';badge.textContent=countText;link.appendChild(badge)}
  }
  makeIcon(account,'account');makeIcon(cart,'cart');
 }else if(siteHeader){siteHeader.insertBefore(button,siteHeader.firstChild)}
 else{document.body.insertBefore(button,document.body.firstChild)}
 document.body.appendChild(backdrop);document.body.appendChild(drawer);
})();