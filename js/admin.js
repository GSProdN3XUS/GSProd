// Importações
import { db } from "./fireconfig.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { criarCupomPDF } from "./nota-fiscal.js";

const auth = getAuth();

// Proteção da Página: Redireciona para o login se não estiver logado
onAuthStateChanged(auth, (user) => {
    // CORREÇÃO DE SEGURANÇA: Só permite acesso se for o usuário admin
    if (!user || user.email !== "admin@admin.com") {
        window.location.href = "index.html";
    }
});

// ==========================================
// FUNÇÃO GLOBAL DE GERAR PDF DA NOTA
// (Deve ficar fora do DOMContentLoaded para poder ser chamada no onclick do HTML)
// ==========================================
window.gerarNotaPDF = async (vendaCodificada) => {
    try {
        const venda = JSON.parse(decodeURIComponent(vendaCodificada));
        const pdfBase64 = await criarCupomPDF(venda, auth.currentUser);
        const blob = await fetch(`data:application/pdf;base64,${pdfBase64}`).then((res) => res.blob());
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `Cupom_Venda_${venda.vendaId || "pedido"}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Erro ao gerar o cupom fiscal:", error);
        Swal.fire({ icon: "error", title: "Erro", text: "Não foi possível gerar o cupom fiscal." });
    }
};

/**
 * AÇÃO GLOBAL: DELETAR VENDA E ESTORNAR ESTOQUE
 * Esta função é chamada pelo botão 'Excluir' na tabela de histórico de vendas.
 * @param {string} vendaId - O ID do documento da venda a ser excluída.
 */
window.deletarVenda = async (vendaId) => {
    if (!vendaId) return;

    const { isConfirmed } = await Swal.fire({
        title: 'Confirmar Exclusão',
        text: "Esta ação irá remover o registro da venda e devolver os itens ao estoque. Deseja continuar?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ffcc00',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Sim, excluir!',
        cancelButtonText: 'Cancelar'
    });

    if (isConfirmed) {
        Swal.fire({ title: "Excluindo...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            const vendaRef = doc(db, "vendas", vendaId);
            const vendaSnap = await getDoc(vendaRef);

            if (!vendaSnap.exists()) {
                throw new Error("Venda não encontrada no banco de dados.");
            }

            const vendaData = vendaSnap.data();
            const itensParaRestaurar = Array.isArray(vendaData.itens) && vendaData.itens.length > 0
                ? vendaData.itens
                : [{ produtoId: vendaData.produtoId, tamanho: vendaData.tamanho, quantidade: vendaData.quantidade }];

            for (const item of itensParaRestaurar) {
                const produtoId = item.produtoId || vendaData.produtoId;
                const tamanho = item.tamanho || vendaData.tamanho;
                const quantidade = parseInt(item.quantidade || 0, 10);
                if (!produtoId || !tamanho || quantidade <= 0) continue;

                const produtoRef = doc(db, "produtos", produtoId);
                const produtoSnap = await getDoc(produtoRef);
                if (produtoSnap.exists()) {
                    const produtoData = produtoSnap.data();
                    const novaGrade = { ...(produtoData.grade || {}) };
                    novaGrade[tamanho] = (novaGrade[tamanho] || 0) + quantidade;
                    await updateDoc(produtoRef, { grade: novaGrade });
                } else {
                    console.warn(`Produto com ID ${produtoId} não encontrado. O estoque não foi estornado, mas a venda será deletada.`);
                }
            }

            await deleteDoc(vendaRef);

            Swal.fire('Sucesso!', 'A venda foi excluída e o estoque atualizado.', 'success');
            puxarHistoricoVendas();
        } catch (error) {
            console.error("Erro ao deletar venda:", error);
            Swal.fire('Erro!', 'Não foi possível completar a exclusão. Verifique o console para mais detalhes.', 'error');
        }
    }
};

async function puxarHistoricoVendas() {
    const corpoTabelaVendas = document.getElementById("tabela-historico-vendas-corpo");
    if (!corpoTabelaVendas) return;

    try {
        const querySnapshot = await getDocs(collection(db, "vendas"));
        corpoTabelaVendas.innerHTML = "";

        if (querySnapshot.empty) {
            corpoTabelaVendas.innerHTML = `<tr><td colspan="6" class="has-text-centered has-text-grey">Nenhuma venda registrada ainda.</td></tr>`;
            return;
        }

        const listaVendas = [];
        querySnapshot.forEach((docSnap) => {
            listaVendas.push({ id: docSnap.id, ...docSnap.data() });
        });

        listaVendas.sort((a, b) => {
            const dataA = a.dataVenda?.seconds || 0;
            const dataB = b.dataVenda?.seconds || 0;
            return dataB - dataA;
        });

        const termoBusca = (document.getElementById("busca-venda-codigo")?.value || "").trim().toLowerCase();
        const vendasExibidas = listaVendas.filter((venda) => {
            if (!termoBusca) return true;
            const codigo = String(venda.vendaId || "").toLowerCase();
            const cliente = String(venda.clienteNome || venda.clienteEmail || "").toLowerCase();
            return codigo.includes(termoBusca) || cliente.includes(termoBusca);
        });

        if (vendasExibidas.length === 0) {
            corpoTabelaVendas.innerHTML = `<tr><td colspan="6" class="has-text-centered has-text-grey">Nenhuma venda encontrada para o termo informado.</td></tr>`;
            return;
        }

        vendasExibidas.forEach((venda) => {
            const linha = document.createElement("tr");
            const vendaJSON = encodeURIComponent(JSON.stringify(venda));
            const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
                ? venda.itens
                : [{ nome: venda.produtoNome || 'Produto', tamanho: venda.tamanho || '---', quantidade: venda.quantidade || 1 }];

            const resumoItens = itensVenda.map((item) => `<span>${item.nome || 'Produto'}${item.tamanho ? ` (${item.tamanho})` : ''} · Qtd: ${item.quantidade || 1}</span>`).join('');
            const quantidadeTotal = itensVenda.reduce((total, item) => total + (parseInt(item.quantidade, 10) || 0), 0);
            const origem = String(venda.origem || 'ex-site').toLowerCase();
            const tagStatus = origem === 'site'
                ? '<span class="tag is-info" style="background:#2563eb;color:white;">site</span>'
                : '<span class="tag is-link" style="background:#8b5cf6;color:white;">ex-site</span>';

            linha.innerHTML = `
                <td><span class="has-text-weight-bold has-text-info">${venda.vendaId || '------'}</span></td>
                <td><div class="item-venda-lista">${resumoItens}</div></td>
                <td>${tagStatus}</td>
                <td>${quantidadeTotal}</td>
                <td class="has-text-success">${(venda.valorTotal || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                <td class="has-text-centered">
                    <button class="button is-small is-warning is-light" onclick="gerarNotaPDF('${vendaJSON}')">
                        <i class="fas fa-file-invoice mr-1"></i> Nota
                    </button>
                    <button class="button is-small is-danger is-light ml-1" onclick="window.deletarVenda('${venda.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            corpoTabelaVendas.appendChild(linha);
        });
    } catch (e) {
        console.error("Erro ao carregar histórico:", e);
    }
}

async function puxarUsuariosAdmin() {
    const corpoTabela = document.getElementById("tabela-usuarios-corpo");
    const buscaUsuario = document.getElementById("busca-usuario-admin");
    if (!corpoTabela) return;

    try {
        const querySnapshot = await getDocs(collection(db, "usuarios"));
        const usuarios = [];
        querySnapshot.forEach((docSnap) => {
            usuarios.push({ id: docSnap.id, ...docSnap.data() });
        });

        const termoBusca = (buscaUsuario?.value || "").trim().toLowerCase();
        const exibidos = usuarios.filter((usuario) => {
            if (!termoBusca) return true;
            return (
                String(usuario.nome || "").toLowerCase().includes(termoBusca) ||
                String(usuario.email || "").toLowerCase().includes(termoBusca)
            );
        });

        if (exibidos.length === 0) {
            corpoTabela.innerHTML = `<tr><td colspan="5" class="has-text-centered has-text-grey">Nenhum usuário encontrado.</td></tr>`;
            return;
        }

        corpoTabela.innerHTML = "";
        exibidos.forEach((usuario) => {
            const linha = document.createElement("tr");
            linha.innerHTML = `
                <td>${usuario.nome || "---"}</td>
                <td>${usuario.email || "---"}</td>
                <td>${usuario.telefone || "---"}</td>
                <td>${usuario.cpf || "---"}</td>
                <td class="has-text-centered">
                    <button class="button is-small is-danger is-light" onclick="window.excluirUsuario('${usuario.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                    <button class="button is-small is-info is-light ml-1" onclick="window.enviarLinkRedefinicao('${usuario.email}')">
                        <i class="fas fa-envelope"></i>
                    </button>
                </td>
            `;
            corpoTabela.appendChild(linha);
        });
    } catch (e) {
        console.error("Erro ao carregar usuários:", e);
        corpoTabela.innerHTML = `<tr><td colspan="5" class="has-text-centered has-text-grey">Erro ao carregar usuários.</td></tr>`;
    }
}

window.excluirUsuario = async (uid) => {
    if (!uid) return;

    const { isConfirmed } = await Swal.fire({
        title: 'Excluir usuário?',
        text: 'Isso removerá a conta de autenticação e o registro do usuário.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff3860',
        cancelButtonColor: '#4a4a4a',
        confirmButtonText: 'Sim, excluir',
        cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) return;

    try {
        const response = await fetch('http://localhost:3000/admin/delete-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid }),
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao excluir usuário.');
        }

        Swal.fire('Excluído', 'O usuário foi removido com sucesso.', 'success');
        puxarUsuariosAdmin();
    } catch (error) {
        console.error(error);
        Swal.fire('Erro', 'Não foi possível excluir o usuário.', 'error');
    }
};

window.enviarLinkRedefinicao = async (email) => {
    if (!email) return;

    try {
        const response = await fetch('http://localhost:3000/admin/send-password-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao enviar link.');
        }

        Swal.fire('Enviado', 'O link de redefinição de senha foi enviado.', 'success');
    } catch (error) {
        console.error(error);
        Swal.fire('Erro', 'Não foi possível enviar o link de redefinição.', 'error');
    }
};

document.addEventListener("DOMContentLoaded", async () => {
    // Variáveis globais
    let localEstoque = [];
    let localCupons = [];
    let ordemEstoqueAtual = "codigo-crescente";

    // Carga inicial
    carregarDadosDashboard();

    /* ==========================================================
       0. CORREÇÃO: ABERTURA DO MODAL DE CUPONS
    ========================================================== */
    const btnAbrirModal = document.getElementById("btn-abrir-modal-cupom");
    const modalCupom = document.getElementById("modal-cupom");
    const btnFecharModal = document.getElementById("btn-fechar-modal-cupom-btn");

    if (btnAbrirModal) {
        btnAbrirModal.addEventListener("click", () => {
            modalCupom.classList.add("is-active");
        });
    }

    if (btnFecharModal) {
        btnFecharModal.addEventListener("click", () => {
            modalCupom.classList.remove("is-active");
        });
    }

    /* ==========================================================
       1. LOGOUT
    ========================================================== */
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
        btnLogout.addEventListener("click", async (e) => {
            e.preventDefault();
            try {
                await signOut(auth);
                window.location.href = "index.html";
            } catch (error) {
                console.error("Erro ao sair:", error);
                Swal.fire({ icon: "error", title: "Erro", text: "Não foi possível sair." });
            }
        });
    }

    /* ==========================================================
       2. ALTERNAÇÃO DE ABAS
    ========================================================== */
    const linksMenu = document.querySelectorAll("#sidebar-menu a");
    const todasAbas = document.querySelectorAll(".aba-conteudo");

    linksMenu.forEach((link) => {
        link.addEventListener("click", (e) => {
            // Ignora a lógica de abas se for o botão de sair
            if (link.id === "btn-logout") return;

            e.preventDefault();
            linksMenu.forEach((l) => l.classList.remove("is-active"));
            link.classList.add("is-active");
            todasAbas.forEach((aba) => aba.classList.add("is-hidden"));

            const idAbaAlvo = link.getAttribute("data-target");
            const abaAlvo = document.getElementById(idAbaAlvo);
            
            if (abaAlvo) {
                abaAlvo.classList.remove("is-hidden");

                if (idAbaAlvo === "aba-dashboard") {
                    carregarDadosDashboard();
                } else if (idAbaAlvo === "aba-estoque") {
                    puxarEstoqueDoFirebase();
                } else if (idAbaAlvo === "aba-cupons") {
                    puxarCuponsDoFirebase();
                } else if (idAbaAlvo === "aba-vendas") {
                    puxarProdutosParaVenda();
                    puxarHistoricoVendas();
                } else if (idAbaAlvo === "aba-usuarios") {
                    puxarUsuariosAdmin();
                }
                // CORREÇÃO: Adicionado para garantir que a aba de cadastro também seja reexibida
                // Nenhuma função de carregamento é necessária aqui, apenas mostrar a aba.
            }
        });
    });

    /* ==========================================================
       3. ABA DE VENDAS E HISTÓRICO
    ========================================================== */
    const formVendaDireta = document.getElementById("form-registrar-venda");
    const selectVendaProduto = document.getElementById("venda-produto");
    const selectVendaTamanho = document.getElementById("venda-tamanho");
    const inputVendaQtd = document.getElementById("venda-quantidade");
    
    // Variáveis locais para controle
    let produtoSelecionadoLocal = null;
    let estoqueMaximoSelecionado = 0;
    const inputBuscaVendas = document.getElementById("busca-venda-codigo");

    if (inputBuscaVendas) {
        inputBuscaVendas.addEventListener("input", () => {
            puxarHistoricoVendas();
        });
    }

    const inputBuscaUsuarios = document.getElementById("busca-usuario-admin");
    if (inputBuscaUsuarios) {
        inputBuscaUsuarios.addEventListener("input", () => {
            puxarUsuariosAdmin();
        });
    }

    async function puxarProdutosParaVenda() {
        if (!selectVendaProduto) return;
        selectVendaProduto.innerHTML = `<option value="" disabled selected>Carregando produtos...</option>`;
        selectVendaTamanho.disabled = true;
        selectVendaTamanho.innerHTML = `<option value="" disabled selected>Selecione o produto...</option>`;
        inputVendaQtd.disabled = true;

        try {
            const querySnapshot = await getDocs(collection(db, "produtos"));
            localEstoque = [];
            selectVendaProduto.innerHTML = `<option value="" disabled selected>Selecione o produto...</option>`;

            querySnapshot.forEach((docSnap) => {
                const prod = { id: docSnap.id, ...docSnap.data() };
                localEstoque.push(prod);

                let temEstoque = Object.values(prod.grade).some((qtd) => qtd > 0);
                if (temEstoque) {
                    selectVendaProduto.innerHTML += `<option value="${prod.id}">${prod.nome} (${prod.codigo})</option>`;
                }
            });
        } catch (e) {
            selectVendaProduto.innerHTML = `<option value="" disabled>Erro ao carregar estoque</option>`;
        }
    }

    if (selectVendaProduto) {
        selectVendaProduto.addEventListener("change", (e) => {
            const idProd = e.target.value;
            produtoSelecionadoLocal = localEstoque.find((p) => p.id === idProd);

            if (produtoSelecionadoLocal) {
                selectVendaTamanho.innerHTML = `<option value="" disabled selected>Escolha o tamanho...</option>`;
                selectVendaTamanho.disabled = false;

                for (const tam in produtoSelecionadoLocal.grade) {
                    const qtdDisponivel = produtoSelecionadoLocal.grade[tam];
                    if (qtdDisponivel > 0) {
                        selectVendaTamanho.innerHTML += `<option value="${tam}">${tam} (${qtdDisponivel} un)</option>`;
                    }
                }
                inputVendaQtd.disabled = true;
                inputVendaQtd.value = 1;
            }
        });
    }

    if (selectVendaTamanho) {
        selectVendaTamanho.addEventListener("change", (e) => {
            const tamanho = e.target.value;
            if (produtoSelecionadoLocal && tamanho) {
                estoqueMaximoSelecionado = produtoSelecionadoLocal.grade[tamanho];
                inputVendaQtd.disabled = false;
                inputVendaQtd.max = estoqueMaximoSelecionado;
                inputVendaQtd.value = 1;
            }
        });
    }

    if (inputVendaQtd) {
        inputVendaQtd.addEventListener("input", () => {
            let qtdInput = parseInt(inputVendaQtd.value) || 0;
            if (qtdInput > estoqueMaximoSelecionado) {
                inputVendaQtd.value = estoqueMaximoSelecionado;
            } else if (qtdInput < 1) {
                inputVendaQtd.value = 1;
            }
        });
    }

    if (formVendaDireta) {
        formVendaDireta.addEventListener("submit", async (e) => {
            e.preventDefault();

            const tamanhoEscolhido = selectVendaTamanho.value;
            const qtdVendida = parseInt(inputVendaQtd.value, 10) || 0;
            const valorUnitario = Number(produtoSelecionadoLocal?.valor || 0);
            const valorTotalVenda = valorUnitario * qtdVendida;

            if (!produtoSelecionadoLocal || !tamanhoEscolhido || qtdVendida <= 0 || !Number.isFinite(valorUnitario)) return;

            Swal.fire({
                title: "Salvando venda...",
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
            });

            try {
                const novaGrade = { ...(produtoSelecionadoLocal.grade || {}) };
                const estoqueAtual = Number(novaGrade[tamanhoEscolhido] || 0);
                const novoEstoque = Math.max(0, estoqueAtual - qtdVendida);
                novaGrade[tamanhoEscolhido] = novoEstoque;
                const produtoRef = doc(db, "produtos", produtoSelecionadoLocal.id);
                await updateDoc(produtoRef, { grade: novaGrade });

                const uuidVenda = Math.random().toString(36).substring(2, 8).toUpperCase();
                await addDoc(collection(db, "vendas"), {
                    vendaId: uuidVenda,
                    itens: [{
                        produtoId: produtoSelecionadoLocal.id,
                        nome: produtoSelecionadoLocal.nome,
                        codigo: produtoSelecionadoLocal.codigo,
                        tamanho: tamanhoEscolhido,
                        quantidade: qtdVendida,
                        valorUnitario,
                        valorTotal: valorTotalVenda
                    }],
                    produtoId: produtoSelecionadoLocal.id,
                    produtoNome: produtoSelecionadoLocal.nome,
                    codigo: produtoSelecionadoLocal.codigo,
                    tamanho: tamanhoEscolhido,
                    quantidade: qtdVendida,
                    valorTotal: valorTotalVenda,
                    subtotal: valorTotalVenda,
                    desconto: 0,
                    frete: 0,
                    cupom: 'N/A',
                    origem: 'ex-site',
                    dataVenda: new Date(),
                });

                Swal.fire({
                    icon: "success",
                    title: "Venda Confirmada!",
                    text: `Ref: ${uuidVenda}`,
                    confirmButtonColor: "#ffcc00",
                });

                puxarProdutosParaVenda();
                puxarHistoricoVendas();
            } catch (erro) {
                console.error(erro);
                Swal.fire({ icon: "error", title: "Erro", text: "Não foi possível registrar a venda." });
            }
        });
    }

    /* ==========================================================
       4. DASHBOARD
    ========================================================== */
    async function carregarDadosDashboard() {
        const cardReceitas = document.getElementById("txt-receitas");
        const cardVendas = document.getElementById("txt-vendas");

        if (!cardReceitas || !cardVendas) return;

        try {
            const querySnapshot = await getDocs(collection(db, "vendas"));
            let totalReceita = 0;
            let totalVendasQtd = 0;

            querySnapshot.forEach((docSnap) => {
                const dados = docSnap.data();
                const itensVenda = Array.isArray(dados.itens) && dados.itens.length > 0 ? dados.itens : [];
                const totalVenda = Number(dados.valorTotal || 0);
                totalReceita += totalVenda;
                totalVendasQtd += itensVenda.length > 0
                    ? itensVenda.reduce((soma, item) => soma + (parseInt(item.quantidade, 10) || 0), 0)
                    : (dados.quantidade || 0);
            });

            cardReceitas.textContent = totalReceita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            cardVendas.textContent = totalVendasQtd;
        } catch (e) {
            console.error(e);
        }
    }

    /* ==========================================================
       5. CADASTRO DE PRODUTOS
    ========================================================== */
    const chkTamanhoUnico = document.getElementById("prod-tamanho-unico");
    const checkboxesTamanho = document.querySelectorAll('input[name="tamanhos"]');
    const boxQtdUnica = document.getElementById("box-qtd-unica");
    const inputQtdUnica = document.getElementById("prod-qtd-unica");
    const gradesIndividuais = document.getElementById("grades-individuais");

    if (checkboxesTamanho.length > 0) {
        checkboxesTamanho.forEach((cb) => {
            cb.addEventListener("change", (e) => {
                const inputId = e.target.getAttribute("data-target-input");
                const inputQtd = document.getElementById(inputId);
                const tamanho = e.target.value;

                if (e.target.checked) {
                    // Se for Esquerda ou Direita, a quantidade é sempre 1 e o campo fica desabilitado.
                    if (tamanho === 'E' || tamanho === 'D') {
                        inputQtd.value = 1;
                        inputQtd.disabled = true;
                    } else { // Para outros tamanhos, habilita a edição de quantidade.
                        inputQtd.disabled = false;
                        inputQtd.required = true;
                        inputQtd.focus();
                    }
                } else {
                    inputQtd.disabled = true; // Desabilita em todos os casos ao desmarcar.
                    inputQtd.required = false;
                    inputQtd.value = "";
                }
            });
        });
    }

    if (chkTamanhoUnico) {
        chkTamanhoUnico.addEventListener("change", (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                gradesIndividuais.classList.add("is-hidden");
                boxQtdUnica.classList.remove("is-hidden");
                inputQtdUnica.required = true;
                inputQtdUnica.disabled = false;
                checkboxesTamanho.forEach((cb) => {
                    // CORREÇÃO: Não desativa mais 'E' e 'D'
                    if (cb.value !== 'E' && cb.value !== 'D') {
                        cb.checked = false;
                        const inputId = cb.getAttribute("data-target-input");
                        document.getElementById(inputId).disabled = true;
                        document.getElementById(inputId).required = false;
                        document.getElementById(inputId).value = "";
                    }
                });
            } else {
                gradesIndividuais.classList.remove("is-hidden");
                boxQtdUnica.classList.add("is-hidden");
                inputQtdUnica.required = false;
                inputQtdUnica.disabled = true;
                inputQtdUnica.value = "";
            }
        });
    }

    async function converterArquivoParaBase64(file) {
        if (!file) {
            return "img/logo.png";
        }

        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
            reader.readAsDataURL(file);
        });
    }

    async function gerarCodigoProduto() {
        const querySnapshot = await getDocs(collection(db, "produtos"));
        const codigosExistentes = new Set();

        querySnapshot.forEach((docSnap) => {
            const codigo = (docSnap.data().codigo || "").toUpperCase();
            if (codigo) {
                codigosExistentes.add(codigo);
            }
        });

        let codigoGerado = "";
        let tentativa = 0;

        while (!codigoGerado && tentativa < 20) {
            const numero = String(Math.floor(100 + Math.random() * 900)).padStart(3, "0");
            const codigoTentativo = `ORTO-${numero}`;
            if (!codigosExistentes.has(codigoTentativo)) {
                codigoGerado = codigoTentativo;
            }
            tentativa += 1;
        }

        return codigoGerado || `ORTO-${String(Math.floor(100 + Math.random() * 900)).padStart(3, "0")}`;
    }

    const inputCodigoProduto = document.getElementById("prod-codigo");
    if (inputCodigoProduto) {
        inputCodigoProduto.value = await gerarCodigoProduto();
    }

    const selectOrdenarEstoque = document.getElementById("select-ordenar-estoque");
    if (selectOrdenarEstoque) {
        selectOrdenarEstoque.addEventListener("change", (e) => {
            ordemEstoqueAtual = e.target.value;
            renderizarTabelaEstoque();
        });
    }

    const formCadastro = document.getElementById("form-cadastro-produto");
    if (formCadastro) {
        formCadastro.addEventListener("submit", async (e) => {
            e.preventDefault();
            const codigoDigitado = document.getElementById("prod-codigo").value.trim();
            const codigo = codigoDigitado || await gerarCodigoProduto();
            const nome = document.getElementById("prod-nome").value.trim();
            const valor = parseFloat(document.getElementById("prod-valor").value);
            let estoqueFinal = {};

            if (chkTamanhoUnico.checked) {
                estoqueFinal["Unico"] = parseInt(inputQtdUnica.value) || 0;
            } else {
                checkboxesTamanho.forEach((cb) => {
                    if (cb.checked) {
                        const inputId = cb.getAttribute("data-target-input");
                        estoqueFinal[cb.value] = parseInt(document.getElementById(inputId).value) || 0;
                    }
                });
            }

            if (Object.keys(estoqueFinal).length === 0) {
                Swal.fire({ icon: "warning", title: "Atenção!", text: "Preencha a grade." });
                return;
            }

            Swal.fire({ title: "Salvando...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

            try {
                const imagemSelecionada = document.getElementById("prod-imagem").files[0];
                const imagemUrlFinal = await converterArquivoParaBase64(imagemSelecionada);

                await addDoc(collection(db, "produtos"), {
                    codigo: codigo,
                    nome: nome,
                    valor: valor,
                    grade: estoqueFinal,
                    imagemUrl: imagemUrlFinal,
                    criadoEm: new Date(),
                });

                Swal.fire({ icon: "success", title: "Sucesso!", text: "Produto gravado com sucesso." });
                formCadastro.reset();
                if (inputCodigoProduto) {
                    inputCodigoProduto.value = await gerarCodigoProduto();
                }
                document.getElementById("nome-arquivo-upload").textContent = "Nenhum arquivo selecionado";
                document.getElementById("preview-box").style.display = "none";
            } catch (erro) {
                console.error("Erro ao salvar produto:", erro);
                Swal.fire({ icon: "error", title: "Erro", text: "Não foi possível salvar." });
            }
        });
    }

    /* ==========================================================
       6. ESTOQUE (CORREÇÃO: RENDERIZAÇÃO, EDIÇÃO E EXCLUSÃO)
    ========================================================== */
    async function puxarEstoqueDoFirebase() {
        const corpoTabela = document.getElementById("tabela-estoque-corpo");
        if (!corpoTabela) return;
        corpoTabela.innerHTML = `<tr><td colspan="4" class="has-text-centered"><i class="fas fa-spinner fa-pulse mr-2"></i> Carregando estoque...</td></tr>`;

        try {
            const querySnapshot = await getDocs(collection(db, "produtos"));
            localEstoque = [];
            querySnapshot.forEach((docSnap) => {
                localEstoque.push({ id: docSnap.id, ...docSnap.data() });
            });
            renderizarTabelaEstoque();
        } catch (erro) {
            corpoTabela.innerHTML = `<tr><td colspan="4" class="has-text-centered has-text-danger">Erro ao carregar dados.</td></tr>`;
        }
    }

    function renderizarTabelaEstoque() {
        const corpoTabela = document.getElementById("tabela-estoque-corpo");
        if (!corpoTabela) return;
        corpoTabela.innerHTML = "";

        const estoqueOrdenado = [...localEstoque].sort((a, b) => {
            const codigoA = String(a.codigo || "").toUpperCase();
            const codigoB = String(b.codigo || "").toUpperCase();
            const numeroA = parseInt(codigoA.replace(/\D/g, ""), 10) || 0;
            const numeroB = parseInt(codigoB.replace(/\D/g, ""), 10) || 0;

            if (ordemEstoqueAtual === "codigo-decrescente") {
                return numeroB - numeroA || codigoB.localeCompare(codigoA);
            }

            if (ordemEstoqueAtual === "alfabetica") {
                return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
            }

            return numeroA - numeroB || codigoA.localeCompare(codigoB);
        });
        
        if (estoqueOrdenado.length === 0) {
            corpoTabela.innerHTML = `<tr><td colspan="4" class="has-text-centered has-text-grey">Nenhum produto cadastrado.</td></tr>`;
            return;
        }
        
        estoqueOrdenado.forEach((produto) => {
            let HTMLGrade = "";
            for (const tamanho in produto.grade) {
                HTMLGrade += `<span class="stock-tag"><span class="t-name">${tamanho}</span><span class="t-qty">${produto.grade[tamanho]}</span></span>`;
            }
            const linha = document.createElement("tr");
            linha.innerHTML = `
                <td class="has-text-weight-bold has-text-warning">${produto.codigo}</td>
                <td>${produto.nome}</td>
                <td>${HTMLGrade}</td>
                <td class="has-text-centered">
                    <!-- CORREÇÃO: Adicionado onclicks e novo botão de imagem -->
                    <button class="button is-small is-info is-light mr-1" onclick="window.abrirModalEdicao('${produto.id}')" title="Editar estoque">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button class="button is-small is-warning is-light mr-1" onclick="window.adicionarImagemProduto('${produto.id}')" title="Adicionar ou alterar imagem">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="button is-small is-danger is-light" onclick="window.deletarProdutoDoEstoque('${produto.id}')" title="Excluir produto">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            corpoTabela.appendChild(linha);
        });
    }

    // AÇÃO GLOBAL DE EXCLUSÃO DE PRODUTO
    window.deletarProdutoDoEstoque = async (id) => {
        const produto = localEstoque.find(p => p.id === id);
        if (!produto) return;

        const resultado = await Swal.fire({
            title: 'Excluir Produto?',
            text: `Tem certeza que deseja apagar o produto "${produto.nome}"? Esta ação não pode ser desfeita!`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ffcc00',
            cancelButtonColor: '#d33',
            confirmButtonText: 'Sim, deletar!',
            cancelButtonText: 'Cancelar'
        });

        if (resultado.isConfirmed) {
            Swal.fire({ title: "Removendo...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                await deleteDoc(doc(db, "produtos", id));
                Swal.fire('Deletado!', 'O produto foi removido com sucesso.', 'success');
                puxarEstoqueDoFirebase(); // Recarrega a listagem
            } catch (error) {
                console.error(error);
                Swal.fire('Erro!', 'Não foi possível remover o produto.', 'error');
            }
        }
    };

    // AÇÃO GLOBAL DE EDIÇÃO RÁPIDA DE PRODUTO
    // AÇÃO GLOBAL DE EDIÇÃO DE QUANTIDADE NO ESTOQUE (POR TAMANHO)
    window.abrirModalEdicao = async (id) => {
        const produto = localEstoque.find(p => p.id === id);
        if (!produto) return;

        // Monta os campos de quantidade dinamicamente baseados nos tamanhos que o produto tem
        let inputsHTML = `
            <p class="has-text-grey-light mb-4" style="font-size: 0.95rem;">
                Atualizando as quantidades de: <br>
                <strong class="has-text-warning">${produto.nome}</strong>
            </p>
            <hr style="background-color: #2d3748; margin: 10px 0;">
        `;
        
        for (const tamanho in produto.grade) {
            inputsHTML += `
                <div style="text-align: left; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <label style="color: #cbd5e0; font-weight: bold; font-size: 1rem; width: 80px;">Tam. ${tamanho}:</label>
                    <input id="edit-grade-${tamanho}" class="input custom-input" type="number" min="0" value="${produto.grade[tamanho]}" 
                        style="background-color: #121214; color: #fff; border: 1px solid #4a5568; max-width: 120px; text-align: center;">
                </div>
            `;
        }

        const { value: gradeAtualizada } = await Swal.fire({
            title: 'Alterar Quantidade em Estoque',
            html: `<div style="max-width: 300px; margin: 0 auto;">${inputsHTML}</div>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonColor: '#ffcc00',
            cancelButtonColor: '#2d3748',
            confirmButtonText: 'Atualizar Grade',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const novaGrade = {};
                // Coleta o valor digitado para cada tamanho existente na grade
                for (const tamanho in produto.grade) {
                    const qtdInput = document.getElementById(`edit-grade-${tamanho}`);
                    const valorQtd = parseInt(qtdInput.value);
                    
                    if (isNaN(valorQtd) || valorQtd < 0) {
                        Swal.showValidationMessage(`Insira uma quantidade válida para o tamanho ${tamanho}`);
                        return false;
                    }
                    novaGrade[tamanho] = valorQtd;
                }
                return novaGrade;
            }
        });

        // Se o usuário confirmou e preencheu tudo certo, envia para o Firebase
        if (gradeAtualizada) {
            Swal.fire({ title: "Atualizando estoque...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                const produtoRef = doc(db, "produtos", id);
                await updateDoc(produtoRef, {
                    grade: gradeAtualizada
                });
                
                Swal.fire('Sucesso!', 'Estoque atualizado com sucesso.', 'success');
                puxarEstoqueDoFirebase(); // Recarrega a tabela na tela imediatamente
            } catch (error) {
                console.error(error);
                Swal.fire('Erro!', 'Não foi possível atualizar as quantidades no banco de dados.', 'error');
            }
        }
    };

    // AÇÃO GLOBAL PARA ADICIONAR IMAGEM A UM PRODUTO EXISTENTE
    window.adicionarImagemProduto = async (id) => {
        const produto = localEstoque.find(p => p.id === id);
        if (!produto) return;

        const { value: file, isConfirmed } = await Swal.fire({
            title: `Adicionar Imagem para ${produto.nome}`,
            text: 'Selecione o arquivo de imagem para este produto.',
            input: 'file',
            inputAttributes: {
                'accept': 'image/*',
                'aria-label': 'Upload da imagem do produto'
            },
            confirmButtonText: 'Enviar Imagem',
            showCancelButton: true,
            confirmButtonColor: '#ffcc00',
            cancelButtonText: 'Cancelar'
        });

        if (isConfirmed && file) {
            Swal.fire({ title: "Enviando imagem...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

            try {
                const imagemBase64Result = await converterArquivoParaBase64(file);
                const produtoRef = doc(db, "produtos", id);
                await updateDoc(produtoRef, { imagemUrl: imagemBase64Result });

                Swal.fire('Sucesso!', 'A imagem foi adicionada ao produto.', 'success');
                puxarEstoqueDoFirebase(); // Recarrega a tabela
            } catch (error) {
                console.error("Erro ao enviar imagem:", error);
                Swal.fire('Erro!', 'Não foi possível enviar a imagem.', 'error');
            }
        }
    };

    /* ==========================================================
       7. CUPONS
    ========================================================== */
    const formCupom = document.getElementById("form-cupom");
    if (formCupom) {
        formCupom.addEventListener("submit", async (e) => {
            e.preventDefault();
            const codigo = document.getElementById("cupom-nome")?.value?.trim().toUpperCase();
            const usos = parseInt(document.getElementById("cupom-usos")?.value, 10);
            const dataLimite = document.getElementById("cupom-data")?.value;
            const valor = parseFloat(document.getElementById("cupom-valor")?.value);

            if (!codigo || !dataLimite || Number.isNaN(usos) || usos < 1 || Number.isNaN(valor) || valor < 0) {
                Swal.fire({ icon: "warning", title: "Atenção", text: "Preencha o código, o limite de usos, a data e o valor do desconto." });
                return;
            }

            try {
                await addDoc(collection(db, "cupons"), {
                    nome: codigo,
                    usos,
                    dataLimite,
                    valor,
                    ativo: true,
                    criadoEm: new Date()
                });

                Swal.fire({ icon: "success", title: "Cupom criado", text: `O cupom ${codigo} foi salvo com sucesso.` });
                formCupom.reset();
                document.getElementById("modal-cupom")?.classList.remove("is-active");
                puxarCuponsDoFirebase();
            } catch (erro) {
                console.error("Erro ao salvar cupom:", erro);
                Swal.fire({ icon: "error", title: "Erro", text: "Não foi possível salvar o cupom." });
            }
        });
    }

    async function puxarCuponsDoFirebase() {
        const container = document.getElementById("grid-cupons-container");
        if (!container) return;
        container.innerHTML = `<div class="column is-12 has-text-centered py-5"><i class="fas fa-spinner fa-pulse mr-2"></i> Carregando cupons...</div>`;
        try {
            const querySnapshot = await getDocs(collection(db, "cupons"));
            localCupons = [];
            querySnapshot.forEach((docSnap) => {
                localCupons.push({ id: docSnap.id, ...docSnap.data() });
            });
            renderizarGridCupons();
        } catch (erro) {
            container.innerHTML = `<div class="column is-12 has-text-centered has-text-danger">Erro de conexão.</div>`;
        }
    }

    function renderizarGridCupons() {
        const container = document.getElementById("grid-cupons-container");
        if (!container) return;
        container.innerHTML = "";
        
        if (localCupons.length === 0) {
            container.innerHTML = `<div class="column is-12 has-text-centered has-text-grey py-5">Nenum cupom registrado.</div>`;
            return;
        }
        
        localCupons.forEach((cupom) => {
            const coluna = document.createElement("div");
            coluna.className = "column is-4";
            coluna.innerHTML = `
                <div class="card-cupom">
                    <div class="is-flex is-justify-content-space-between is-align-items-center mb-3">
                        <span class="cupom-titulo">${cupom.nome}</span>
                        <span class="tag is-warning is-light">R$ ${Number(cupom.valor || 0).toFixed(2)}</span>
                    </div>
                    <p class="has-text-grey-light mb-1"><strong>Usos:</strong> ${cupom.usos || 0}</p>
                    <p class="has-text-grey-light"><strong>Validade:</strong> ${cupom.dataLimite || 'Sem data'}</p>
                </div>
            `;
            container.appendChild(coluna);
        });
    }
});