// js/carregar-produtos.js
// Certifique-se de importar a sua base de dados ou configuração se precisar
import { db } from "./fireconfig.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", async function() {
    const vitrineDinamica = document.getElementById("vitrine-dinamica");

    if (!vitrineDinamica) return;

    try {
        // Buscar produtos da coleção "produtos" no Firestore
        const querySnapshot = await getDocs(collection(db, "produtos"));
        
        vitrineDinamica.innerHTML = ""; // Limpa a vitrine antes de preencher

        querySnapshot.forEach((doc) => {
            const produto = doc.data();
            const produtoId = doc.id;
            
            // CORREÇÃO: puxando as variáveis com os nomes exatos do banco
            const nomeProduto = produto.nome || "Produto sem nome";
            const precoProduto = produto.valor || 0.00; // Antes estava produto.preco
            const imagemProduto = produto.imagemUrl || "img/placeholder.png"; // Antes estava produto.imagem

            // Formatação do valor para moeda brasileira
            const precoFormatado = precoProduto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            // Criação do card do produto contendo o Botão Verde e o Botão Amarelo
            const cardProduto = `
                <div class="produto-card">
                    <div class="produto-imagem-baia">
                        <img src="${imagemProduto}" alt="${nomeProduto}">
                    </div>
                    <div class="produto-titulo">${nomeProduto}</div>
                    <div class="produto-preco">${precoFormatado}</div>
                    
                    <button class="btn-comprar btn-verde" onclick="window.location.href='compra.html?id=${produtoId}'">
                        <i class="fa-solid fa-cart-shopping"></i> COMPRAR
                    </button>

                    <button class="btn-comprar btn-amarelo" onclick="adicionarComAnimacao('${nomeProduto}', ${precoProduto}, this)">
                        <i class="fa-solid fa-cart-plus"></i> ADICIONAR
                    </button>
                </div>
            `;

            vitrineDinamica.innerHTML += cardProduto;
        });

    } catch (error) {
        console.error("Erro ao carregar os produtos da vitrine:", error);
    }
});