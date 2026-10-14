"use strict";
(function () {
  let sent = false;
  function countVisiblePage() {
    if (sent || document.visibilityState !== "visible" || navigator.doNotTrack === "1" ||
        navigator.globalPrivacyControl === true || navigator.webdriver ||
        new URLSearchParams(location.search).get("preview") === "1") return;
    sent = true;
    fetch("/api/sales/visit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: "/vendas" }), credentials: "omit", keepalive: true
    }).catch(() => {});
  }
  document.addEventListener("visibilitychange", countVisiblePage);
  countVisiblePage();
}());
