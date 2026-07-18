// ==========================================================================
// js/login.js - LÓGICA DO FORMULÁRIO, MODAL E CADASTRO NO FIREBASE
// ==========================================================================

// Importações dos módulos necessários
import { auth } from "./fireconfig.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

// Mapeamento dos elementos do HTML
const btnCadastreSe = document.querySelector(".link-cadastro");
const modal = document.getElementById("modal-cadastro");
const btnFechar = document.getElementById("fechar-modal");
const formCadastro = document.getElementById("form-cadastro");
const formLogin = document.getElementById("form-login");

// --- CONTROLE DE EXIBIÇÃO DO MODAL ---

if (btnCadastreSe) {
    btnCadastreSe.addEventListener("click", (e) => {
        e.preventDefault();
        modal.style.display = "flex";
    });
}

if (btnFechar) {
    btnFechar.addEventListener("click", () => {
        modal.style.display = "none";
    });
}

window.addEventListener("click", (e) => {
    if (e.target === modal) {
        modal.style.display = "none";
    }
});


// --- PROCESSAMENTO DO LOGIN ---

if (formLogin) {
    formLogin.addEventListener("submit", (e) => {
        e.preventDefault();

        const emailInput = document.getElementById("login-email").value;
        const senhaInput = document.getElementById("login-password").value;

        // Autentica o usuário no Firebase Auth
        signInWithEmailAndPassword(auth, emailInput, senhaInput)
            .then((userCredential) => {
                const usuarioLogado = userCredential.user;
                
                // E-mail configurado para o painel de controle do Admin
                const emailAdmin = "admin@admin.com"; 

                if (usuarioLogado.email === emailAdmin) {
                    // Redireciona para o dashboard administrativo
                    window.location.href = "admin.html";
                } else {
                    // Redireciona para a home do cliente comum (E-commerce)
                    window.location.href = "index.html";
                }
            })
            .catch((error) => {
                console.error("Erro ao fazer login:", error.code);
                
                let mensagemErro = "E-mail ou senha incorretos.";
                if (error.code === "auth/invalid-credential" || error.code === "auth/user-not-found") {
                    mensagemErro = "Usuário não encontrado ou senha incorreta.";
                }

                Swal.fire({
                    title: "Erro ao Entrar",
                    text: mensagemErro,
                    icon: "error",
                    confirmButtonColor: "#002244",
                    target: document.body
                });
            });
    });
}


// --- PROCESSAMENTO DO CADASTRO (FIREBASE AUTH) ---

if (formCadastro) {
    formCadastro.addEventListener("submit", (e) => {
        e.preventDefault();

        const nome = document.getElementById("reg-nome").value;
        const cpf = document.getElementById("reg-cpf").value;
        const telefone = document.getElementById("reg-telefone").value;
        const email = document.getElementById("reg-email").value;
        const password = document.getElementById("reg-password").value;

        createUserWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                modal.style.display = "none";
                formCadastro.reset();

                Swal.fire({
                    title: "Sucesso!",
                    text: "Cadastro realizado com sucesso!",
                    icon: "success",
                    confirmButtonColor: "#002244",
                    target: document.body
                });
            })
            .catch((error) => {
                console.error("Erro identificado no Firebase:", error.code, error.message);
                
                let mensagemFinal = "Não foi possível realizar o cadastro. Tente novamente.";
                
                if (error.code === "auth/email-already-in-use") {
                    mensagemFinal = "Este endereço de e-mail já está sendo utilizado por outra conta.";
                } else if (error.code === "auth/weak-password") {
                    mensagemFinal = "A senha fornecida é muito fraca. Escolha uma com no mínimo 6 caracteres.";
                } else if (error.code === "auth/invalid-email") {
                    mensagemFinal = "O formato do e-mail inserido é inválido.";
                }

                Swal.fire({
                    title: "Erro no Cadastro!",
                    text: mensagemFinal,
                    icon: "error",
                    confirmButtonColor: "#002244",
                    target: document.body
                });
            });
    });
}