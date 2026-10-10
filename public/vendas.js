"use strict";
(function () {
  const arena = document.getElementById("demoArena");
  const buttons = document.querySelectorAll("[data-demo]");
  const status = document.getElementById("demoStatus");
  const commentTitle = document.getElementById("demoActivityTitle");
  const commentText = document.getElementById("demoActivityText");
  const giftTitle = document.getElementById("demoGiftTitle");
  const giftText = document.getElementById("demoGiftText");

  if (!arena || !status || !commentTitle || !commentText || !giftTitle || !giftText) return;

  const states = {
    comment: {
      status: "Comentário simulado: SeuViewer apareceu no palco. Experimente enviar uma Rosa!",
      commentTitle: "Comentário recebido (simulado)",
      commentText: "SeuViewer entrou no palco",
      giftTitle: "Exemplo de presente",
      giftText: "Rose → efeito GRANDE"
    },
    rose: {
      status: "Rosa simulada: efeito GRANDE ativado no personagem. Não é um presente real.",
      commentTitle: "Comentário recebido (simulado)",
      commentText: "SeuViewer entrou no palco",
      giftTitle: "Presente recebido (simulado)",
      giftText: "Rose → efeito GRANDE"
    },
    reset: {
      status: "Prévia reiniciada. Experimente comentar um nick ou enviar uma Rosa.",
      commentTitle: "Exemplo de comentário",
      commentText: "Knzz0102 entrou no palco",
      giftTitle: "Exemplo de presente",
      giftText: "Rose → efeito GRANDE"
    }
  };

  buttons.forEach(button => {
    button.addEventListener("click", () => {
      const type = button.dataset.demo;
      const next = states[type];
      if (!next) return;

      arena.classList.remove("demo-comment", "demo-grow");
      // Trigger the stage transition after the reset to allow repeated clicks.
      if (type === "comment") arena.classList.add("demo-comment");
      if (type === "rose") arena.classList.add("demo-grow");

      status.textContent = next.status;
      commentTitle.textContent = next.commentTitle;
      commentText.textContent = next.commentText;
      giftTitle.textContent = next.giftTitle;
      giftText.textContent = next.giftText;

      buttons.forEach(other => {
        other.classList.toggle("is-active", other === button && type !== "reset");
      });
    });
  });
}());

(function initPublicCheckout() {
  // O link de pagamento só aparece quando o Render confirma que a
  // liberação de acesso pela Kiwify está configurada e saudável.
  const btn=document.getElementById("salesCheckoutButton");
  const pending=document.getElementById("salesCheckoutPending");
  const heading=document.getElementById("salesCheckoutHeading");
  const description=document.getElementById("salesCheckoutDescription");
  const footnote=document.getElementById("salesCheckoutFootnote");
  const notice=document.getElementById("salesNoticeText");
  if (!btn || !pending || !heading || !description || !footnote || !notice) return;

  fetch("/api/config", { cache: "no-store" })
    .then(async response => {
      if (!response.ok) return null;
      return response.json();
    })
    .then(data => {
      if (data?.salesReady !== true || typeof data.checkoutUrl !== "string") return;
      let url;
      try { url=new URL(data.checkoutUrl); } catch { return; }
      const params=[...url.searchParams.entries()];
      if (url.protocol!=="https:" || url.hostname!=="pay.kiwify.com.br" ||
          !/^\/[A-Za-z0-9]{5,24}$/.test(url.pathname) ||
          params.length!==1 || params[0][0]!=="hideCard" ||
          params[0][1]!=="true") return;
      btn.href=url.toString();
      btn.style.display="flex";
      pending.style.display="none";
      heading.textContent="Comece agora";
      description.textContent="Compra única do PalcoLive. Pagamento pela Kiwify via Pix ou boleto. Após a aprovação, acesse as instruções na área de membros para ativar seu produto.";
      footnote.textContent="Pagamento processado com segurança pela Kiwify. Compra única; o funcionamento depende da disponibilidade dos serviços utilizados.";
      notice.textContent="Vendas abertas: compre via Pix ou boleto na Kiwify e receba o acesso após a aprovação do pagamento.";
    })
    .catch(() => {
      // Em caso de falha, manter a venda indisponível.
    });
}());
