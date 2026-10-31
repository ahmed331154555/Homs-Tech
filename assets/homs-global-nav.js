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
 function removeLegacyNavigation(){
  if(current==='gsm-home.html'||current==='gsm-services.html')return;
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
 function setOpen(v){drawer.classList.toggle('open',v);backdrop.classList.toggle('open',v);document.body.classList.toggle('homs-menu-open',v);button.setAttribute('aria-expanded',String(v));drawer.setAttribute('aria-hidden',String(!v))}
 button.addEventListener('click',function(){setOpen(true)});close.addEventListener('click',function(){setOpen(false)});backdrop.addEventListener('click',function(){setOpen(false)});drawer.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setOpen(false)})});document.addEventListener('keydown',function(e){if(e.key==='Escape')setOpen(false)});
 var siteHeader=document.querySelector('header');
 var headerRow=siteHeader&&siteHeader.querySelector('.header-main,.ht-header-main,.head,.wrap');
 var brand=headerRow&&headerRow.querySelector('.brand,.ht-brand,.logo');
 var actions=headerRow&&headerRow.querySelector('.header-actions,.ht-actions,.headlinks');
 var search=headerRow&&headerRow.querySelector('form.search,form.ht-search,.search');
 var iconStyle=document.createElement('style');
 iconStyle.textContent=`
 .homs-header-row{display:flex!important;align-items:center!important;gap:clamp(8px,2vw,22px)!important;flex-wrap:wrap!important}
 .homs-header-row #homsMenuButton{order:1!important;position:static!important;flex:0 0 42px!important;width:42px!important;height:42px!important;margin:0!important;border:0!important;border-radius:8px!important;background:transparent!important;box-shadow:none!important}
 .homs-header-row #homsMenuButton span{width:27px!important;height:3px!important;background:#071d2d!important;border-radius:2px!important}
 .homs-header-row .brand,.homs-header-row .ht-brand,.homs-header-row .logo{order:2!important;display:flex!important;align-items:center!important;flex:1 1 auto!important;min-width:0!important}
 .homs-header-row .brand img,.homs-header-row .ht-brand img,.homs-header-row .logo img{max-width:min(100%,190px)!important;height:auto!important}
 .homs-header-row .header-actions,.homs-header-row .ht-actions,.homs-header-row .headlinks{order:3!important;margin-left:auto!important;display:flex!important;align-items:center!important;gap:14px!important}
 .homs-header-row .homs-icon-link{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:38px!important;height:42px!important;padding:0!important;color:#071d2d!important;text-decoration:none!important;font-size:0!important;white-space:nowrap!important}
 .homs-header-row .homs-icon-link svg{width:30px!important;height:30px!important;display:block!important;stroke:currentColor!important;fill:none!important;stroke-width:2!important;stroke-linecap:round!important;stroke-linejoin:round!important}
 .homs-header-row .homs-icon-link .cart-count,.homs-header-row .homs-icon-link #cartCount,.homs-header-row .homs-icon-link .homs-cart-badge{position:absolute!important;top:-2px!important;right:-5px!important;min-width:17px!important;height:17px!important;padding:0 4px!important;border-radius:99px!important;background:#2563eb!important;color:#fff!important;font-size:10px!important;font-weight:800!important;line-height:17px!important;text-align:center!important}
 .homs-header-row form.search,.homs-header-row form.ht-search,.homs-header-row .search{order:4!important;flex:0 0 100%!important;width:100%!important;max-width:none!important;margin:4px 0 0!important}
 @media(min-width:700px){.homs-header-row form.search,.homs-header-row form.ht-search,.homs-header-row .search{flex:1 1 240px!important;width:auto!important;max-width:440px!important;margin:0!important}}
 `;
 document.head.appendChild(iconStyle);
 if(headerRow){
  headerRow.classList.add('homs-header-row');
  headerRow.insertBefore(button,headerRow.firstChild);
  if(!actions){
   actions=document.createElement('div');actions.className='header-actions';headerRow.appendChild(actions);
  }
  var account=actions.querySelector('a[href*="account"]');
  if(!account){account=document.createElement('a');account.href='account.html';actions.appendChild(account)}
  var cart=actions.querySelector('a[href*="cart"]');
  if(!cart){cart=document.createElement('a');cart.href='cart.html';actions.appendChild(cart)}
  function makeIcon(link,type){
   var count=link.querySelector('.cart-count,#cartCount,.cart-count span');
   var countText=count?count.textContent.trim():'';
   link.classList.add('homs-icon-link');
   link.setAttribute('aria-label',type==='account'?'Mijn account':'Winkelwagen');
   link.setAttribute('title',type==='account'?'Mijn account':'Winkelwagen');
   link.innerHTML=type==='account'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="4"></circle><path d="M4 21c.6-4.2 3.5-6.5 8-6.5s7.4 2.3 8 6.5"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="20" r="1.5"></circle><circle cx="19" cy="20" r="1.5"></circle><path d="M2 3h2l2.6 12.2a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 1.9-1.4L22 8H6"></path></svg>';
   if(type==='cart'&&countText){
    var badge=document.createElement('span');badge.className='homs-cart-badge';badge.textContent=countText;link.appendChild(badge);
   }
  }
  makeIcon(account,'account');makeIcon(cart,'cart');
 }else if(siteHeader){siteHeader.insertBefore(button,siteHeader.firstChild)}
 else{document.body.insertBefore(button,document.body.firstChild)}
 document.body.appendChild(backdrop);document.body.appendChild(drawer);
})();