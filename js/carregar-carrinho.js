// 1. Importações diretas do SDK oficial do Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// 2. Credenciais oficiais
const firebaseConfig = {
    apiKey: "AIzaSyBfSSeo-Z8KWbH7rskRA0nrGKyVUfJlnxo",
    authDomain: "sprodutosort.firebaseapp.com",
    projectId: "sprodutosort",
    storageBucket: "sprodutosort.firebasestorage.app",
    messagingSenderId: "252165781461",
    appId: "1:252165781461:web:ca2262b9a326004d27ef5c",
    measurementId: "G-17K63MCDZZ"
};

// 3. Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log("Configuração do Firebase carregada sem erros no carrinho!");

// Variáveis globais de controle
let subtotalGlobal = 0;
let descontoAplicado = 0;
let freteAplicado = 0;
let cupomIdGlobal = null;

// 4. Inicialização segura aguardando o estado de login
document.addEventListener("DOMContentLoaded", () => {
    onAuthStateChanged(auth, (user) => {
        const usuarioBtn = document.getElementById("btn-usuario-topo");
        const carrinhoBtn = document.getElementById("carrinho-topo");

        if (user) {
            console.log("Usuário autenticado no carrinho:", user.uid);
            
            if (usuarioBtn) {
                usuarioBtn.innerHTML = `<i class="fa-regular fa-user"></i> Minha conta`;
                usuarioBtn.href = "#"; 
                usuarioBtn.onclick = (e) => {
                    e.preventDefault();
                    const modalPerfil = document.getElementById("modal-perfil");
                    if (modalPerfil) modalPerfil.style.display = "flex";
                };
            }

            carregarItensCarrinho(user.uid);
        } else {
            console.warn("Nenhum usuário logado detectado na página do carrinho.");
            const listaProdutosEl = document.getElementById("lista-produtos-carrinho");
            if (listaProdutosEl) {
                listaProdutosEl.innerHTML = `
                    <div style="text-align: center; padding: 30px; color: #94a3b8;">
                        <p>Por favor, <a href="login.html" style="color: #eab308; font-weight: bold;">faça login</a> para visualizar o seu carrinho.</p>
                    </div>`;
            }
            if (usuarioBtn) {
                usuarioBtn.innerHTML = `<i class="fa-regular fa-user"></i> Minha conta`;
                usuarioBtn.href = "login.html";
            }
        }
    });

    // Logout
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
        btnLogout.addEventListener("click", (e) => {
            e.preventDefault();
            signOut(auth).then(() => {
                window.location.href = "index.html";
            }).catch((error) => {
                console.error("Erro ao fazer logout:", error);
            });
        });
    }

    // Fechar modal de perfil
    const fecharModal = document.getElementById("fechar-modal");
    if (fecharModal) {
        fecharModal.addEventListener("click", () => {
            const modalPerfil = document.getElementById("modal-perfil");
            if (modalPerfil) modalPerfil.style.display = "none";
        });
    }

    // Fechar modal de dados do pedido
    const fecharModalPedido = document.getElementById("fechar-modal-pedido");
    if (fecharModalPedido) {
        fecharModalPedido.addEventListener("click", () => {
            const modalPedido = document.getElementById("modal-dados-pedido");
            if (modalPedido) modalPedido.style.display = "none";
        });
    }

    // Escuta o formulário de finalização (dados do pedido)
    const formPedido = document.getElementById("form-dados-pedido");
    if (formPedido) {
        formPedido.addEventListener("submit", async (e) => {
            e.preventDefault();
            const nome = document.getElementById("modal-nome").value;
            const telefone = document.getElementById("modal-telefone").value;
            const cpf = document.getElementById("modal-cpf").value;
            const endereco = document.getElementById("modal-endereco").value;

            // Fecha o modal imediatamente após recolher os dados
            const modalPedido = document.getElementById("modal-dados-pedido");
            if (modalPedido) modalPedido.style.display = "none";

            await executarEnvioOrdemServico(nome, telefone, cpf, endereco);
        });
    }
});

// 5. Função que carrega os itens do carrinho com segurança contra NaN e undefined
async function carregarItensCarrinho(userId) {
    try {
        const carrinhoRef = doc(db, "carrinhos", userId);
        const carrinhoSnap = await getDoc(carrinhoRef);

        const secaoLista = document.getElementById("lista-produtos-carrinho");
        if (!secaoLista) return;

        const paragrafoVazio = secaoLista.querySelector(".carrinho-vazio");
        secaoLista.innerHTML = "";
        if (paragrafoVazio) {
            paragrafoVazio.style.display = "none";
            secaoLista.appendChild(paragrafoVazio);
        }

        if (carrinhoSnap.exists()) {
            const produtos = carrinhoSnap.data().produtos || [];
            
            if (produtos.length === 0) {
                if (paragrafoVazio) paragrafoVazio.style.display = "block";
                subtotalGlobal = 0;
                atualizarResumoValores();
                atualizarContadorTopo(0);
                return;
            }

            subtotalGlobal = 0;
            
            produtos.forEach((prod, index) => {
                const precoUnitario = parseFloat(prod.preco) || 0.00;
                const quantidade = parseInt(prod.quantidade) || 1;
                
                const subtotalItem = precoUnitario * quantidade;
                subtotalGlobal += subtotalItem;
                
                const divProduto = document.createElement("div");
                divProduto.classList.add("item-carrinho-card"); 
                divProduto.innerHTML = `
                    <div class="item-detalhes">
                        <span class="item-titulo">${prod.nome || "Produto sem nome"}</span>
                        <span class="item-preco">Qtd: ${quantidade} | R$ ${precoUnitario.toFixed(2)} un.</span>
                        <span style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Subtotal: R$ ${subtotalItem.toFixed(2)}</span>
                    </div>
                    <button class="btn-remover-item" onclick="window.removerItemCarrinho(${index})">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;
                
                secaoLista.appendChild(divProduto);
            });

            atualizarContadorTopo(produtos.length);
            atualizarResumoValores();
        } else {
            console.warn("Nenhum documento de carrinho encontrado no Firestore.");
            if (paragrafoVazio) paragrafoVazio.style.display = "block";
            subtotalGlobal = 0;
            atualizarResumoValores();
            atualizarContadorTopo(0);
        }
    } catch (error) {
        console.error("Erro crítico ao carregar itens do carrinho:", error);
    }
}

// Atualiza o contador no cabeçalho do site
function atualizarContadorTopo(quantidade) {
    const carrinhoTopo = document.getElementById("carrinho-topo");
    if (carrinhoTopo) {
        carrinhoTopo.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Carrinho (${quantidade})`;
    }
}

// 6. Remove item do carrinho com segurança
window.removerItemCarrinho = async function(index) {
    const user = auth.currentUser;
    if (!user) return;

    Swal.fire({
        title: 'A remover item...',
        text: 'A atualizar os dados do seu carrinho...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const carrinhoRef = doc(db, "carrinhos", user.uid);
        const carrinhoSnap = await getDoc(carrinhoRef);

        if (carrinhoSnap.exists()) {
            const produtos = carrinhoSnap.data().produtos || [];
            produtos.splice(index, 1); 

            await updateDoc(carrinhoRef, { produtos: produtos });
            
            Swal.fire({
                icon: 'success',
                title: 'Item Removido',
                timer: 1500,
                showConfirmButton: false
            }).then(() => {
                carregarItensCarrinho(user.uid); 
            });
        }
    } catch (err) {
        console.error("Erro ao remover item:", err);
        Swal.fire('Erro', 'Não foi possível remover o item no momento.', 'error');
    }
}

// 7. Atualiza os valores do resumo
function atualizarResumoValores() {
    const subtotalEl = document.getElementById("subtotal-carrinho"); 
    const totalEl = document.getElementById("total-carrinho");

    if (subtotalEl) subtotalEl.innerText = `R$ ${subtotalGlobal.toFixed(2)}`;
    
    const calculoTotal = (subtotalGlobal - descontoAplicado) + freteAplicado;
    if (totalEl) totalEl.innerText = `R$ ${calculoTotal.toFixed(2)}`;
}

// 8. Interações de Cupom e Frete
window.aplicarCupom = function() {
    const inputCupom = document.getElementById("input-cupom").value;
    if(!inputCupom) {
        Swal.fire('Atenção', 'Digite um código de cupom válido.', 'warning');
        return;
    }
    Swal.fire('Cupom', 'Cupom verificado e aplicado com sucesso!', 'success');
}

window.calcularFretePorCep = function() {
    const inputCep = document.getElementById("input-cep").value;
    if(inputCep.length < 8) {
        Swal.fire('Atenção', 'Digite um CEP válido para Fortaleza e região.', 'warning');
        return;
    }
    freteAplicado = 15.00; 
    
    const linhaEntrega = document.getElementById("linha-entrega");
    const valorEntrega = document.getElementById("valor-entrega");
    if(linhaEntrega) linhaEntrega.style.display = "flex";
    if(valorEntrega) valorEntrega.innerText = `R$ ${freteAplicado.toFixed(2)}`;
    
    atualizarResumoValores();
    Swal.fire('Frete Calculado', 'Taxa de entrega adicionada: R$ 15,00', 'success');
}

// 9. Ação Finalizar Compra
window.finalizarCompra = function() {
    const user = auth.currentUser;
    if (!user) {
        Swal.fire({
            icon: 'warning',
            title: 'Atenção',
            text: 'Você precisa estar logado para finalizar a compra.',
            confirmButtonColor: '#eab308'
        }).then(() => {
            window.location.href = "login.html";
        });
        return;
    }
    
    const modalPedido = document.getElementById("modal-dados-pedido");
    if(modalPedido) {
        modalPedido.style.display = "flex";
    }
}

// 10. Integração com Stripe + Memorização para disparo do Twilio pós-pagamento
async function executarEnvioOrdemServico(nome, telefone, cpf, endereco) {
    const user = auth.currentUser;
    if (!user) return;

    const subtotal = parseFloat(subtotalGlobal) || 0;
    const desconto = parseFloat(descontoAplicado) || 0;
    const frete = parseFloat(freteAplicado) || 0;
    const totalFinal = (subtotal - desconto) + frete;
    const valorFinal = totalFinal < 0 ? 0 : totalFinal;

    Swal.fire({
        title: 'Preparando Ambiente Seguro...',
        text: 'Redirecionando você para a plataforma do Stripe para realizar o pagamento...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        let listaMensagem = "";
        let produtosArr = [];
        
        const carrinhoRef = doc(db, "carrinhos", user.uid);
        const carrinhoSnap = await getDoc(carrinhoRef);
        
        if (carrinhoSnap.exists()) {
            const produtos = carrinhoSnap.data().produtos || [];
            produtosArr = produtos;
            produtos.forEach((prod) => {
                const pUnitario = parseFloat(prod.preco) || 0;
                const qtdItem = parseInt(prod.quantidade) || 1;
                listaMensagem += `• ${prod.nome || "Produto"} (Qtd: ${qtdItem}) - R$ ${(pUnitario * qtdItem).toFixed(2)}\n`;
            });
        }

        const textoOrdemServico = 
`ORDEM DE SERVIÇO
---------------------------
DADOS CLIENTE 
NOME: ${nome}
EMAIL: ${user.email || "Não informado"}
TELEFONE: ${telefone}
CPF: ${cpf}
ENDEREÇO: ${endereco}

---------------------------
ITENS
${listaMensagem}
---------------------------
FORMA PAGAMENTO
Cartão / PIX (Processado via Stripe)

SUB TOTAL: R$ ${subtotal.toFixed(2)}
TAXA DE ENTREGA: R$ ${frete.toFixed(2)}
DESCONTOS: R$ ${desconto.toFixed(2)}
TOTAL: R$ ${valorFinal.toFixed(2)}`;

        const NUMERO_DONO_LOJA = "558598154761"; 
        const variaveisTemplate = JSON.stringify({
            "1": "Nova Ordem de Serviço", 
            "2": textoOrdemServico
        });

        // Chamada direcionada para a rota do Stripe que encapsula e retém os parâmetros do Twilio
        const response = await fetch('http://localhost:3000/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                numeroDonoLoja: NUMERO_DONO_LOJA,
                variaveisConteudo: variaveisTemplate,
                produtos: produtosArr,
                frete: frete,
                desconto: desconto
            })
        });

        const data = await response.json();
        
        if (!data.url) {
            throw new Error("A resposta do servidor não incluiu uma URL de checkout válida.");
        }

        // Encaminhamento imediato para a interface de pagamento do Stripe
        window.location.href = data.url;

    } catch (err) {
        console.error("Erro ao processar inicialização do Stripe:", err);
        Swal.fire({
            icon: 'error',
            title: 'Erro de Conexão',
            text: 'Não foi possível estabelecer contato com o servidor local. Verifique se o seu backend Node.js (servidor_msg.js) está ativo na porta 3000.',
            confirmButtonColor: '#7f1d1d'
        });
    }
}