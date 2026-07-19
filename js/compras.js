// js/compras.js
import { db } from "./fireconfig.js";
import { doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

const auth = getAuth();

document.addEventListener("DOMContentLoaded", () => {
    let produtoAtual = null;
    let usuarioLogado = null;

    onAuthStateChanged(auth, (user) => {
        if (user) {
            usuarioLogado = user;
        }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const produtoId = urlParams.get('id');

    if (!produtoId) {
        document.getElementById("conteudo-produto").innerHTML = "<p class='has-text-centered'>Produto não encontrado.</p>";
        return;
    }

    const loader = document.getElementById("loader-compra");
    const conteudoProduto = document.getElementById("conteudo-produto");

    async function carregarProduto() {
        try {
            const produtoRef = doc(db, "produtos", produtoId);
            const docSnap = await getDoc(produtoRef);

            if (docSnap.exists()) {
                produtoAtual = { id: docSnap.id, ...docSnap.data() };
                renderizarProduto(produtoAtual);
            } else {
                throw new Error("Produto não existe no banco de dados.");
            }
        } catch (error) {
            console.error("Erro ao buscar produto:", error);
            conteudoProduto.innerHTML = `<p style="color: red; text-align: center;">Erro ao carregar o produto. Tente novamente.</p>`;
        } finally {
            loader.classList.add("is-hidden");
            conteudoProduto.classList.remove("is-hidden");
        }
    }

    function renderizarProduto(produto) {
        document.getElementById("produto-imagem").src = produto.imagemUrl || 'img/placeholder.png';
        document.getElementById("produto-nome").textContent = produto.nome;
        document.getElementById("produto-preco").textContent = produto.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        const secaoTamanhos = document.getElementById("secao-tamanhos");
        const opcoesTamanho = document.getElementById("opcoes-tamanho");
        const secaoLateralidade = document.getElementById("secao-lateralidade");
        const opcoesLateralidade = document.getElementById("opcoes-lateralidade");

        opcoesTamanho.innerHTML = '';
        opcoesLateralidade.innerHTML = '';

        const tamanhosDisponiveis = [];
        const lateralidadesDisponiveis = [];

        for (const key in produto.grade) {
            if (produto.grade[key] > 0) {
                if (key === 'E' || key === 'D') {
                    lateralidadesDisponiveis.push(key);
                } else {
                    tamanhosDisponiveis.push(key);
                }
            }
        }

        if (tamanhosDisponiveis.length > 0) {
            secaoTamanhos.classList.remove("is-hidden");
            tamanhosDisponiveis.forEach(tamanho => {
                opcoesTamanho.innerHTML += `
                    <div>
                        <input type="radio" id="tamanho-${tamanho}" name="tamanho" value="${tamanho}" required>
                        <label for="tamanho-${tamanho}">${tamanho}</label>
                    </div>
                `;
            });
        }

        if (lateralidadesDisponiveis.length > 0) {
            secaoLateralidade.classList.remove("is-hidden");
            lateralidadesDisponiveis.forEach(lat => {
                const nomeCompleto = lat === 'E' ? 'Esquerda' : 'Direita';
                opcoesLateralidade.innerHTML += `
                    <div>
                        <input type="radio" id="lat-${lat}" name="lateralidade" value="${lat}" required>
                        <label for="lat-${lat}">${nomeCompleto}</label>
                    </div>
                `;
            });
        }
    }

    const formCompra = document.getElementById("form-compra");
    formCompra.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!usuarioLogado) {
            Swal.fire({
                icon: 'warning',
                title: 'Login Necessário',
                text: 'Você precisa fazer login para adicionar itens ao carrinho.',
                confirmButtonText: 'Ir para Login'
            }).then(() => window.location.href = 'login.html');
            return;
        }

        const formData = new FormData(formCompra);
        const tamanho = formData.get('tamanho') || formData.get('lateralidade');
        const quantidade = parseInt(document.getElementById('qtd-produto').value);

        if (!tamanho) {
            Swal.fire('Atenção', 'Por favor, selecione um tamanho ou lateralidade.', 'warning');
            return;
        }

        Swal.fire({ title: "Adicionando...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            const carrinhoRef = doc(db, "carrinhos", usuarioLogado.uid);
            const carrinhoSnap = await getDoc(carrinhoRef);
            let itensAtuais = [];

            if (carrinhoSnap.exists()) {
                itensAtuais = carrinhoSnap.data().produtos || [];
            }

            itensAtuais.push({
                nome: `${produtoAtual.nome} (${tamanho})`,
                preco: produtoAtual.valor,
                quantidade: quantidade
            });

            await setDoc(carrinhoRef, { produtos: itensAtuais }, { merge: true });

            Swal.fire('Sucesso!', 'Produto adicionado ao carrinho.', 'success').then(() => {
                window.location.href = 'carrinho.html';
            });
        } catch (error) {
            console.error("Erro ao adicionar ao carrinho:", error);
            Swal.fire('Erro', 'Não foi possível adicionar o produto ao carrinho.', 'error');
        }
    });

    carregarProduto();
});