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
 #homsMenuButton{position:fixed;top:14px;right:14px;z-index:100002;width:46px;height:46px;border:1px solid #e2e8f0;border-radius:11px;background:#fff;box-shadow:0 4px 18px #071d2d20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;cursor:pointer}
 #homsMenuButton span{width:21px;height:2px;background:#071d2d;border-radius:2px;display:block}
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
 @media(min-width:900px){#homsMenuButton{top:18px;right:22px}}
 `;
 document.head.appendChild(style);
 var header=document.querySelector('header');
 if(current!=='gsm-home.html'&&current!=='gsm-services.html'){
  var oldNav=header&&header.querySelector('nav');
  if(oldNav)oldNav.remove();
  var oldGlobal=document.querySelector('.homs-global-nav');if(oldGlobal)oldGlobal.remove();
 }
 var button=document.createElement('button');button.id='homsMenuButton';button.type='button';button.setAttribute('aria-label','Menu openen');button.setAttribute('aria-expanded','false');button.innerHTML='<span></span><span></span><span></span>';
 var backdrop=document.createElement('div');backdrop.id='homsMenuBackdrop';
 var drawer=document.createElement('aside');drawer.id='homsMenuDrawer';drawer.setAttribute('aria-label','Hoofdnavigatie');drawer.setAttribute('aria-hidden','true');
 var head=document.createElement('div');head.className='homs-menu-head';head.innerHTML='HOMS <span>TECH</span>';
 var close=document.createElement('button');close.className='homs-menu-close';close.type='button';close.setAttribute('aria-label','Menu sluiten');close.textContent='×';head.appendChild(close);drawer.appendChild(head);
 var label=document.createElement('div');label.className='homs-menu-label';label.textContent='Alle afdelingen';drawer.appendChild(label);
 links.forEach(function(item){var a=document.createElement('a');a.href=item[2];if(item[2]===active){a.className='active';a.setAttribute('aria-current','page')}var icon=document.createElement('span');icon.className='homs-menu-icon';icon.textContent=item[0];var title=document.createElement('span');title.textContent=item[1];a.appendChild(icon);a.appendChild(title);drawer.appendChild(a)});
 function setOpen(v){drawer.classList.toggle('open',v);backdrop.classList.toggle('open',v);document.body.classList.toggle('homs-menu-open',v);button.setAttribute('aria-expanded',String(v));drawer.setAttribute('aria-hidden',String(!v))}
 button.addEventListener('click',function(){setOpen(true)});close.addEventListener('click',function(){setOpen(false)});backdrop.addEventListener('click',function(){setOpen(false)});drawer.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setOpen(false)})});document.addEventListener('keydown',function(e){if(e.key==='Escape')setOpen(false)});
 document.body.appendChild(button);document.body.appendChild(backdrop);document.body.appendChild(drawer);
})();