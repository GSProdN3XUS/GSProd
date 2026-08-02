const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Carrega de forma segura as variáveis configuradas em seu arquivo oculto local .env
dotenv.config();

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

// Estrutura de armazenamento volátil em memória (Map) para vincular os dados da Ordem de Serviço (Twilio) 
// ao ID único de checkout do Stripe até que o evento assíncrono de pagamento ocorra.
const ordensPendentes = new Map();

/**
 * Função Auxiliar Centralizada do Twilio
 * Preserva integralmente a sua lógica original de envio do WhatsApp, centralizando-a para reutilização segura.
 */
async function executarEnvioWhatsAppTwilio(numeroDonoLoja, variaveisConteudo) {
    // Inicialização direta utilizando os tokens do seu .env para máxima portabilidade
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    const dados = JSON.parse(variaveisConteudo);
    const corpoMensagem = dados["2"] || "Nova Ordem de Serviço Registrada.";

    // Disparo oficial via API do Twilio para o canal WhatsApp Sandbox ou Conta Comercial
    const remetente = process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886';
    
    await client.messages.create({
        from: `whatsapp:${remetente.replace('whatsapp:', '')}`,
        to: `whatsapp:+${numeroDonoLoja.replace('+', '')}`,
        body: corpoMensagem
    });
}

// =================================================================
// 1. ROTA ORIGINAL (MANTIDA INTACTA PARA SUPORTE E COMPATIBILIDADE)
// =================================================================
app.post('/enviar-ordem-servico', async (req, res) => {
    try {
        const { numeroDonoLoja, variaveisConteudo } = req.body;
        
        // Executa exatamente a lógica que você já validou anteriormente
        await executarEnvioWhatsAppTwilio(numeroDonoLoja, variaveisConteudo);
        
        return res.json({ sucesso: true });
    } catch (error) {
        console.error("Erro na rota legado do Twilio:", error);
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

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card' ],
            line_items,
            mode: 'payment',
            discounts: discounts.length > 0 ? discounts : undefined,
            allow_promotion_codes: true,
            metadata: {
                subtotal: String(subtotalRecebido || totalRecebido || 0),
                desconto: String(descontoRecebido),
                frete: String(freteRecebido),
                total: String(valorTotalCheckout),
            },
            success_url: 'http://127.0.0.1:5500/index.html?pay=success',
            cancel_url: 'http://127.0.0.1:5500/carrinho.html?pay=canceled',
        });

        // RETENÇÃO ESTRATÉGICA: Vincula o ID exclusivo da sessão de pagamento aos metadados do Twilio na memória.
        // Isso assegura que a mensagem do WhatsApp só será transmitida quando o status mudar para concluído.
        ordensPendentes.set(session.id, { numeroDonoLoja, variaveisConteudo });

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
            const { numeroDonoLoja, variaveisConteudo } = dadosDoPedido;

            try {
                console.log(`[STRIPE] Pagamento verificado com sucesso para a sessão: ${session.id}`);
                console.log("[TWILIO] Iniciando disparo seguro da Ordem de Serviço para o WhatsApp da loja...");

                // Aciona a sua lógica consagrada do Twilio de forma totalmente segura e assíncrona
                await executarEnvioWhatsAppTwilio(numeroDonoLoja, variaveisConteudo);

                console.log("[TWILIO] Mensagem transmitida com sucesso!");

                // Expurgar o registro da memória para otimização de recursos do servidor
                ordensPendentes.delete(session.id);

            } catch (twilioError) {
                console.error("Falha ao executar o módulo do Twilio de dentro do Webhook:", twilioError);
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