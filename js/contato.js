// Importa as funções específicas do Firestore
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Importa a conexão do banco de dados a partir do seu arquivo de configuração
import { db } from "./fireconfig.js";

document.addEventListener("DOMContentLoaded", () => {
    
    // ==========================================================
    // 1. SISTEMA DAS ESTRELAS DE AVALIAÇÃO (Hover e Click)
    // ==========================================================
    const estrelas = document.querySelectorAll(".estrelas i");
    const inputAvaliacao = document.getElementById("avaliacao-valor");

    estrelas.forEach(estrela => {
        // Ao Clicar: Fixa a nota escolhida
        estrela.addEventListener("click", () => {
            const valor = estrela.getAttribute("data-valor");
            inputAvaliacao.value = valor;

            estrelas.forEach(e => {
                if (e.getAttribute("data-valor") <= valor) {
                    e.classList.remove("fa-regular");
                    e.classList.add("fa-solid", "ativa");
                } else {
                    e.classList.remove("fa-solid", "ativa");
                    e.classList.add("fa-regular");
                }
            });
        });

        // Ao Passar o Mouse: Pinta de amarelo temporariamente
        estrela.addEventListener("mouseover", () => {
            const valorHover = estrela.getAttribute("data-valor");
            estrelas.forEach(e => {
                e.style.color = e.getAttribute("data-valor") <= valorHover ? "#eab308" : "";
            });
        });

        // Ao Tirar o Mouse: Retorna para a nota fixada ou para cinza
        estrela.addEventListener("mouseout", () => {
            const valorAtual = inputAvaliacao.value;
            estrelas.forEach(e => {
                e.style.color = e.getAttribute("data-valor") <= valorAtual ? "#eab308" : "";
            });
        });
    });


    // ==========================================================
    // 2. BUSCAR E EXIBIR FEEDBACKS DO FIREBASE (FIRESTORE)
    // ==========================================================
    const containerFeedbacks = document.getElementById("container-feedbacks");

    async function carregarFeedbacks() {
        containerFeedbacks.innerHTML = "<p style='text-align:center; color:#64748b; grid-column: 1 / -1;'><i class='fa-solid fa-spinner fa-spin'></i> Carregando comentários do banco de dados...</p>";

        try {
            // Consulta a coleção "feedbacks" ordenada por data decrescente (mais recentes no topo)
            const q = query(collection(db, "feedbacks"), orderBy("data", "desc"));
            const querySnapshot = await getDocs(q);
            
            containerFeedbacks.innerHTML = ""; // Limpa o loader

            if (querySnapshot.empty) {
                containerFeedbacks.innerHTML = "<p style='text-align:center; color:#64748b; grid-column: 1 / -1;'>Seja o primeiro a avaliar nossa loja!</p>";
                return;
            }

            // Para cada documento encontrado no banco, constrói o Card de Depoimento
            querySnapshot.forEach((docSnap) => {
                const fb = docSnap.data();
                
                // Formata a data (se existir)
                let dataFormatada = "";
                if (fb.data) {
                    dataFormatada = new Date(fb.data.toDate()).toLocaleDateString('pt-BR');
                }

                // Cria o HTML das estrelinhas para a nota exata que a pessoa deu
                let estrelasHtml = "";
                for(let i = 1; i <= 5; i++) {
                    if(i <= fb.nota) {
                        estrelasHtml += '<i class="fa-solid fa-star"></i>';
                    } else {
                        estrelasHtml += '<i class="fa-regular fa-star"></i>';
                    }
                }

                const card = `
                    <div class="card-depoimento">
                        <div class="nome-cliente">
                            <i class="fa-solid fa-user-circle" style="margin-right: 5px;"></i> ${fb.nome || "Cliente"}
                            <span style="font-size: 0.8rem; color: #94a3b8; font-weight: normal; margin-left: 8px;">${dataFormatada}</span>
                        </div>
                        <div class="estrelas-dadas">${estrelasHtml}</div>
                        <div class="mensagem-cliente">"${fb.mensagem || ""}"</div>
                    </div>
                `;
                containerFeedbacks.innerHTML += card;
            });

        } catch (error) {
            console.error("Erro ao carregar feedbacks:", error);
            containerFeedbacks.innerHTML = "<p style='text-align:center; color:#ef4444; grid-column: 1 / -1;'>Erro ao carregar os comentários. Tente recarregar a página.</p>";
        }
    }

    // Chama a função assim que a página é carregada
    carregarFeedbacks();


    // ==========================================================
    // 3. ENVIAR NOVO FEEDBACK PARA O FIREBASE
    // ==========================================================
    const formFeedback = document.getElementById("form-feedback");

    if (formFeedback) {
        formFeedback.addEventListener("submit", async (e) => {
            e.preventDefault();

            const nota = inputAvaliacao.value;
            const nome = document.getElementById("nome-feedback").value;
            const mensagem = document.getElementById("mensagem-feedback").value;

            // Validação de segurança: Impede envio com nota zero
            if (nota === "0") {
                Swal.fire({
                    icon: 'warning',
                    title: 'Atenção',
                    text: 'Por favor, selecione uma nota nas estrelas.',
                    confirmButtonColor: '#eab308'
                });
                return;
            }

            // Mostra tela de carregamento do SweetAlert
            Swal.fire({
                title: 'Enviando...',
                text: 'Registrando seu feedback no banco de dados.',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            try {
                // Comando para adicionar um novo documento na coleção "feedbacks"
                await addDoc(collection(db, "feedbacks"), {
                    nome: nome,
                    nota: parseInt(nota),
                    mensagem: mensagem,
                    data: serverTimestamp() // Usa a hora exata dos servidores do Google
                });

                // Confirmação de Sucesso
                Swal.fire({
                    icon: 'success',
                    title: 'Obrigado!',
                    text: 'Seu feedback foi publicado e já está visível para todos.',
                    confirmButtonColor: '#22c55e'
                }).then(() => {
                    // Reseta o formulário
                    formFeedback.reset();
                    inputAvaliacao.value = "0";
                    estrelas.forEach(estrela => {
                        estrela.classList.remove("fa-solid", "ativa");
                        estrela.classList.add("fa-regular");
                        estrela.style.color = "";
                    });

                    // Recarrega a lista de feedbacks para incluir o novo imediatamente
                    carregarFeedbacks();
                });

            } catch (error) {
                console.error("Erro ao salvar no Firebase:", error);
                Swal.fire({
                    icon: 'error',
                    title: 'Erro',
                    text: 'Não foi possível salvar seu feedback agora. Verifique a internet e tente novamente.',
                    confirmButtonColor: '#ef4444'
                });
            }
        });
    }
});