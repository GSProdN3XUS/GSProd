function normalizarValorMonetario(valor) {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;

  if (typeof valor === "string") {
    const texto = valor.trim().replace(/[^\d,.-]/g, "");
    if (!texto) return 0;

    if (texto.includes(",") && texto.includes(".")) {
      return Number(texto.replace(/\./g, "").replace(",", "."));
    }

    if (texto.includes(",")) {
      return Number(texto.replace(",", "."));
    }

    return Number(texto);
  }

  return Number(valor) || 0;
}

function obterNomeCliente(venda, usuario) {
  const nomeUsuario = usuario?.displayName?.trim() || "";
  const emailUsuario = usuario?.email || "";
  const nomeFallback = nomeUsuario || emailUsuario.split("@")[0] || "Cliente";
  return String(venda?.clienteNome || venda?.nomeCliente || nomeFallback || "Cliente").trim() || "Cliente";
}

function criarCupomPDF(venda, usuario) {
  return new Promise((resolve, reject) => {
    if (!window.jspdf?.jsPDF) {
      reject(new Error("Biblioteca de PDF não disponível no navegador."));
      return;
    }

    const { jsPDF } = window.jspdf;
    const empresa = "S PRODUTOS ORTOPÉDICOS";
    const proprietario = "GEILSON LEITE CORDEIRO - ME";
    const cnpj = "22.541.955/0001-99";
    const dataAtual = new Date().toLocaleDateString("pt-BR");
    const nomeCliente = obterNomeCliente(venda, usuario);
    const emailCliente = usuario?.email || venda?.clienteEmail || "";

    const itensVenda = Array.isArray(venda?.itens) && venda.itens.length > 0
      ? venda.itens
      : [{ nome: venda?.produtoNome || "Produto", tamanho: venda?.tamanho || "---", quantidade: venda?.quantidade || 1, valorTotal: venda?.valorTotal || 0 }];

    const linhasResumo = [];
    itensVenda.forEach((item) => {
      const nomeItem = `${item.nome || "Produto"} (${item.tamanho || "---"})`;
      const qtd = Number(item.quantidade || 1);
      const valor = normalizarValorMonetario(item.valorTotal || 0);
      linhasResumo.push({ nome: nomeItem, qtd, valor });
    });

    const subtotal = normalizarValorMonetario(venda?.subtotal ?? venda?.valorTotal ?? 0);
    const desconto = normalizarValorMonetario(venda?.desconto ?? 0);
    const frete = normalizarValorMonetario(venda?.frete ?? 0);
    const total = normalizarValorMonetario(venda?.total ?? (subtotal - desconto + frete));
    const origem = String(venda?.origem || "ex-site").toLowerCase();
    const cupomTexto = venda?.cupom && venda.cupom !== "N/A" ? String(venda.cupom) : "N/A";
    const freteTexto = frete > 0 ? `R$ ${frete.toFixed(2)}` : "N/A";
    const idVenda = String(venda?.vendaId || "---");

    const tamanhoTitulo = 14;
    const tamanhoTexto = 9;
    const lineHeight = 4.2;
    const margin = 6;
    const pageWidth = 80;
    const pageHeight = 280;
    const maxWidth = pageWidth - margin * 2;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [pageWidth, pageHeight] });

    let linhasItens = 0;
    linhasResumo.forEach((item) => {
      linhasItens += doc.splitTextToSize(`${item.qtd}x ${item.nome}`, maxWidth).length;
    });

    const alturaPagina = Math.max(
      200,
      110 + (linhasItens * lineHeight) + 40 + (4 * lineHeight) + 18 + (6 * lineHeight) + 16
    );

    doc.internal.pageSize.width = pageWidth;
    doc.internal.pageSize.height = alturaPagina;

    doc.setFillColor(255, 253, 235);
    doc.rect(0, 0, pageWidth, alturaPagina, "F");
    doc.setFont("courier", "normal");
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setLineDashPattern([1.2, 1.2], 0);

    // Topo fixo: definimos uma posição constante para o cabeçalho
    const headerY = 50;
    const rightX = pageWidth - margin;
    const qtyX = Math.round(pageWidth * 0.52);

    // Cabeçalho centralizado em Y fixo
    doc.setFont("courier", "bold");
    doc.setFontSize(tamanhoTitulo);
    doc.text("Cupom Fiscal", pageWidth / 2, headerY - 4, { align: "center" });

    doc.setFont("courier", "normal");
    doc.setFontSize(tamanhoTexto);
    doc.text(empresa, pageWidth / 2, headerY + 6, { align: "center" });
    doc.text(dataAtual, pageWidth / 2, headerY + 11, { align: "center" });

    // Linha separadora abaixo do cabeçalho
    const headerBottomY = headerY + 18;
    doc.line(margin, headerBottomY, rightX, headerBottomY);

    // Começa a listar itens a partir de uma Y fixa (sempre descendo)
    let y = headerBottomY + 16;

    doc.setFont("courier", "bold");
    doc.text("Item", margin, y);
    doc.text("Qtd", qtyX, y);
    doc.text("valor", rightX, y, { align: "right" });
    y += 3;
    doc.line(margin, y, rightX, y);
    y += 4;

    doc.setFont("courier", "normal");
    linhasResumo.forEach((item) => {
      const nomeFormatado = doc.splitTextToSize(`${item.qtd}x ${item.nome}`, maxWidth);
      nomeFormatado.forEach((linha) => {
        doc.text(linha, margin, y);
        y += lineHeight;
      });
      doc.text(`R$ ${item.valor.toFixed(2)}`, rightX, y - lineHeight, { align: "right" });
    });

    y += 2;
    doc.line(margin, y, rightX, y);
    y += 6;

    doc.text("val.desc", margin, y);
    doc.text(`-R$ ${desconto.toFixed(2)}`, rightX, y, { align: "right" });
    y += lineHeight;

    doc.text("frete", margin, y);
    doc.text(freteTexto, rightX, y, { align: "right" });
    y += lineHeight;

    doc.text("cupom", margin, y);
    doc.text(cupomTexto, rightX, y, { align: "right" });
    y += lineHeight;

    doc.line(margin, y, 75, y);
    y += 6;

    doc.setFont("courier", "bold");
    doc.setFontSize(11);
    doc.text("valor total", margin, y);
    doc.text(`R$ ${total.toFixed(2)}`, rightX, y, { align: "right" });
    y += 8;

    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    doc.text(`identificador: ${idVenda}`, margin, y);
    y += lineHeight;

    const textoOrigem = `origem: ${origem === "site" ? "site" : "ex-site"}`;
    doc.text(textoOrigem, margin, y);
    y += lineHeight;

    const textoCliente = `Cliente: ${nomeCliente}`;
    const linhasCliente = doc.splitTextToSize(textoCliente, maxWidth);
    doc.text(linhasCliente, margin, y);
    y += (linhasCliente.length * lineHeight);

    if (emailCliente) {
      const textoEmail = `Email: ${emailCliente}`;
      const linhasEmail = doc.splitTextToSize(textoEmail, maxWidth);
      doc.text(linhasEmail, margin, y);
      y += (linhasEmail.length * lineHeight);
    }

    const textoRepresentante = `representante legal: ${proprietario}`;
    const linhasRepresentante = doc.splitTextToSize(textoRepresentante, maxWidth);
    doc.text(linhasRepresentante, margin, y);
    y += (linhasRepresentante.length * lineHeight);

    doc.text(`CNPJ: ${cnpj}`, margin, y);
    y += lineHeight + 2;

    const textoObs = "OBS ---- troca realizada somente com apresentação do cupom fiscal";
    const linhasObs = doc.splitTextToSize(textoObs, maxWidth);
    doc.text(linhasObs, margin, y);

    const linhaFinalY = y + 6 + (linhasObs.length * lineHeight);
    doc.line(margin, linhaFinalY, rightX, linhaFinalY);

    doc.internal.pageSize.width = pageWidth;
    doc.internal.pageSize.height = Math.max(120, linhaFinalY + 16);

    const pdfDataUri = doc.output("datauristring");
    resolve(pdfDataUri.split(",")[1]);
  });
}

export { criarCupomPDF, obterNomeCliente };
