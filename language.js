```js
(function () {

  const LANGUAGE_KEY = "homsTechLanguage";

  const translations = {

    nl: {
      dir: "ltr",
      navHome: "Home",
      navAbout: "Over ons",
      navRepair: "Reparaties",
      navDevices: "Apparaten",
      navPrices: "Prijzen",
      whatsapp: "WhatsApp",
      aboutTitle: "👋 Over ons",
      aboutText1: "Wij zijn gespecialiseerd in telefoonreparatie en bieden een snelle en gemakkelijke service bij jou aan de deur.",
      aboutText2: "Neem contact met ons op via WhatsApp, vertel ons het model van je telefoon en het probleem. Wij geven je de prijs en plannen een afspraak.",
      aboutBannerTitle: "🚗 Je hoeft niet naar de winkel",
      aboutBannerText: "Wij komen naar jou binnen ons servicegebied.",
      contactNow: "Neem nu contact op",
      repairTitle: "🔧 Wat repareren wij?",
      repairIntro: "Wij bieden verschillende reparatiediensten voor telefoons.",
      whyTitle: "Waarom kiezen voor HOMS TECH?",
      devicesTitle: "📱 Apparaten",
      devicesIntro: "Kies een merk om de modellen en prijzen te bekijken.",
      devicesView: "Klik om modellen en prijzen te bekijken",
      pricesTitle: "💰 Prijzen",
      pricesIntro: "Reparatieprijzen afhankelijk van het model en de service.",
      allDevices: "Alle apparaten",
      screen: "🖥️ Scherm",
      software: "💻 Software",
      hardware: "🔧 Hardware",
      camera: "📷 Camera",
      contactPrice: "Neem contact op voor de prijs",
      bookWhatsapp: "Boek via WhatsApp",
      footerTag: "Telefoonreparatie bij jou aan de deur",
      admin: "⚙️ Admin"
    },

    ar: {
      dir: "rtl",
      navHome: "الرئيسية",
      navAbout: "مين نحن",
      navRepair: "شو منصلّح",
      navDevices: "أنواع الأجهزة",
      navPrices: "الأسعار",
      whatsapp: "واتساب",
      aboutTitle: "👋 مين نحن؟",
      aboutText1: "نحن متخصصون بتصليح الهواتف، ونوفر لك خدمة مريحة وسريعة عند باب بيتك.",
      aboutText2: "تواصل معنا على واتساب، أخبرنا بموديل جهازك والعطل، ونخبرك بالسعر وننسّق معك الموعد.",
      aboutBannerTitle: "🚗 ما تتعب حالك وتروح للمحل",
      aboutBannerText: "نجي لعندك ضمن مناطق الخدمة.",
      contactNow: "تواصل معنا الآن",
      repairTitle: "🔧 شو منصلّح؟",
      repairIntro: "منقدملك خدمات تصليح متنوعة للهواتف.",
      whyTitle: "ليش تختار HOMS TECH؟",
      devicesTitle: "📱 أنواع الأجهزة",
      devicesIntro: "اختار الشركة لمشاهدة الأجهزة والأسعار.",
      devicesView: "اضغط لعرض الموديلات والأسعار",
      pricesTitle: "💰 الأسعار",
      pricesIntro: "أسعار تصليح الأجهزة حسب الموديل والخدمة.",
      allDevices: "كل الأجهزة",
      screen: "🖥️ الشاشة",
      software: "💻 السوفتوير",
      hardware: "🔧 الهاردوير",
      camera: "📷 الكاميرا",
      contactPrice: "اتصل للسعر",
      bookWhatsapp: "احجز عبر واتساب",
      footerTag: "تصليح هواتف عند باب بيتك",
      admin: "⚙️ لوحة التحكم"
    },

    en: {
      dir: "ltr",
      navHome: "Home",
      navAbout: "About us",
      navRepair: "Repairs",
      navDevices: "Devices",
      navPrices: "Prices",
      whatsapp: "WhatsApp",
      aboutTitle: "👋 About us",
      aboutText1: "We specialize in phone repair and provide a fast and convenient service at your doorstep.",
      aboutText2: "Contact us on WhatsApp, tell us your phone model and the problem. We will give you the price and arrange an appointment.",
      aboutBannerTitle: "🚗 You don't need to go to the shop",
      aboutBannerText: "We come to you within our service area.",
      contactNow: "Contact us now",
      repairTitle: "🔧 What do we repair?",
      repairIntro: "We provide a variety of phone repair services.",
      whyTitle: "Why choose HOMS TECH?",
      devicesTitle: "📱 Devices",
      devicesIntro: "Choose a brand to view the available models and prices.",
      devicesView: "Click to view models and prices",
      pricesTitle: "💰 Prices",
      pricesIntro: "Repair prices depend on the device model and service.",
      allDevices: "All devices",
      screen: "🖥️ Screen",
      software: "💻 Software",
      hardware: "🔧 Hardware",
      camera: "📷 Camera",
      contactPrice: "Contact us for the price",
      bookWhatsapp: "Book via WhatsApp",
      footerTag: "Phone repair at your doorstep",
      admin: "⚙️ Admin"
    }

  };


  function getLanguage() {
    return localStorage.getItem(LANGUAGE_KEY) || "nl";
  }


  function getTranslation(key) {

    const lang = getLanguage();

    return (
      (translations[lang] && translations[lang][key]) ||
      translations.nl[key] ||
      key
    );

  }


  function setLanguage(lang) {

    if (!translations[lang]) {
      lang = "nl";
    }

    localStorage.setItem(
      LANGUAGE_KEY,
      lang
    );

    document.documentElement.lang = lang;
    document.documentElement.dir = translations[lang].dir;

    document
      .querySelectorAll("[data-i18n]")
      .forEach(function (element) {

        const key =
          element.getAttribute("data-i18n");

        if (translations[lang][key]) {
          element.textContent =
            translations[lang][key];
        }

      });


    updateLanguageMenu();


    if (
      typeof window.renderCurrentPage ===
      "function"
    ) {

      window.renderCurrentPage();

    }

  }


  function updateLanguageMenu() {

    const container =
      document.querySelector(".languages");

    if (!container) {
      return;
    }


    const current =
      getLanguage();


    const names = {

      nl: "🇳🇱 Nederlands",

      ar: "🇸🇦 العربية",

      en: "🇬🇧 English"

    };


    container.innerHTML = "";


    const wrapper =
      document.createElement("div");

    wrapper.className =
      "language-dropdown";


    const mainButton =
      document.createElement("button");

    mainButton.type = "button";

    mainButton.className =
      "language-main";

    mainButton.innerHTML =
      (names[current] || names.nl) +
      ' <span>▼</span>';


    const menu =
      document.createElement("div");

    menu.className =
      "language-menu";


    ["nl", "ar", "en"].forEach(function (lang) {

      const button =
        document.createElement("button");

      button.type = "button";

      button.textContent =
        names[lang];

      button.onclick =
        function (event) {

          event.stopPropagation();

          setLanguage(lang);

          menu.classList.remove("show");

        };


      menu.appendChild(button);

    });


    mainButton.onclick =
      function (event) {

        event.stopPropagation();

        menu.classList.toggle("show");

      };


    wrapper.appendChild(mainButton);

    wrapper.appendChild(menu);

    container.appendChild(wrapper);


    document.onclick =
      function () {

        menu.classList.remove("show");

      };

  }


  function updateCommonElements() {

    const data =
      window.homsTechData || {};


    document
      .querySelectorAll("[data-name]")
      .forEach(function (element) {

        if (data.businessName) {
          element.textContent =
            data.businessName;
        }

      });


    document
      .querySelectorAll("[data-tag]")
      .forEach(function (element) {

        if (data.tagline) {
          element.textContent =
            data.tagline;
        }

      });


    if (data.whatsapp) {

      const message =
        getLanguage() === "ar"
          ? "مرحبا، أريد الاستفسار عن تصليح هاتفي"
          : getLanguage() === "en"
          ? "Hello, I would like to ask about phone repair."
          : "Hallo, ik wil graag informeren over telefoonreparatie.";


      const whatsappUrl =
        "https://wa.me/" +
        data.whatsapp +
        "?text=" +
        encodeURIComponent(message);


      document
        .querySelectorAll("[data-wa]")
        .forEach(function (element) {

          element.href =
            whatsappUrl;

        });

    }


    if (data.phone) {

      document
        .querySelectorAll("[data-phone]")
        .forEach(function (element) {

          element.href =
            "tel:" +
            data.phone.replace(/\s/g, "");

        });

    }

  }


  function addStyles() {

    if (
      document.getElementById(
        "homs-language-style"
      )
    ) {

      return;

    }


    const style =
      document.createElement("style");


    style.id =
      "homs-language-style";


    style.textContent = `

      .languages {
        position: relative;
        z-index: 9999;
      }

      .language-dropdown {
        position: relative;
        display: inline-block;
      }

      .language-main {
        display: block;
        background: #26354d;
        color: #fff;
        border: 0;
        border-radius: 8px;
        padding: 9px 12px;
        cursor: pointer;
        font-weight: 700;
        white-space: nowrap;
      }

      .language-main:hover {
        background: #fff;
        color: #111827;
      }

      .language-main span {
        font-size: 10px;
        margin-left: 5px;
      }

      .language-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        width: 165px;
        background: #111827;
        border-radius: 10px;
        padding: 6px;
        display: none;
        flex-direction: column;
        gap: 5px;
        box-shadow: 0 8px 25px rgba(0,0,0,.30);
      }

      .language-menu.show {
        display: flex !important;
      }

      .language-menu button {
        width: 100%;
        display: block;
        background: #26354d;
        color: #fff;
        border: 0;
        border-radius: 7px;
        padding: 10px 8px;
        cursor: pointer;
        font-weight: 700;
        font-size: 14px;
      }

      .language-menu button:hover {
        background: #fff;
        color: #111827;
      }

      @media(max-width:500px) {

        .language-main {
          font-size: 12px;
          padding: 8px 9px;
        }

        .language-menu {
          width: 150px;
        }

        .language-menu button {
          font-size: 13px;
        }

      }

    `;


    document.head.appendChild(style);

  }


  function init() {

    addStyles();

    updateLanguageMenu();

    updateCommonElements();

    setLanguage(getLanguage());

  }


  window.setLanguage =
    setLanguage;

  window.applyLanguage =
    setLanguage;

  window.getLanguage =
    getLanguage;

  window.getTranslation =
    getTranslation;

  window.homsTechTranslations =
    translations;


  if (
    document.readyState === "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init
    );

  } else {

    init();

  }

})();
```
