"use strict";

// Nunca exibir um botão de cobrança se a entrega não estiver pronta.
// A URL do checkout é validada no servidor antes de aparecer publicamente.
function validateCheckoutUrl(value, checkoutCode) {
  const code = String(checkoutCode || "").trim();
  if (!/^[A-Za-z0-9]{5,24}$/.test(code)) return "";
  try {
    const parsed = new URL(String(value || ""));
    const params = [...parsed.searchParams.entries()];
    if (parsed.protocol !== "https:" ||
        parsed.hostname !== "pay.kiwify.com.br" ||
        parsed.username || parsed.password || parsed.port ||
        parsed.pathname !== "/" + code ||
        parsed.hash ||
        params.length !== 1 ||
        params[0][0] !== "hideCard" ||
        params[0][1] !== "true") return "";
    return "https://pay.kiwify.com.br/" + code + "?hideCard=true";
  } catch {
    return "";
  }
}

function publicSalesState({ enabled, automaticReady, checkoutUrl, checkoutCode }) {
  const safeUrl = validateCheckoutUrl(checkoutUrl, checkoutCode);
  const salesReady = enabled === true && automaticReady === true && Boolean(safeUrl);
  return {
    salesReady,
    checkoutUrl: salesReady ? safeUrl : ""
  };
}

module.exports = { validateCheckoutUrl, publicSalesState };
