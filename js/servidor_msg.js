const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
require('dotenv').config();

// Carrega de forma segura as variáveis configuradas em seu arquivo oculto local .env
dotenv.config();

// Inicialização dinâmica do SDK oficial do Stripe utilizando a chave restrita do ambiente
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

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

// =================================================================
// 2. ROTA STRIPE: PROCESSAMENTO DO CARRINHO E CRIAÇÃO DO CHECKOUT
// =================================================================
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { numeroDonoLoja, variaveisConteudo, produtos, frete, desconto } = req.body;

        // Mapeamento dinâmico dos itens estruturados no Firestore para o esquema de Line Items do Stripe
        const line_items = produtos.map(item => ({
            price_data: {
                currency: 'brl',
                product_data: {
                    name: item.nome || 'Item do Carrinho',
                },
                unit_amount: Math.round((parseFloat(item.preco) || 0) * 100), // Conversão compulsória de Float para Centavos (inteiro)
            },
            quantity: parseInt(item.quantidade) || 1,
        }));

        // Injeção da taxa de entrega calculada previamente no fluxo do front-end
        if (frete && frete > 0) {
            line_items.push({
                price_data: {
                    currency: 'brl',
                    product_data: { name: 'Taxa de Entrega (Frete)' },
                    unit_amount: Math.round(frete * 100),
                },
                quantity: 1,
            });
        }

        // Geração dinâmica de Cupom de desconto no Stripe, caso haja valor elegível mitigado no carrinho
        let discounts = [];
        if (desconto && desconto > 0) {
            const coupon = await stripe.coupons.create({
                amount_off: Math.round(desconto * 100),
                currency: 'brl',
                duration: 'once',
            });
            discounts.push({ coupon: coupon.id });
        }

        // Instanciação da Checkout Session oficial do Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card' ],
             // Caso queira habilitar Pix futuramente, adicione 'pix' a este array
            line_items,
            mode: 'payment',
            discounts: discounts.length > 0 ? discounts : undefined,
            success_url: 'http://localhost:5500/index.html?pay=success', // Certifique-se de ajustar a porta conforme o seu Live Server
            cancel_url: 'http://localhost:5500/carrinho.html?pay=canceled',
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