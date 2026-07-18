// 1. Importa as funções do Firebase direto da internet
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
// 👉 ADICIONE ESTA IMPORTAÇÃO DO FIRESTORE
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// 2. Suas credenciais oficiais
const firebaseConfig = {
    apiKey: "AIzaSyBfSSeo-Z8KWbH7rskRA0nrGKyVUfJlnxo",
    authDomain: "sprodutosort.firebaseapp.com",
    projectId: "sprodutosort",
    storageBucket: "sprodutosort.firebasestorage.app",
    messagingSenderId: "252165781461",
    appId: "1:252165781461:web:ca2262b9a326004d27ef5c",
    measurementId: "G-17K63MCDZZ"
};

// 3. Liga o Firebase no seu sistema
const app = initializeApp(firebaseConfig);

// 4. Cria e exporta os serviços
export const auth = getAuth(app);
// 👉 ADICIONE ESTA LINHA PARA EXPORTAR O BANCO DE DADOS
export const db = getFirestore(app); 

console.log("Configuração do Firebase carregada sem erros!");