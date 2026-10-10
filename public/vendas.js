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
