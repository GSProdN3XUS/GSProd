// Importações
import { db } from "./fireconfig.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const auth = getAuth();

// Proteção da Página: Redireciona para o login se não estiver logado
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "index.html";
    }
});

// ==========================================
// FUNÇÃO GLOBAL DE GERAR PDF DA NOTA
// (Deve ficar fora do DOMContentLoaded para poder ser chamada no onclick do HTML)
// ==========================================
window.gerarNotaPDF = (vendaCodificada) => {
    // Descodifica os dados da venda
    const venda = JSON.parse(decodeURIComponent(vendaCodificada));

    const { jsPDF } = window.jspdf;
    
    // 1. Configura o tamanho para a bobina de 80mm de largura por 125mm de altura (ganhou uma folguinha)
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, 125] 
    });

    const empresa = "S PRODUTOS ORTOPÉDICOS";
    const proprietario = "GEILSON LEITE CORDEIRO - ME";
    const cnpj = "22.541.955/0001-99";
    const dataAtual = new Date().toLocaleDateString('pt-BR');

    // 2. Cria o fundo amarelo claro (#fffdeb) preenchendo toda a página
    doc.setFillColor(255, 253, 235);
    doc.rect(0, 0, 80, 125, 'F');

    // 3. Define a fonte padrão estilo impressora térmica (Courier) e a cor do texto (Preto)
    doc.setFont("courier", "normal");
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    
    // Configura o estilo de linha tracejada/pontilhada
    doc.setLineDashPattern([1.2, 1.2], 0);

    // --- TOPO DO CUPOM ---
    doc.line(5, 5, 75, 5); // Linha tracejada inicial
    
    doc.setFont("courier", "bold");
    doc.setFontSize(14);
    doc.text("Cupom Fiscal", 40, 12, { align: 'center' });
    
    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    doc.text(empresa, 40, 17, { align: 'center' });
    doc.text(dataAtual, 40, 22, { align: 'center' });
    
    doc.line(5, 25, 75, 25);

    // --- CABEÇALHO DA TABELA ---
    doc.setFont("courier", "bold");
    doc.text("Item", 5, 31);
    doc.text("Qtd", 42, 31);
    doc.text("valor", 75, 31, { align: 'right' });
    
    doc.line(5, 34, 75, 34);

    // --- CORPO DA TABELA (PRODUTOS) ---
    doc.setFont("courier", "normal");
    
    const nomeProd = String(venda.produtoNome || '---');
    const tamProd = String(venda.tamanho || '---');
    const nomeFormatado = `${nomeProd} (${tamProd})`.substring(0, 18);
    
    const qtdFormatada = String(venda.quantidade || '01').padStart(2, '0');
    const valorPago = venda.valorTotal ? Number(venda.valorTotal).toFixed(2) : '0.00';

    doc.text(nomeFormatado, 5, 40);
    doc.text(qtdFormatada, 42, 40);
    doc.text(`R$ ${valorPago}`, 75, 40, { align: 'right' });
    
    doc.line(5, 44, 75, 44);

    // --- DESCONTOS ---
    doc.text("val.desc", 5, 50);
    doc.text("-R$ 0,00", 75, 50, { align: 'right' });
    
    doc.line(5, 54, 75, 54);

    // --- TOTAL ---
    doc.setFont("courier", "bold");
    doc.setFontSize(11);
    doc.text("valor total", 5, 60);
    doc.text(`R$ ${valorPago}`, 75, 60, { align: 'right' });
    
    doc.line(5, 64, 75, 64);

    // --- IDENTIFICAÇÃO E DADOS ---
    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    
    const idVenda = String(venda.vendaId || '---');
    doc.text(`identificador: ${idVenda}`, 5, 70);
    
    // Altera a legenda para "representante legal" e calcula a quebra caso falte espaço lateral
    const textoRepresentante = `representante legal: ${proprietario}`;
    const linhasRepresentante = doc.splitTextToSize(textoRepresentante, 70);
    doc.text(linhasRepresentante, 5, 75);
    
    // Descobre dinamicamente onde o CNPJ deve ficar (calculando o espaço das linhas do representante)
    const proximaLinhaY = 75 + (linhasRepresentante.length * 4.5);
    doc.text(`CNPJ: ${cnpj}`, 5, proximaLinhaY);
    
    // Insere a OBS
    const textoObs = "OBS ---- troca realizada somente com apresentação do cupom fiscal";
    const linhasObs = doc.splitTextToSize(textoObs, 70); 
    doc.text(linhasObs, 5, proximaLinhaY + 6);
    
    // Ajusta a posição da última linha tracejada do encerramento
    const linhaFinalY = proximaLinhaY + 6 + (linhasObs.length * 4.5);
    doc.line(5, linhaFinalY, 75, linhaFinalY); 

    // Salva o PDF com o estilo de cupom limpo
    doc.save(`Cupom_Venda_${idVenda}.pdf`);
};

document.addEventListener("DOMContentLoaded", () => {
    // Variáveis globais
    let localEstoque = [];
    let localCupons = [];
    let imagemBase64 = "";

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
                }
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
                listaVendas.push(docSnap.data());
            });

            listaVendas.sort((a, b) => {
                const dataA = a.dataVenda?.seconds || 0;
                const dataB = b.dataVenda?.seconds || 0;
                return dataB - dataA;
            });

            listaVendas.forEach((venda) => {
                const linha = document.createElement("tr");
                
                // CORREÇÃO: Codifica a venda inteira para mandar pro botão do PDF
                const vendaJSON = encodeURIComponent(JSON.stringify(venda));

                linha.innerHTML = `
                    <td><span class="has-text-weight-bold has-text-info">${venda.vendaId || '------'}</span></td>
                    <td>${venda.produtoNome} <small class="has-text-grey">(${venda.codigo || 'S/C'})</small></td>
                    <td><span class="tag is-dark">${venda.tamanho}</span></td>
                    <td>${venda.quantidade}</td>
                    <td class="has-text-success">${venda.valorTotal ? venda.valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : 'R$ 0,00'}</td>
                    <td class="has-text-centered">
                        <!-- Botão de gerar nota modificado -->
                        <button class="button is-small is-warning is-light" onclick="gerarNotaPDF('${vendaJSON}')">
                            <i class="fas fa-file-invoice mr-1"></i> Nota
                        </button>
                    </td>
                `;
                corpoTabelaVendas.appendChild(linha);
            });
        } catch (e) {
            console.error("Erro ao carregar histórico:", e);
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
            const qtdVendida = parseInt(inputVendaQtd.value);
            const valorTotalVenda = produtoSelecionadoLocal.valor * qtdVendida;

            if (!produtoSelecionadoLocal || !tamanhoEscolhido || qtdVendida <= 0) return;

            Swal.fire({
                title: "Salvando venda...",
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
            });

            try {
                // Abate do estoque
                const novaGrade = { ...produtoSelecionadoLocal.grade };
                novaGrade[tamanhoEscolhido] -= qtdVendida;
                const produtoRef = doc(db, "produtos", produtoSelecionadoLocal.id);
                await updateDoc(produtoRef, { grade: novaGrade });

                // Gera UID de 6 caracteres
                const uuidVenda = Math.random().toString(36).substring(2, 8).toUpperCase();

                // Salva a venda
                await addDoc(collection(db, "vendas"), {
                    vendaId: uuidVenda,
                    produtoId: produtoSelecionadoLocal.id,
                    produtoNome: produtoSelecionadoLocal.nome,
                    codigo: produtoSelecionadoLocal.codigo,
                    tamanho: tamanhoEscolhido,
                    quantidade: qtdVendida,
                    valorTotal: valorTotalVenda,
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
                totalReceita += dados.valorTotal || 0;
                totalVendasQtd += dados.quantidade || 0;
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
                if (e.target.checked) {
                    inputQtd.disabled = false;
                    inputQtd.required = true;
                    inputQtd.focus();
                } else {
                    inputQtd.disabled = true;
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
                    cb.checked = false;
                    const inputId = cb.getAttribute("data-target-input");
                    document.getElementById(inputId).disabled = true;
                    document.getElementById(inputId).required = false;
                    document.getElementById(inputId).value = "";
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

    const inputImagem = document.getElementById("prod-imagem");
    const nomeArquivoUpload = document.getElementById("nome-arquivo-upload");
    const previewBox = document.getElementById("preview-box");
    const imgPreview = document.getElementById("img-preview");

    if (inputImagem) {
        inputImagem.addEventListener("change", (e) => {
            const arquivoSelecionado = e.target.files[0];
            if (arquivoSelecionado) {
                nomeArquivoUpload.textContent = arquivoSelecionado.name;
                const reader = new FileReader();
                reader.onload = function (event) {
                    imagemBase64 = event.target.result;
                    imgPreview.src = imagemBase64;
                    previewBox.style.display = "block";
                };
                reader.readAsDataURL(arquivoSelecionado);
            } else {
                nomeArquivoUpload.textContent = "Nenhum arquivo selecionado";
                previewBox.style.display = "none";
                imagemBase64 = "";
            }
        });
    }

    const formCadastro = document.getElementById("form-cadastro-produto");
    if (formCadastro) {
        formCadastro.addEventListener("submit", async (e) => {
            e.preventDefault();
            const codigo = document.getElementById("prod-codigo").value.trim();
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
            if (!imagemBase64) {
                Swal.fire({ icon: "warning", title: "Atenção!", text: "Selecione uma imagem." });
                return;
            }

            Swal.fire({ title: "Salvando...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

            try {
                await addDoc(collection(db, "produtos"), {
                    codigo: codigo,
                    nome: nome,
                    valor: valor,
                    grade: estoqueFinal,
                    imagemUrl: imagemBase64,
                    criadoEm: new Date(),
                });
                Swal.fire({ icon: "success", title: "Sucesso!", text: "Produto gravado com sucesso." });
                formCadastro.reset();
                nomeArquivoUpload.textContent = "Nenhum arquivo selecionado";
                previewBox.style.display = "none";
                imagemBase64 = "";
            } catch (erro) {
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
        
        if (localEstoque.length === 0) {
            corpoTabela.innerHTML = `<tr><td colspan="4" class="has-text-centered has-text-grey">Nenhum produto cadastrado.</td></tr>`;
            return;
        }
        
        localEstoque.forEach((produto) => {
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
                    <!-- CORREÇÃO: Adicionado onclicks apontando explicitamente para a janela global -->
                    <button class="button is-small is-info is-light mr-1" onclick="window.abrirModalEdicao('${produto.id}')">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button class="button is-small is-danger is-light" onclick="window.deletarProdutoDoEstoque('${produto.id}')">
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

    /* ==========================================================
       7. CUPONS
    ========================================================== */
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
                    </div>
                </div>
            `;
            container.appendChild(coluna);
        });
    }
});