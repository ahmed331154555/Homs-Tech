/* Shared HOMS TECH main navigation. Authentication handlers are intentionally untouched. */
(function () {
  'use strict';
  var current = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var activeTarget = {
    'index.html':'index.html',
    'about.html':'about.html',
    'repair.html':'repair.html',
    'devices.html':'devices.html',
    'shop.html':'shop.html',
    'product.html':'devices.html',
    'prices.html':'prices.html',
    'onderdelen.html':'onderdelen.html',
    'used.html':'onderdelen.html',
    'gsm-home.html':'onderdelen.html',
    'gsm-services.html':'onderdelen.html',
    'firmware.html':'onderdelen.html',
    'uw-toestel-verkopen.html':'uw-toestel-verkopen.html',
    'account.html':'account.html',
    'client-area.html':'account.html',
    'cart.html':'cart.html',
    'checkout.html':'cart.html'
  }[current] || '';
  var links = [
    ['Home','index.html'],
    ['Over ons','about.html'],
    ['Reparaties','repair.html'],
    ['Apparaten','devices.html'],
    ['Shop','shop.html'],
    ['Winkelwagen','cart.html'],
    ['Prijzen','prices.html'],
    ['Onderdelen','onderdelen.html'],
    ['Uw toestel verkopen','uw-toestel-verkopen.html'],
    ['Mijn account','account.html']
  ];
  var nav = document.createElement('nav');
  nav.className = 'homs-global-nav';
  nav.setAttribute('aria-label','Hoofdnavigatie');
  var inner = document.createElement('div');
  inner.className = 'homs-global-nav-inner';
  links.forEach(function (item) {
    var a = document.createElement('a');
    a.textContent = item[0];
    a.href = item[1];
    var target = item[1].split('?')[0];
    if (target === activeTarget) {
      a.classList.add('active');
      a.setAttribute('aria-current','page');
    }
    inner.appendChild(a);
  });
  nav.appendChild(inner);

  var header = document.querySelector('header');
  /* GSM pages keep their own service-category sub-navigation. */
  if (current !== 'gsm-home.html' && current !== 'gsm-services.html') {
    var oldNav = header && header.querySelector('nav');
    if (oldNav) {
      oldNav.parentNode.removeChild(oldNav);
    } else if (current === 'uw-toestel-verkopen.html') {
      oldNav = document.querySelector('body > nav.nav');
      if (oldNav) oldNav.parentNode.removeChild(oldNav);
    }
  }
  if (header && header.parentNode) {
    header.parentNode.insertBefore(nav, header.nextSibling);
  } else {
    var main = document.querySelector('main');
    if (main && main.parentNode) main.parentNode.insertBefore(nav, main);
    else document.body.insertBefore(nav, document.body.firstChild);
  }
})();