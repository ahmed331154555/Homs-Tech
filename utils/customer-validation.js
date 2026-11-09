"use strict";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAdminCustomerInput(input, { requirePassword = false } = {}) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const customer = {
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    phone: String(body.phone || "").trim(),
    address: String(body.address || "").trim(),
    password: String(body.password || "")
  };

  if (!customer.name || !customer.email) {
    return { error: "Naam en e-mail zijn verplicht." };
  }
  if (customer.name.length > 120) {
    return { error: "De naam mag maximaal 120 tekens bevatten." };
  }
  if (customer.email.length > 254 || !EMAIL_PATTERN.test(customer.email)) {
    return { error: "Vul een geldig e-mailadres in." };
  }
  if (customer.phone.length > 40) {
    return { error: "Het telefoonnummer mag maximaal 40 tekens bevatten." };
  }
  if (customer.address.length > 500) {
    return { error: "Het adres mag maximaal 500 tekens bevatten." };
  }
  if (requirePassword && customer.password.length < 8) {
    return { error: "Het wachtwoord moet minimaal 8 tekens bevatten." };
  }
  if (requirePassword && customer.password.length > 256) {
    return { error: "Het wachtwoord is te lang." };
  }

  return { customer };
}

module.exports = { validateAdminCustomerInput };
