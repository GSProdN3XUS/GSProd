// js/main.js
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db } from "./fireconfig.js";

const auth = getAuth();

document.addEventListener("DOMContentLoaded", function() {
    // Controla o menu hambúrguer (Categorias)
    const btnCategorias = document.getElementById("btn-categorias");
    const dropdownCategorias = document.getElementById("dropdown-categorias");

    if (btnCategorias && dropdownCategorias) {
        btnCategorias.addEventListener("click", function(e) {
            e.stopPropagation(); 
            dropdownCategorias.classList.toggle("active-dropdown");
        });

        document.addEventListener("click", function(event) {
            if (!btnCategorias.contains(event.target)) {
                dropdownCategorias.classList.remove("active-dropdown");
            }
        });
    }

    onAuthStateChanged(auth, async (user) => {
        const btnUsuarioTopo = document.getElementById("btn-usuario-topo");
        const modalPerfil = document.getElementById("modal-perfil");
        const fecharModal = document.getElementById("fechar-modal");
        const btnLogout = document.getElementById("btn-logout");
        const btnAdmin = modalPerfil ? modalPerfil.querySelector("a[href='admin.html']") : null;

        if (user) {
            await atualizarContadorCarrinhoFirestore(user.uid);
            alterarNomeUsuarioTopo(user, btnUsuarioTopo);

            btnUsuarioTopo.onclick = function(e) {
                e.preventDefault();
                if (modalPerfil) modalPerfil.style.display = "flex";
            };

            // Oculta o botão de admin se não for o usuário correto
            if (btnAdmin) {
                btnAdmin.style.display = user.email === "admin@admin.com" ? "flex" : "none";
            }

            if (fecharModal) {
                fecharModal.onclick = function() {
                    if (modalPerfil) modalPerfil.style.display = "none";
                };
            }

            window.onclick = function(event) {
                if (event.target === modalPerfil) {
                    modalPerfil.style.display = "none";
                }
            };

            if (btnLogout) {
                btnLogout.onclick = async function(e) {
                    e.preventDefault();
                    try {
                        await signOut(auth);
                        restaurarNomeUsuarioTopo(btnUsuarioTopo);
                        history.pushState(null, null, 'index.html');
                        window.location.replace('index.html');
                    } catch (error) {
                        console.error("Erro ao fazer logout:", error);
                    }
                };
            }

        } else {
            zerarContadorCarrinho();
            restaurarNomeUsuarioTopo(btnUsuarioTopo);
            
            if (modalPerfil) modalPerfil.style.display = "none";
            
            btnUsuarioTopo.onclick = function(e) {
                window.location.href = "login.html";
            };
        }
    });

    const carrinhoLinks = document.querySelectorAll("#carrinho-topo, a[href='carrinho.html']");
    carrinhoLinks.forEach(link => {
        link.addEventListener("click", function(event) {
            event.preventDefault(); 
            irParaCarrinho();       
        });
    });
});

window.irParaCarrinho = function() {
    const user = auth.currentUser;

    if (!user) {
        window.location.href = "login.html";
    } else {
        window.location.href = "carrinho.html";
    }
};

// Função chamada pelo botão verde: compra direta que salva no banco e redireciona
window.comprarAgora = async function(produto) {
    const user = auth.currentUser;
    
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    try {
        const carrinhoRef = doc(db, "carrinhos", user.uid);
        const docSnap = await getDoc(carrinhoRef);
        
        let itensCarrinho = [];
        if (docSnap.exists() && docSnap.data().produtos) {
            itensCarrinho = docSnap.data().produtos;
        }
        
        itensCarrinho.push({
            produtoId: produto.id, // Mantido para clareza, já estava correto
            nome: produto.nome,
            preco: produto.preco,
            codigo: produto.codigo,
            tamanho: 'Único',
            quantidade: 1
        });
        
        await setDoc(carrinhoRef, {
            usuarioId: user.uid,
            produtos: itensCarrinho,
            atualizadoEm: new Date().toISOString()
        });

        window.location.href = "carrinho.html";
        
    } catch (error) {
        console.error("Erro ao processar compra:", error);
    }
};

// Função chamada pelo botão amarelo: animação visual e incremento/salvamento síncrono
window.adicionarComAnimacao = async function(produto, botaoElemento) {
    const user = auth.currentUser;
    
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    // ANIMAÇÃO VISUAL: Clone da imagem do card indo até o ícone do carrinho no topo
    const card = botaoElemento.closest('.produto-card');
    const imgElement = card.querySelector('.produto-imagem-baia img');
    const carrinhoTopo = document.getElementById("carrinho-topo");

    if (imgElement && carrinhoTopo) {
        const imgClone = imgElement.cloneNode(true);
        imgClone.style.position = 'fixed';
        imgClone.style.zIndex = '10000';
        imgClone.style.width = '50px';
        imgClone.style.height = '50px';
        imgClone.style.borderRadius = '50%';
        imgClone.style.objectFit = 'cover';
        
        const imgRect = imgElement.getBoundingClientRect();
        imgClone.style.left = `${imgRect.left}px`;
        imgClone.style.top = `${imgRect.top}px`;
        
        document.body.appendChild(imgClone);

        const cartRect = carrinhoTopo.getBoundingClientRect();
        
        imgClone.animate([
            { transform: 'scale(1)', left: `${imgRect.left}px`, top: `${imgRect.top}px`, opacity: 1 },
            { transform: 'scale(0.2)', left: `${cartRect.left + 20}px`, top: `${cartRect.top + 10}px`, opacity: 0 }
        ], {
            duration: 800,
            easing: 'cubic-bezier(0.25, 1, 0.5, 1)'
        }).onfinish = () => imgClone.remove();
    }

    // ARMAZENAMENTO: Salva no Firestore mantendo o histórico de produtos para a tela carrinho.html
    try {
        const carrinhoRef = doc(db, "carrinhos", user.uid);
        const docSnap = await getDoc(carrinhoRef);
        
        let itensCarrinho = [];
        if (docSnap.exists() && docSnap.data().produtos) {
            itensCarrinho = docSnap.data().produtos;
        }
        
        itensCarrinho.push({
            produtoId: produto.id, // Mantido para clareza, já estava correto
            nome: produto.nome,
            preco: produto.preco,
            codigo: produto.codigo,
            tamanho: 'Único',
            quantidade: 1
        });
        
        await setDoc(carrinhoRef, {
            usuarioId: user.uid,
            produtos: itensCarrinho,
            atualizadoEm: new Date().toISOString()
        });

        // Atualiza o contador (X para X + 1) no cabeçalho visualmente em tempo real
        let elementosCarrinho = document.querySelectorAll("#carrinho-topo, a[href='carrinho.html']");
        elementosCarrinho.forEach(el => {
            if (el.textContent.includes("Carrinho")) {
                el.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Carrinho (${itensCarrinho.length})`;
            }
        });

    } catch (error) {
        console.error("Erro ao adicionar produto ao carrinho:", error);
    }
};

async function atualizarContadorCarrinhoFirestore(userId) {
    try {
        const carrinhoRef = doc(db, "carrinhos", userId);
        const docSnap = await getDoc(carrinhoRef);
        
        let totalItens = 0;
        if (docSnap.exists() && docSnap.data().produtos) {
            totalItens = docSnap.data().produtos.length;
        }
        
        let elementosCarrinho = document.querySelectorAll(".botoes-usuario-topo a, .links-menu a");
        
        elementosCarrinho.forEach(el => {
            if (el.textContent.includes("Carrinho")) {
                el.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Carrinho (${totalItens})`;
            }
        });
    } catch (error) {
        console.error("Erro ao sincronizar quantidade do carrinho:", error);
    }
}

function zerarContadorCarrinho() {
    let elementosCarrinho = document.querySelectorAll(".botoes-usuario-topo a, .links-menu a");
    elementosCarrinho.forEach(el => {
        if (el.textContent.includes("Carrinho")) {
            el.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Carrinho (0)`;
        }
    });
}

function alterarNomeUsuarioTopo(user, linkMinhaConta) {
    if (linkMinhaConta) {
        let nomeExibicao = user.displayName || user.email.split('@')[0];
        
        if (nomeExibicao) {
            nomeExibicao = nomeExibicao.charAt(0).toUpperCase() + nomeExibicao.slice(1);
        }

        linkMinhaConta.innerHTML = `<i class="fa-regular fa-user"></i> <strong>${nomeExibicao}</strong>`;
    }
}

function restaurarNomeUsuarioTopo(linkMinhaConta) {
    if (linkMinhaConta) {
        linkMinhaConta.innerHTML = `<i class="fa-regular fa-user"></i> Minha conta`;
    }
}