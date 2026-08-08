const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
require('dotenv').config();

// Carrega de forma segura as variáveis configuradas em seu arquivo oculto local .env
dotenv.config();

admin.initializeApp({
    databaseURL: "https://sprodutosort-default-rtdb.firebaseio.com",
});

// Inicialização dinâmica do SDK oficial do Stripe utilizando a chave restrita do ambiente
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

function normalizarValorMonetario(valor) {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;

    if (typeof valor === 'string') {
        const texto = valor.trim().replace(/[^\d,.-]/g, '');
        if (!texto) return 0;

        if (texto.includes(',') && texto.includes('.')) {
            return Number(texto.replace(/\./g, '').replace(',', '.'));
        }

        if (texto.includes(',')) {
            return Number(texto.replace(',', '.'));
        }

        return Number(texto);
    }

    return Number(valor) || 0;
}

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// REGRA CRÍTICA DE MIDDLEWARE: O Stripe exige a leitura do body bruto (Buffer) no endpoint do Webhook 
// para validar a assinatura criptográfica de origem. Esta condicional impede que o express.json() intercepte o payload.
app.use((req, res, next) => {
    if (req.originalUrl === '/webhook') {
        next();
    } else {
        express.json()(req, res, next);
    }
});

app.use(cors());

// Estrutura de armazenamento volátil em memória (Map) para vincular os dados da Ordem de Serviço
// ao ID único de checkout do Stripe até que o evento assíncrono de pagamento ocorra.
const ordensPendentes = new Map();

/**
 * Função Auxiliar Centralizada do Telegram
 * Envia a mensagem de ordem de serviço para o chat do bot Telegram configurado.
 */
async function executarEnvioTelegram(payloadOrNumero, maybeVariaveis) {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        throw new Error('Telegram bot token ou chat id não configurados. Defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env.');
    }

    // Aceita tanto o objeto completo quanto a forma legada (numero, variaveis)
    let dados = null;
    if (typeof payloadOrNumero === 'object' && payloadOrNumero !== null) {
        dados = payloadOrNumero;
    } else {
        dados = { numeroDonoLoja: payloadOrNumero, variaveisConteudo: maybeVariaveis };
    }

    // Se a variavel variaveisConteudo contém mensagem pronta (campo 2), usa-a
    let corpoMensagem = '';
    try {
        if (dados.variaveisConteudo) {
            const parsed = typeof dados.variaveisConteudo === 'string' ? JSON.parse(dados.variaveisConteudo) : dados.variaveisConteudo;
            if (parsed && parsed[2]) corpoMensagem = String(parsed[2]);
        }
    } catch (e) {
        console.warn('Falha ao analisar variaveisConteudo no servidor, irá montar template manualmente.');
    }

    // Se não houve mensagem pronta, monta conforma o template ASCII solicitado
    if (!corpoMensagem || corpoMensagem.trim().length === 0) {
        const nome = dados.clienteNome || (dados.variaveisConteudo && dados.variaveisConteudo.nome) || 'Cliente';
        const email = dados.clienteEmail || 'não informado';
        const telefone = dados.telefone || (dados.variaveisConteudo && dados.variaveisConteudo.telefone) || 'não informado';
        const cpf = dados.cpf || (dados.variaveisConteudo && dados.variaveisConteudo.cpf) || '---';
        const endereco = dados.endereco || (dados.variaveisConteudo && dados.variaveisConteudo.endereco) || '---';

        const itens = Array.isArray(dados.produtos) ? dados.produtos : [];
        const linhasItens = itens.map((it, idx) => {
            const nomeItem = String(it.nome || it.product || `item ${idx + 1}`);
            const qtd = String((it.quantidade || it.qtd || 1)).padStart(2, '0');
            return `${nomeItem.padEnd(25, ' ')} ${qtd}`;
        }).join('\n');

        const subtotal = Number(dados.subtotal || 0);
        const frete = Number(dados.frete || 0);
        const desconto = Number(dados.desconto || 0);
        const total = Number(dados.total || (subtotal - desconto + frete));
        const dataAtual = new Date().toLocaleDateString('pt-BR');

        corpoMensagem = `------------------------------\nOrdem de serviço\n S produtos Ortopédicos\n ${dataAtual}\n------------------------------\nItem                     Qtd\n${linhasItens}\n------------------------------\npagamento via stripe - forma de pag\nendereço de entrega: ${endereco}\n\nnome cliente: ${nome}\nidentificador: ${email}\nnome dono\nCNPJ\n\nSUBTOTAL: R$ ${subtotal.toFixed(2)}\nFRETE: R$ ${frete.toFixed(2)}\nDESCONTO: R$ ${desconto.toFixed(2)}\nTOTAL: R$ ${total.toFixed(2)}`;
    }

    const mensagemCompleta = corpoMensagem;
    const payload = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensagemCompleta });

    const https = require('https');
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    await new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve();
                else reject(new Error(`Telegram API response ${res.statusCode}: ${data}`));
            });
        });
        req.on('error', (err) => reject(err));
        req.write(payload);
        req.end();
    });
}

// =================================================================
// 1. ROTA ORIGINAL (MANTIDA INTACTA PARA SUPORTE E COMPATIBILIDADE)
// =================================================================
app.post('/enviar-ordem-servico', async (req, res) => {
    try {
        const payload = req.body;
        payload.preEnviado = true;
        console.log(
        await executarEnvioTelegram(payload));
        return res.json({ sucesso: true });
    } catch (error) {
        console.error("Erro na rota de envio de ordem de serviço via Telegram:", error);
        return res.status(500).json({ sucesso: false, erro: error.message });
    }
});

app.post('/enviar-pdf-email', async (req, res) => {
    try {
        const { to, nomeCliente, subject, message, pdfBase64, filename } = req.body;
        if (!to || !pdfBase64) {
            return res.status(400).json({ sucesso: false, erro: 'E-mail e PDF são obrigatórios.' });
        }

        const mailOptions = {
            from: process.env.SMTP_FROM || 'geilson2018jgt@gmail.com',
            to,
            subject: subject || 'Compra Realizada com Sucesso',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 8px;">
                    <h2 style="color: #1f2937;">Compra Realizada com Sucesso</h2>
                    <p>Olá, ${nomeCliente || 'cliente'}!</p>
                    <p>Você acaba de realizar uma compra conosco. Estamos te enviando a nota fiscal interna para caso seja necessário realizar troca ou acionamento da garantia.</p>
                    <p><strong>Importante:</strong> trocas e acionamento da garantia só serão realizados mediante a apresentação do cupom fiscal.</p>
                    <p>Atenciosamente,<br />S Produtos Ortopédicos</p>
                </div>
            `,
            attachments: [{
                filename: filename || 'cupom.pdf',
                content: Buffer.from(pdfBase64, 'base64'),
                contentType: 'application/pdf',
            }],
        };

        await transporter.sendMail(mailOptions);
        return res.json({ sucesso: true });
    } catch (error) {
        console.error('Erro ao enviar e-mail com PDF:', error);
        return res.status(500).json({ sucesso: false, erro: error.message });
    }
});

app.post('/admin/delete-user', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ error: 'UID do usuário é obrigatório.' });
        }

        await admin.auth().deleteUser(uid);
        const userDoc = admin.firestore().doc(`usuarios/${uid}`);
        await userDoc.delete().catch(() => null);

        return res.json({ success: true });
    } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        return res.status(500).json({ error: error.message });
    }
});

app.post('/admin/send-password-reset', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'E-mail do usuário é obrigatório.' });
        }

        const link = await admin.auth().generatePasswordResetLink(email);

        const mailOptions = {
            from: process.env.SMTP_FROM || 'geilson2018jgt@gmail.com',
            to: email,
            subject: 'Redefinição de Senha - S Produtos Ortopédicos',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 8px;">
                    <h2 style="color: #1f2937;">Redefinição de senha</h2>
                    <p>Olá,</p>
                    <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
                    <p><a href="${link}" style="display: inline-block; padding: 10px 16px; background: #eab308; color: #00122a; text-decoration: none; font-weight: bold; border-radius: 4px;">Redefinir senha</a></p>
                    <p>Se você não solicitou esta alteração, ignore esta mensagem.</p>
                    <p>Atenciosamente,<br />S Produtos Ortopédicos</p>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);
        return res.json({ success: true });
    } catch (error) {
        console.error('Erro ao gerar link de redefinição:', error);
        return res.status(500).json({ error: error.message });
    }
});

// =================================================================
// 2. ROTA STRIPE: PROCESSAMENTO DO CARRINHO E CRIAÇÃO DO CHECKOUT
// =================================================================
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { numeroDonoLoja, variaveisConteudo, produtos, frete, desconto, subtotal, total } = req.body;

        const produtosValidos = Array.isArray(produtos) ? produtos.filter(Boolean) : [];
        const freteRecebido = normalizarValorMonetario(frete);
        const descontoRecebido = Math.max(0, normalizarValorMonetario(desconto));
        const subtotalRecebido = normalizarValorMonetario(subtotal);
        const totalRecebido = normalizarValorMonetario(total);

        let line_items = [];

        if (produtosValidos.length > 0) {
            line_items = produtosValidos.map(item => {
                const precoUnitario = normalizarValorMonetario(item.preco);
                const quantidade = Math.max(1, parseInt(item.quantidade, 10) || 1);
                const nomeItem = `${item.nome || 'Produto'}${item.tamanho ? ` (${item.tamanho})` : ''}`.trim() || 'Item do Carrinho';

                return {
                    price_data: {
                        currency: 'brl',
                        product_data: {
                            name: nomeItem,
                            description: `${quantidade}x ${item.tamanho || 'unidade'}`.trim(),
                        },
                        unit_amount: Math.max(100, Math.round(precoUnitario * 100)),
                    },
                    quantity: quantidade,
                };
            });
        }

        if (line_items.length === 0) {
            const valorFallback = Math.max(100, Math.round((totalRecebido || subtotalRecebido || 10000) * 100));
            line_items = [{
                price_data: {
                    currency: 'brl',
                    product_data: { name: 'Pedido S Produtos Ortopédicos' },
                    unit_amount: valorFallback,
                },
                quantity: 1,
            }];
        }

        if (freteRecebido > 0) {
            line_items.push({
                price_data: {
                    currency: 'brl',
                    product_data: { name: 'Taxa de Entrega (Frete)' },
                    unit_amount: Math.round(freteRecebido * 100),
                },
                quantity: 1,
            });
        }

        let discounts = [];
        if (descontoRecebido > 0) {
            const coupon = await stripe.coupons.create({
                amount_off: Math.round(descontoRecebido * 100),
                currency: 'brl',
                duration: 'once',
            });
            discounts.push({ coupon: coupon.id });
        }

        // Instanciação da Checkout Session oficial do Stripe
        const valorTotalCheckout = Math.max(0, (totalRecebido || subtotalRecebido || 0) - descontoRecebido + freteRecebido);

        const sessionPayload = {
            payment_method_types: ['card'],
            line_items,
            mode: 'payment',
            metadata: {
                subtotal: String(subtotalRecebido || totalRecebido || 0),
                desconto: String(descontoRecebido),
                frete: String(freteRecebido),
                total: String(valorTotalCheckout),
            },
            success_url: 'http://127.0.0.1:5500/index.html?pay=success',
            cancel_url: 'http://127.0.0.1:5500/carrinho.html?pay=canceled',
        };

        if (discounts.length > 0) {
            sessionPayload.discounts = discounts;
        } else {
            sessionPayload.allow_promotion_codes = true;
        }

        const session = await stripe.checkout.sessions.create(sessionPayload);

        // RETENÇÃO ESTRATÉGICA: Vincula o ID exclusivo da sessão de pagamento aos metadados do pedido na memória.
        // Salva o payload completo para montagem posterior da Ordem de Serviço.
        ordensPendentes.set(session.id, Object.assign({}, req.body));

        // Retorna a URL de pagamento para que o front-end efetue o redirecionamento seguro
        res.json({ url: session.url });

    } catch (error) {
        console.error("Erro crítico ao instanciar sessão no Stripe:", error);
        res.status(500).json({ error: error.message });
    }
});

// =================================================================
// 3. WEBHOOK STRIPE: VERIFICAÇÃO ASSÍNCRONA E ACIONAMENTO DO TWILIO
// =================================================================
app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
    const sig = request.headers['stripe-signature'];
    let event;

    try {
        // Validação criptográfica do payload usando a assinatura digital e o segredo do 'stripe listen'
        event = stripe.webhooks.constructEvent(request.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Falha crítica de autenticidade no Webhook: ${err.message}`);
        return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Monitoramento do evento de liquidação bem-sucedida do pagamento
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        // Recupera os dados retidos em memória associados a esta transação específica
        const dadosDoPedido = ordensPendentes.get(session.id);

        if (dadosDoPedido) {
            try {
                // NOVO: Salva a ordem de serviço no Firebase Realtime Database para notificação externa
                try {
                    const db = admin.database();
                    const novaOrdemRef = db.ref('ordens_servico').push();
                    await novaOrdemRef.set({
                        ...dadosDoPedido,
                        status: 'pagamento_aprovado',
                        criadoEm: admin.database.ServerValue.TIMESTAMP,
                        idSessaoStripe: session.id,
                    });
                    console.log(`[RTDB] Ordem de serviço ${novaOrdemRef.key} salva no Realtime Database.`);
                } catch (dbError) {
                    console.error("[RTDB] Erro ao salvar a ordem de serviço no Realtime Database:", dbError);
                    // O fluxo continua mesmo em caso de falha para não impactar outras notificações.
                }

                console.log(`[STRIPE] Pagamento verificado com sucesso para a sessão: ${session.id}`);
                if (dadosDoPedido.preEnviado) {
                    console.log("[TELEGRAM] Ordem de Serviço já enviada anteriormente, pulando reenvio.");
                } else {
                    console.log("[TELEGRAM] Iniciando disparo seguro da Ordem de Serviço via Telegram...");
                    await executarEnvioTelegram(dadosDoPedido);
                    console.log("[TELEGRAM] Mensagem transmitida com sucesso!");
                }

                // Expurgar o registro da memória para otimização de recursos do servidor
                ordensPendentes.delete(session.id);
            } catch (telegramError) {
                console.error("Falha ao executar o envio via Telegram de dentro do Webhook:", telegramError);
            }
        } else {
            console.warn(`[Aviso] Sessão concluída (${session.id}), mas os metadados do Twilio não foram encontrados na memória.`);
        }
    }

    // Retorna status 200 obrigatório para o Stripe interromper as tentativas de reenvio
    response.json({ received: true });
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`Servidor de Mensageria e Pagamentos ativo com sucesso na porta ${PORTA}!`));