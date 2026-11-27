/* HOMS TECH admin: Dutch / Arabic interface switch.
 *
 * Dutch is the source language of the admin. When Arabic is selected the text
 * of the page (and of everything the admin renders later) is translated from
 * the dictionary below and the layout switches to right-to-left.
 * Switching language reloads the page, so Dutch is always restored exactly.
 * Strings that are not in the dictionary simply stay Dutch; they are collected
 * in window.HOMS_I18N_MISSING so they can be added later.
 */
(function () {
  "use strict";
  var KEY = "homsAdminLang";
  var lang = "nl";
  try { lang = localStorage.getItem(KEY) === "ar" ? "ar" : "nl"; } catch (e) {}

  // Dutch -> Arabic. Keys are matched with or without a leading icon.
  var D = {
    // navigation
    "Direct naar hoofdinhoud": "انتقل إلى المحتوى الرئيسي",
    "Menu openen": "فتح القائمة", "Menu sluiten": "إغلاق القائمة",
    "— Admin": "— لوحة التحكم",
    "Website & pagina's": "الموقع والصفحات",
    "Announcement bars": "شريط الإعلانات", "Voordelenbalk": "شريط المزايا",
    "Reviews & beoordelingen": "التقييمات والمراجعات",
    "Inhoud beheren": "إدارة المحتوى", "Homepage": "الصفحة الرئيسية",
    "Diensten": "الخدمات", "Reparatiepagina": "صفحة التصليح",
    "Producten & voorraad": "المنتجات والمخزون",
    "Telefoons & prijzen": "الهواتف والأسعار", "Shop producten": "منتجات المتجر",
    "Kortingen": "الخصومات", "Aanvragen": "الطلبات", "Easy Unlocker": "Easy Unlocker",
    "Voorraad & magazijn": "المخزون والمستودع", "Partners": "الشركاء",
    "Toestelregister": "سجل الأجهزة", "Uw toestel verkopen": "بيع جهازك",
    "Waarom HOMS TECH": "لماذا HOMS TECH",
    "Klanten & bestellingen": "الزبائن والطلبات",
    "Live Chat": "المحادثة المباشرة", "Klanten": "الزبائن",
    "E-mail inbox": "صندوق البريد", "Facturen": "الفواتير",
    "Alle bestellingen": "كل الطلبات", "Orderinstellingen": "إعدادات الطلبات",
    "Beheer & instellingen": "الإدارة والإعدادات", "Zoeken": "بحث", "Admins": "المشرفون",
    "Uitloggen": "تسجيل الخروج", "Telefoonbestellingen": "طلبات الهواتف",
    "Shop": "المتجر", "Inkoop": "الشراء من الزبائن", "Repair": "التصليح",
    // login
    "Admin login": "تسجيل دخول المشرف", "Log in om de website te beheren.": "سجّل الدخول لإدارة الموقع.",
    "Gebruikersnaam": "اسم المستخدم", "Wachtwoord": "كلمة المرور", "Inloggen": "دخول",
    // common actions
    "Vernieuwen": "تحديث", "Opslaan": "حفظ", "Annuleren": "إلغاء", "Verwijderen": "حذف",
    "Sluiten": "إغلاق", "Bewerken": "تعديل", "Toevoegen": "إضافة", "Verstuur": "إرسال",
    "Versturen": "إرسال", "Terug": "رجوع", "Zoek": "بحث", "Details": "التفاصيل",
    "Filters wissen": "مسح الفلاتر", "Wijziging opslaan": "حفظ التعديل",
    "Wijzigingen opslaan": "حفظ التعديلات", "Laden…": "جارٍ التحميل…", "Laden...": "جارٍ التحميل...",
    "Opgeslagen.": "تم الحفظ.", "Ja": "نعم", "Nee": "لا", "Alle": "الكل", "Actief": "فعّال",
    "Verlopen": "منتهي", "Vorige": "السابق", "Volgende": "التالي", "← Vorige": "← السابق",
    "Volgende →": "التالي →", "Gesprek sluiten": "إغلاق المحادثة",
    "Gesprekken laden…": "جارٍ تحميل المحادثات…", "Selecteer een gesprek": "اختر محادثة",
    "Typ je antwoord…": "اكتب ردّك…", "Wijzigingen nog niet opgeslagen": "التعديلات غير محفوظة بعد",
    "Opslaan als": "حفظ باسم",
    // statuses
    "Alle statussen": "كل الحالات", "Nieuw": "جديد", "In behandeling": "قيد المعالجة",
    "Wacht op klant": "بانتظار الزبون", "Wacht op leverancier": "بانتظار المورّد",
    "Resultaat ontvangen": "وصلت النتيجة", "Mislukt": "فشل", "Voltooid": "مكتمل",
    "Geannuleerd": "ملغي", "Akkoord door klant": "وافق الزبون", "Afgewezen door klant": "رفضها الزبون",
    "Betaald": "مدفوع", "Niet betaald": "غير مدفوع", "Gedeeltelijk betaald": "مدفوع جزئياً",
    "Verzonden": "مُرسل", "Afgerond": "منتهي", "Onbekende klant": "زبون غير معروف",
    // repair requests
    "Repair Requests": "طلبات التصليح", "Totaal orders": "إجمالي الطلبات",
    "Klant": "الزبون", "E-mail": "البريد الإلكتروني", "Telefoon": "الهاتف",
    "Status": "الحالة", "Toestel / service": "الجهاز / الخدمة", "Aangemaakt": "تاريخ الإنشاء",
    "Probleem / klacht": "المشكلة / الشكوى", "Offerte aan klant": "عرض سعر للزبون",
    "Prijs (€)": "السعر (€)", "Geschatte duur": "المدة المتوقعة", "Geldig": "صالح لمدة",
    "Bericht aan klant": "رسالة للزبون", "Offerte opslaan & verzenden": "حفظ وإرسال عرض السعر",
    "Aanvraag ontvangen": "تم استلام الطلب", "Extra foto gevraagd": "طلب صورة إضافية",
    "Extra informatie": "معلومات إضافية", "Tijdlijn & notities": "السجل والملاحظات",
    "Stuur statusupdate naar klant": "إرسال تحديث الحالة للزبون",
    "Zichtbaar voor de klant (op de volgpagina)": "ظاهرة للزبون (في صفحة التتبّع)",
    "Notitie of bericht aan de klant...": "ملاحظة أو رسالة للزبون...",
    "Nog geen gebeurtenissen.": "لا توجد أحداث بعد.", "Interne notitie": "ملاحظة داخلية",
    "Bericht aan klant (zichtbaar)": "رسالة للزبون (ظاهرة)",
    "E-mail verzonden.": "تم إرسال البريد.",
    "Nog geen repair requests gevonden.": "لا توجد طلبات تصليح بعد.",
    "Zoeken op klant, e-mail, telefoon, toestel...": "ابحث بالزبون أو البريد أو الهاتف أو الجهاز...",
    "Zoeken op klant, e-mail, telefoon, ordernummer, postcode...": "ابحث بالزبون أو البريد أو الهاتف أو رقم الطلب أو الرمز البريدي...",
    "Zoek op afzender of onderwerp…": "ابحث بالمرسل أو الموضوع…",
    "Zoek dienst…": "ابحث عن خدمة…",
    // customers
    "Klanten beheren": "إدارة الزبائن", "Klant aanmaken": "إنشاء زبون", "Nieuwe klant aanmaken": "إنشاء زبون جديد",
    "Voornaam *": "الاسم الأول *", "Achternaam *": "اسم العائلة *", "E-mail *": "البريد الإلكتروني *",
    "Postcode *": "الرمز البريدي *", "Huisnummer *": "رقم المنزل *", "Straatnaam *": "اسم الشارع *",
    "Plaatsnaam *": "المدينة *", "Telefoon (optioneel)": "الهاتف (اختياري)", "Account aanmaken": "إنشاء الحساب",
    "Klantgegevens wijzigen": "تعديل بيانات الزبون", "Postcode": "الرمز البريدي", "Huisnummer": "رقم المنزل",
    "Straatnaam": "اسم الشارع", "Plaatsnaam": "المدينة", "Wachtwoord instellen": "تعيين كلمة مرور",
    "Wachtwoord opslaan": "حفظ كلمة المرور", "Terug naar klant": "رجوع للزبون",
    // orders / payments
    "Webshop Bestellingen": "طلبات المتجر", "Alle bestelstatussen": "كل حالات الطلب",
    "Alle betaalstatussen": "كل حالات الدفع", "Bestelling": "الطلب", "Bestellingen": "الطلبات",
    "Betaling": "الدفع", "Verzending": "الشحن", "Betaalmethode": "طريقة الدفع", "Betaalstatus": "حالة الدفع",
    "Verzending opslaan": "حفظ الشحن", "Betaalmodus": "وضع الدفع",
    "Betalen bij ontvangst": "الدفع عند الاستلام", "PayPal opslaan": "حفظ PayPal", "Mollie opslaan": "حفظ Mollie",
    // buyback
    "Alle aanvragen": "كل الطلبات", "Alleen verkoop": "بيع فقط", "Inruil": "مقايضة",
    // stock
    "Voorraadartikelen": "أصناف المخزون", "Catalogus": "الكتالوج", "Totale stuks": "إجمالي القطع",
    "Bijna op": "شارف على النفاد", "Uitverkocht": "نفد", "Productvoorraad": "مخزون المنتجات",
    "Telefoons": "الهواتف", "Lage voorraad": "مخزون منخفض", "Voorraad wijzigen": "تعديل المخزون",
    "Voorraadgeschiedenis": "سجل المخزون", "Voorraadmutatie opslaan": "حفظ حركة المخزون",
    "Aantal stuks *": "عدد القطع *", "Selecteer een product": "اختر منتجاً",
    // invoices
    "Nieuwe factuur": "فاتورة جديدة", "Opgeslagen facturen": "الفواتير المحفوظة", "Particulier": "فرد",
    "Zakelijk / bedrijf": "شركة / عمل", "Bedrijfsnaam": "اسم الشركة", "Omschrijving": "الوصف",
    "Aantal": "الكمية", "Prijs per stuk": "سعر القطعة", "BTW": "ضريبة القيمة المضافة",
    "Subtotaal excl. BTW": "المجموع بدون الضريبة", "Totaal incl. BTW": "المجموع مع الضريبة",
    "Factuur opslaan als concept": "حفظ الفاتورة كمسودة", "PDF-voorbeeld bekijken": "معاينة PDF",
    "Vervaldatum": "تاريخ الاستحقاق", "Opmerkingen": "ملاحظات",
    // partners / admins
    "Schakelpartners": "الشركاء", "Nieuwe partner": "شريك جديد", "Bestaande partners": "الشركاء الحاليون",
    "Partner aanmaken": "إنشاء شريك", "Nieuwe admin": "مشرف جديد", "Bestaande admins": "المشرفون الحاليون",
    "Admin aanmaken": "إنشاء مشرف", "Rechten": "الصلاحيات", "Partnerbestellingen": "طلبات الشركاء",
    // catalogue / homepage
    "Homepage instellingen": "إعدادات الصفحة الرئيسية", "Dienst toevoegen": "إضافة خدمة",
    "Telefoon toevoegen": "إضافة هاتف", "Product toevoegen": "إضافة منتج", "Korting toevoegen": "إضافة خصم",
    "Optie toevoegen": "إضافة خيار", "Categorie toevoegen": "إضافة فئة", "Voordeel toevoegen": "إضافة ميزة",
    "Voorbeeld openen": "فتح المعاينة", "Shop bekijken": "عرض المتجر", "Telefoons te koop": "هواتف للبيع",
    "Alle kortingen": "كل الخصومات", "Categorie": "الفئة", "Alle categorieën": "كل الفئات",
    "Gekozen": "المختارة", "Niet gekozen": "غير المختارة", "Synchroniseren": "مزامنة",
    "Verbinding testen": "اختبار الاتصال", "Aanvragen van klanten": "طلبات الزبائن",
    "Merk": "الماركة", "Model": "الموديل", "Apparaten & categorieën": "الأجهزة والفئات",
    "Zo goed als nieuw": "كالجديد", "Licht gebruikt": "استخدام خفيف", "Zichtbaar gebruikt": "استخدام ظاهر",
    "Waarom HOMS TECH?": "لماذا HOMS TECH؟",
    // email inbox
    "E-mail Inbox": "صندوق البريد", "Inbox": "الوارد", "Bijlagen": "المرفقات", "Nieuw bericht": "رسالة جديدة",
    "Aan": "إلى", "Onderwerp": "الموضوع", "E-mail versturen": "إرسال البريد", "Alle berichten": "كل الرسائل",
    "Berichten": "الرسائل", "Selecteer een e-mail": "اختر رسالة", "Bijlage toevoegen": "إضافة مرفق",
    "Foto toevoegen": "إضافة صورة", "Vet": "عريض", "Cursief": "مائل", "Onderstrepen": "تسطير", "Opsomming": "قائمة",
    "Typ hier uw bericht…": "اكتب رسالتك هنا…",
    // descriptions
    "Zoek klanten en bestellingen vanuit één plek.": "ابحث عن الزبائن والطلبات من مكان واحد.",
    "Beheer de reparatiediensten die op de website verschijnen.": "إدارة خدمات التصليح الظاهرة في الموقع.",
    "Beheer de telefoons die HOMS TECH verkoopt.": "إدارة الهواتف التي تبيعها HOMS TECH.",
    "Beheer de voordelen die op de homepage verschijnen.": "إدارة المزايا الظاهرة في الصفحة الرئيسية.",
    "Klanten bekijken, aanpassen, aanmaken, wachtwoord wijzigen of verwijderen.": "عرض الزبائن وتعديلهم وإنشاؤهم وتغيير كلمة المرور أو الحذف.",
    "Bestellingen uit de webshop, met klantgegevens, producten en status.": "طلبات المتجر مع بيانات الزبون والمنتجات والحالة.",
    "Prijsaanvragen voor toestelreparaties, apart van Reparatieaanvragen.": "طلبات أسعار تصليح الأجهزة.",
    "Beantwoord berichten van bezoekers rechtstreeks vanuit deze pagina.": "ردّ على رسائل الزوّار مباشرة من هذه الصفحة.",
    "Reparatie- en prijsaanvragen": "طلبات التصليح والأسعار",
    "Bestellingen uit de HOMS TECH webshop": "طلبات متجر HOMS TECH",
    "Telefoons die klanten aan HOMS TECH verkopen": "هواتف يبيعها الزبائن لـ HOMS TECH"
  };

  // Dynamic text (counters, dates in sentences).
  var RULES = [
    [/^(\d+) van (\d+) repair request\(s\) zichtbaar$/, function (m) { return m[1] + " من " + m[2] + " طلب تصليح ظاهر"; }],
    [/^Reparatieaanvraag #(\d+)$/, function (m) { return "طلب تصليح #" + m[1]; }],
    [/^(\d+) ongelezen$/, function (m) { return m[1] + " غير مقروءة"; }],
    [/^(\d+) berichten$/, function (m) { return m[1] + " رسائل"; }],
    [/^Offerte verstuurd per e-mail op (.+) · € (.+)$/, function (m) { return "تم إرسال عرض السعر بالبريد في " + m[1] + " · € " + m[2]; }],
    [/^Statusupdate per e-mail verzonden: (.+)$/, function (m) { return "تم إرسال تحديث الحالة بالبريد: " + m[1]; }],
    [/^Status: (.+)$/, function (m) { return "الحالة: " + (D[m[1]] || m[1]); }]
  ];

  var missing = (window.HOMS_I18N_MISSING = window.HOMS_I18N_MISSING || {});
  var ICON = /^[\s←-⯿☀-➿️‍＋+\u{1F000}-\u{1FAFF}]+/u;

  function tr(text) {
    var trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return null;
    if (Object.prototype.hasOwnProperty.call(D, trimmed)) return D[trimmed];
    var icon = "", body = trimmed;
    var m = ICON.exec(trimmed);
    if (m && m[0].trim()) { icon = m[0].trim() + " "; body = trimmed.slice(m[0].length).trim(); }
    if (body && Object.prototype.hasOwnProperty.call(D, body)) return icon + D[body];
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i][0].exec(trimmed);
      if (r) return RULES[i][1](r);
    }
    if (/[A-Za-z]{3}/.test(trimmed)) missing[trimmed] = 1;
    return null;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  function skipEl(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (SKIP[n.nodeName.toUpperCase()] || n.hasAttribute("data-no-i18n")) return true;
    }
    return false;
  }
  function textNode(node) {
    var p = node.parentElement;
    if (!p || skipEl(p)) return;
    var out = tr(node.nodeValue);
    if (out == null) return;
    var lead = /^\s*/.exec(node.nodeValue)[0], tail = /\s*$/.exec(node.nodeValue)[0];
    var next = lead + out + tail;
    if (node.nodeValue !== next) {
      // An <option> without a value attribute uses its text as value: freeze it first.
      if (p.nodeName === "OPTION" && !p.hasAttribute("value")) p.setAttribute("value", node.nodeValue.trim());
      node.nodeValue = next;
    }
  }
  function attrs(el) {
    if (el.nodeType !== 1 || skipEl(el)) return;
    ["placeholder", "title", "aria-label"].forEach(function (a) {
      if (!el.hasAttribute(a)) return;
      var out = tr(el.getAttribute(a));
      if (out != null && out !== el.getAttribute(a)) el.setAttribute(a, out);
    });
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1) return;
    attrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else attrs(n); }
  }

  function addSwitch() {
    if (document.getElementById("htLangSwitch")) return;
    var host = document.querySelector(".topbar");
    if (!host) return;
    var b = document.createElement("button");
    b.type = "button"; b.id = "htLangSwitch"; b.className = "ht-lang-switch";
    b.setAttribute("data-no-i18n", "");
    b.textContent = lang === "ar" ? "Nederlands" : "عربي";
    b.title = lang === "ar" ? "Wissel naar Nederlands" : "التبديل إلى العربية";
    b.addEventListener("click", function () {
      try { localStorage.setItem(KEY, lang === "ar" ? "nl" : "ar"); } catch (e) {}
      location.reload();
    });
    host.appendChild(b);
  }

  function style() {
    var s = document.createElement("style");
    s.textContent =
      ".ht-lang-switch{margin-inline-start:auto;border:1px solid #cdd8e4;background:#fff;color:#0f2742;border-radius:999px;white-space:nowrap;flex:0 0 auto;min-height:38px;padding:0 16px;font:600 14px/1 inherit;font-family:inherit;cursor:pointer}" +
      ".ht-lang-switch:hover{background:#eef4fb}" +
      "html[lang=ar] body{font-family:'Segoe UI',Tahoma,'Noto Sans Arabic',Arial,sans-serif}" +
      "html[lang=ar] input,html[lang=ar] textarea,html[lang=ar] select{text-align:start}" +
      "html[lang=ar] [type=email],html[lang=ar] [type=url],html[lang=ar] [type=tel],html[lang=ar] [type=number]{direction:ltr;text-align:right}";
    document.head.appendChild(s);
  }

  function start() {
    style();
    addSwitch();
    if (lang !== "ar") return;
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.title = "HOMS TECH - لوحة التحكم";
    walk(document.body);
    var queue = [], scheduled = false;
    var cfg = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] };
    var obs = new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === "characterData" || m.type === "attributes") queue.push(m.target);
        else m.addedNodes.forEach(function (n) { queue.push(n); });
      });
      if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
    });
    function flush() {
      scheduled = false;
      var batch = queue; queue = [];
      obs.disconnect();
      batch.forEach(function (n) { if (n.isConnected) walk(n); });
      obs.observe(document.body, cfg);
    }
    obs.observe(document.body, cfg);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
