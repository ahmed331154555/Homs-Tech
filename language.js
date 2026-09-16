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
      aboutText1:
        "Wij zijn gespecialiseerd in telefoonreparatie en bieden een snelle en gemakkelijke service bij jou aan de deur.",
      aboutText2:
        "Neem contact met ons op via WhatsApp, vertel ons het model van je telefoon en het probleem. Wij geven je de prijs en plannen een afspraak.",
      aboutBannerTitle: "🚗 Je hoeft niet naar de winkel",
      aboutBannerText: "Wij komen naar jou binnen ons servicegebied.",
      contactNow: "Neem nu contact op",

      repairTitle: "🔧 Wat repareren wij?",
      repairIntro:
        "Wij bieden verschillende reparatiediensten voor telefoons.",
      whyTitle: "Waarom kiezen voor HOMS TECH?",

      devicesTitle: "📱 Apparaten",
      devicesIntro: "Kies een merk om de modellen en prijzen te bekijken.",
      devicesView: "Klik om modellen en prijzen te bekijken",

      pricesTitle: "💰 Prijzen",
      pricesIntro:
        "Reparatieprijzen afhankelijk van het model en de service.",
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
      aboutText1:
        "نحن متخصصون بتصليح الهواتف، ونوفر لك خدمة مريحة وسريعة عند باب بيتك.",
      aboutText2:
        "تواصل معنا على واتساب، أخبرنا بموديل جهازك والعطل، ونخبرك بالسعر وننسّق معك الموعد.",
      aboutBannerTitle: "ما تتعب حالك وتروح للمحل",
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
      aboutText1:
        "We specialize in phone repair and provide a fast and convenient service at your doorstep.",
      aboutText2:
        "Contact us on WhatsApp, tell us your phone model and the problem. We will give you the price and arrange an appointment.",
      aboutBannerTitle: "You don't need to go to the shop",
      aboutBannerText: "We come to you within our service area.",
      contactNow: "Contact us now",

      repairTitle: "🔧 What do we repair?",
      repairIntro:
        "We provide a variety of phone repair services.",
      whyTitle: "Why choose HOMS TECH?",

      devicesTitle: "📱 Devices",
      devicesIntro:
        "Choose a brand to view the available models and prices.",
      devicesView: "Click to view models and prices",

      pricesTitle: "💰 Prices",
      pricesIntro:
        "Repair prices depend on the device model and service.",
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

  function applyLanguage(lang) {
    if (!translations[lang]) {
      lang = "nl";
    }

    localStorage.setItem(LANGUAGE_KEY, lang);

    document.documentElement.lang = lang;
    document.documentElement.dir = translations[lang].dir;

    document.querySelectorAll("[data-i18n]").forEach(function (element) {
      const key = element.getAttribute("data-i18n");

      if (translations[lang][key]) {
        element.textContent = translations[lang][key];
      }
    });

    document.querySelectorAll("[data-i18n-title]").forEach(function (element) {
      const key = element.getAttribute("data-i18n-title");

      if (translations[lang][key]) {
        element.setAttribute("title", translations[lang][key]);
      }
    });

    document.querySelectorAll("[data-lang-button]").forEach(function (button) {
      button.classList.toggle(
        "active",
        button.getAttribute("data-lang-button") === lang
      );
    });

    updateLanguageButtons();
  }

  function setLanguage(lang) {
    applyLanguage(lang);

    if (typeof window.renderCurrentPage === "function") {
      window.renderCurrentPage();
    }
  }

  function updateLanguageButtons() {
    const container = document.querySelector(".languages");

    if (!container) {
      return;
    }

    if (!container.querySelector("[data-lang-button]")) {
      container.innerHTML = `
        <button type="button" data-lang-button="nl">
          🇳🇱 Nederlands
        </button>

        <button type="button" data-lang-button="ar">
          🇸🇦 العربية
        </button>

        <button type="button" data-lang-button="en">
          🇬🇧 English
        </button>
      `;

      container
        .querySelectorAll("[data-lang-button]")
        .forEach(function (button) {
          button.addEventListener("click", function () {
            setLanguage(button.getAttribute("data-lang-button"));
          });
        });
    }

    const current = getLanguage();

    container
      .querySelectorAll("[data-lang-button]")
      .forEach(function (button) {
        button.classList.toggle(
          "active",
          button.getAttribute("data-lang-button") === current
        );
      });
  }

  function updateCommonElements() {
    const data = window.homsTechData || {};

    document.querySelectorAll("[data-name]").forEach(function (element) {
      if (data.businessName) {
        element.textContent = data.businessName;
      }
    });

    document.querySelectorAll("[data-tag]").forEach(function (element) {
      if (data.tagline) {
        element.textContent = data.tagline;
      }
    });

    if (data.whatsapp) {
      const whatsappUrl =
        "https://wa.me/" +
        data.whatsapp +
        "?text=" +
        encodeURIComponent(
          getLanguage() === "ar"
            ? "مرحبا، أريد الاستفسار عن تصليح هاتفي"
            : getLanguage() === "en"
            ? "Hello, I would like to ask about phone repair."
            : "Hallo, ik wil graag informeren over telefoonreparatie."
        );

      document.querySelectorAll("[data-wa]").forEach(function (element) {
        element.href = whatsappUrl;
      });
    }

    if (data.phone) {
      document.querySelectorAll("[data-phone]").forEach(function (element) {
        element.href = "tel:" + data.phone.replace(/\s/g, "");
      });
    }
  }

  function init() {
    updateLanguageButtons();
    updateCommonElements();
    applyLanguage(getLanguage());
    updateCommonElements();
  }

  window.setLanguage = setLanguage;
  window.applyLanguage = applyLanguage;
  window.getLanguage = getLanguage;
  window.getTranslation = getTranslation;
  window.homsTechTranslations = translations;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
