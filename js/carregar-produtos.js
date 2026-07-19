// js/carregar-produtos.js
// Importa a base de dados e os métodos do Firestore
import { db } from "./fireconfig.js";
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", async function () {
  const vitrineDinamica = document.getElementById("vitrine-dinamica");
  if (!vitrineDinamica) return;

  try {
    const querySnapshot = await getDocs(collection(db, "produtos"));
    vitrineDinamica.innerHTML = "";

    querySnapshot.forEach((doc) => {
      const produto = doc.data() || {};
      const produtoId = doc.id;
      const nomeProduto = produto.nome || "Produto sem nome";
      const precoProduto = parseFloat(produto.valor) || 0.0;
      const imagemProduto = produto.imagemUrl || "img/placeholder.png";
      const codigoProduto = produto.codigo || "";
      const precoFormatado = precoProduto.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });

      const cardProduto = document.createElement("div");
      cardProduto.className = "produto-card";
      cardProduto.innerHTML = `
                <div class="produto-imagem-baia">
                    <img src="${imagemProduto}" alt="${nomeProduto}">
                </div>
                <div class="produto-titulo">${nomeProduto}</div>
                <div class="produto-preco">${precoFormatado}</div>
            `;

      const botaoComprar = document.createElement("button");
      botaoComprar.className = "btn-comprar btn-verde";
      botaoComprar.type = "button";
      botaoComprar.innerHTML =
        '<i class="fa-solid fa-cart-shopping"></i> COMPRAR';
      botaoComprar.addEventListener("click", () => {
        window.comprarAgora({
          id: produtoId,
          nome: nomeProduto,
          preco: precoProduto,
          codigo: codigoProduto,
        });
      });

      const botaoAdicionar = document.createElement("button");
      botaoAdicionar.className = "btn-comprar btn-amarelo";
      botaoAdicionar.type = "button";
      botaoAdicionar.innerHTML =
        '<i class="fa-solid fa-cart-plus"></i> ADICIONAR';
      botaoAdicionar.addEventListener("click", () => {
        window.adicionarComAnimacao(
          {
            id: produtoId,
            nome: nomeProduto,
            preco: precoProduto,
            codigo: codigoProduto,
          },
          botaoAdicionar,
        );
      });

      cardProduto.appendChild(botaoComprar);
      cardProduto.appendChild(botaoAdicionar);
      vitrineDinamica.appendChild(cardProduto);
    });
  } catch (error) {
    console.error("Erro ao carregar os produtos da vitrine:", error);
    vitrineDinamica.innerHTML =
      '<p style="color: #ef4444; text-align: center; width: 100%;">Não foi possível carregar os produtos. Recarregue a página.</p>';
  }
});
