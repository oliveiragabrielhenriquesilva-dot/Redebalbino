// Biblioteca de ícones das artes (traço, grade 64×64). Para criar um novo, acrescente aqui: aparece sozinho no painel.
const c = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const ret = (x, y, w, h, r = 4) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

// Engrenagem de 8 dentes calculada (contorno único)
function engrenagem() {
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const a = k * 45;
    for (const [r, d] of [[20, -16], [27, -9], [27, 9], [20, 16]]) {
      const t = (a + d) * Math.PI / 180;
      pts.push(`${(32 + r * Math.cos(t)).toFixed(1)} ${(32 + r * Math.sin(t)).toFixed(1)}`);
    }
  }
  return 'M' + pts.join('L') + 'z';
}

const AREAS = ['Geral e avisos', 'Educação', 'Saúde', 'Tecnologia e exatas', 'Engenharias e arquitetura', 'Negócios e gestão', 'Humanas e sociais', 'Comunicação e artes', 'Agrárias e meio ambiente', 'Esporte e bem-estar'];

const ICONES = {
  // Geral e avisos
  capelo: { area: 0, nome: 'Capelo', d: ['M4 24 32 12l28 12-28 12z', 'M15 29v12c0 5 8 9 17 9s17-4 17-9V29', 'M60 24v15', 'M60 39l-3 7h6z'] },
  diploma: { area: 0, nome: 'Diploma', d: ['M8 10h48v32H8z', 'M16 20h32', 'M16 28h20', c(44, 44, 7), 'M40 50l-3 10 7-3 7 3-3-10'] },
  calendario: { area: 0, nome: 'Calendário', d: [ret(6, 14, 52, 44), 'M6 26h52', 'M20 8v12', 'M44 8v12', 'M22 42l7 7 13-14'] },
  prancheta: { area: 0, nome: 'Prancheta', d: [ret(14, 10, 36, 50), 'M25 6h14v8H25z', 'M22 28l4 4 7-8', 'M38 29h6', 'M22 44l4 4 7-8', 'M38 45h6'] },
  boleto: { area: 0, nome: 'Boleto', d: [ret(4, 14, 56, 36), 'M13 22v20', 'M18 22v20', 'M21 22v20', 'M27 22v20', 'M31 22v20', 'M34 22v20', 'M40 22v20', 'M45 22v20', 'M48 22v20', 'M52 22v20'] },
  relogio: { area: 0, nome: 'Relógio', d: [c(32, 32, 26), 'M32 18v14l10 6'] },
  alerta: { area: 0, nome: 'Alerta', d: ['M32 6 4 56h56z', 'M32 24v14', 'M32 46v2'] },
  sino: { area: 0, nome: 'Sino', d: ['M32 6c-11 0-18 8-18 19v13l-6 8h48l-6-8V25c0-11-7-19-18-19z', 'M26 50a6 6 0 0 0 12 0'] },
  celular: { area: 0, nome: 'Celular', d: [ret(16, 4, 32, 56), 'M28 52h8', 'M28 10h8'] },
  trofeu: { area: 0, nome: 'Troféu', d: ['M20 8h24v14a12 12 0 0 1-24 0z', 'M20 12H10c0 10 4 14 10 14', 'M44 12h10c0 10-4 14-10 14', 'M32 34v12', 'M26 46h12v10H26z', 'M20 56h24'] },
  etiqueta: { area: 0, nome: 'Etiqueta de desconto', d: ['M36 6h20v20L28 54a4 4 0 0 1-6 0L10 42a4 4 0 0 1 0-6z', c(46, 16, 4), 'M23 41l14-14', c(24, 30, 3), c(36, 40, 3)] },
  checklist: { area: 0, nome: 'Lista de tarefas', d: [ret(10, 6, 44, 52), 'M18 16h7v7h-7z', 'M31 19.5h15', 'M18 29h7v7h-7z', 'M31 32.5h15', 'M18 42h7v7h-7z', 'M31 45.5h11'] },
  fogo: { area: 0, nome: 'Fogo (Esquenta)', d: ['M32 4c3 10 16 17 16 33a16 16 0 0 1-32 0c0-8 4-13 9-17 0 6 2 9 6 11-2-10-1-19 1-27z', 'M32 58a7 7 0 0 1-7-7c0-5 4-8 7-13 3 5 7 8 7 13a7 7 0 0 1-7 7z'] },
  sacola: { area: 0, nome: 'Sacola de compras (Black Friday)', d: [ret(10, 20, 44, 38), 'M22 26v-8a10 10 0 0 1 20 0v8', 'M26 48l12-14', c(27, 36, 2.5), c(37, 46, 2.5)] },
  foguete: { area: 0, nome: 'Foguete', d: ['M32 4c10 8 14 20 12 36H20C18 24 22 12 32 4z', c(32, 22, 5), 'M20 32l-8 10v8l10-6', 'M44 32l8 10v8l-10-6', 'M27 44l-3 12 8-4 8 4-3-12'] },

  // Educação
  maca: { area: 1, nome: 'Maçã', d: ['M32 22c-5-5-16-5-19 4-4 10 2 26 10 30 4 2 7 0 9-1 2 1 5 3 9 1 8-4 14-20 10-30-3-9-14-9-19-4z', 'M32 22c0-6 4-11 11-12 0 7-4 11-11 12z', 'M32 22v-6'] },
  livro: { area: 1, nome: 'Livro aberto', d: ['M32 16c-6-4-14-6-26-6v40c12 0 20 2 26 6 6-4 14-6 26-6V10c-12 0-20 2-26 6z', 'M32 16v40'] },
  lousa: { area: 1, nome: 'Lousa', d: ['M6 8h52v36H6z', 'M14 56l6-12', 'M50 56l-6-12', 'M14 18h22', 'M14 26h30', 'M14 34h14'] },
  blocos: { area: 1, nome: 'Blocos infantis', d: ['M8 34h20v22H8z', 'M36 34h20v22H36z', 'M22 8h20v22H22z', 'M27 26l5-12 5 12', 'M29 21h6', c(18, 45, 5), 'M40 50l6-11 6 11z'] },
  lapis: { area: 1, nome: 'Lápis', d: ['M44 8l12 12-32 32H12V40z', 'M38 14l12 12', 'M12 52l8-8'] },
  lampada: { area: 1, nome: 'Lâmpada', d: ['M24 44c-6-4-10-10-10-17a18 18 0 0 1 36 0c0 7-4 13-10 17v6H24z', 'M26 56h12', 'M29 61h6', 'M26 32c2-4 4-4 6 0s4 4 6 0', 'M32 34v10'] },
  museu: { area: 1, nome: 'Colunas (História)', d: ['M8 18 32 6l24 12z', 'M8 18h48', 'M14 24v24', 'M26 24v24', 'M38 24v24', 'M50 24v24', 'M8 52h48', 'M4 58h56'] },
  globo: { area: 1, nome: 'Globo (Geografia, Línguas)', d: [c(32, 32, 26), 'M6 32h52', 'M32 6c-8 7-12 16-12 26s4 19 12 26', 'M32 6c8 7 12 16 12 26s-4 19-12 26', 'M11 18h42', 'M11 46h42'] },
  matematica: { area: 1, nome: 'Sinais (Matemática)', d: ['M18 8v16', 'M10 16h16', 'M38 16h16', 'M12 40l12 12', 'M24 40 12 52', 'M38 42h16', 'M38 50h16'] },

  // Saúde
  saude: { area: 2, nome: 'Cruz da saúde', d: [c(32, 32, 26), 'M27 18h10v9h9v10h-9v9H27v-9h-9V27h9z'] },
  estetoscopio: { area: 2, nome: 'Estetoscópio', d: ['M14 6v16a12 12 0 0 0 24 0V6', 'M10 6h8', 'M34 6h8', 'M26 34v6a12 12 0 0 0 24 0v-5', c(50, 30, 5)] },
  coracao_saude: { area: 2, nome: 'Coração com pulso', d: ['M32 54S8 40 8 24a12 12 0 0 1 24-5 12 12 0 0 1 24 5c0 16-24 30-24 30z', 'M18 32h8l3-6 5 12 3-6h9'] },
  dente: { area: 2, nome: 'Dente (Odontologia)', d: ['M20 8c-8 0-12 6-12 14 0 6 3 10 5 16 2 7 3 18 8 18 4 0 4-12 7-16 2-3 6-3 8 0 3 4 3 16 7 16 5 0 6-11 8-18 2-6 5-10 5-16 0-8-4-14-12-14-5 0-8 3-12 3S25 8 20 8z'] },
  pilula: { area: 2, nome: 'Cápsula (Farmácia)', d: ['M14 42 42 14a10 10 0 0 1 14 14L28 56a10 10 0 0 1-14-14z', 'M28 28l14 14'] },
  frasco: { area: 2, nome: 'Frasco (Química, Farmácia)', d: ['M24 6h16', 'M27 6v18L12 52c-2 4 0 6 4 6h32c4 0 6-2 4-6L37 24V6', 'M18 42h28'] },
  microscopio: { area: 2, nome: 'Microscópio (Biomedicina)', d: ['M24 6h8v20h-8z', 'M28 26v6', 'M18 36h20', 'M36 14c10 2 16 10 16 20 0 10-7 18-16 20', 'M12 56h40', 'M28 36v14', 'M22 50h20'] },
  cerebro: { area: 2, nome: 'Cérebro (Psicologia)', d: ['M30 10c-4-4-12-2-12 4-6 0-10 6-7 11-5 3-5 11 1 14-1 6 5 11 11 9 1 4 4 6 7 6V10z', 'M34 10c4-4 12-2 12 4 6 0 10 6 7 11 5 3 5 11-1 14 1 6-5 11-11 9-1 4-4 6-7 6V10z'] },
  gota: { area: 2, nome: 'Gota (Estética, Nutrição)', d: ['M32 6c10 14 18 24 18 34a18 18 0 0 1-36 0c0-10 8-20 18-34z', 'M24 42a8 8 0 0 0 8 8'] },
  maca_nutri: { area: 2, nome: 'Prato (Nutrição)', d: [c(32, 32, 20), c(32, 32, 12), 'M4 10v12a4 4 0 0 0 4 4v28', 'M8 10v12', 'M60 10c-4 0-6 6-6 14h6v30'] },

  // Tecnologia e exatas
  computador: { area: 3, nome: 'Computador (código)', d: [ret(5, 12, 54, 35, 3), 'M24 56h16', 'M32 47v9', 'M24 26l-6 5 6 5', 'M40 26l6 5-6 5', 'M35 23l-6 16'] },
  nuvem: { area: 3, nome: 'Nuvem', d: ['M18 48h30c6 0 10-5 10-10s-4-10-10-10c-1-9-8-14-16-14-7 0-13 5-15 12-6 1-11 6-11 11 0 6 5 11 12 11z'] },
  banco_dados: { area: 3, nome: 'Banco de dados', d: ['M10 14a22 7 0 1 0 44 0a22 7 0 1 0-44 0', 'M10 14v36c0 4 10 7 22 7s22-3 22-7V14', 'M10 26c0 4 10 7 22 7s22-3 22-7', 'M10 38c0 4 10 7 22 7s22-3 22-7'] },
  robo: { area: 3, nome: 'Robô (IA, automação)', d: [ret(10, 20, 44, 32), 'M32 20v-8', c(32, 9, 3), c(23, 34, 4), c(41, 34, 4), 'M24 44h16', 'M4 32v8', 'M60 32v8'] },
  rede: { area: 3, nome: 'Rede (Wi-Fi)', d: ['M8 26c14-12 34-12 48 0', 'M16 34c9-8 23-8 32 0', 'M24 42c5-4 11-4 16 0', c(32, 50, 3)] },
  controle: { area: 3, nome: 'Controle (Jogos digitais)', d: ['M18 18h28c8 0 12 8 13 18 1 10-2 16-7 16-4 0-6-4-9-8H21c-3 4-5 8-9 8-5 0-8-6-7-16 1-10 5-18 13-18z', 'M18 28v10', 'M13 33h10', c(44, 30, 2), c(48, 36, 2)] },
  atomo: { area: 3, nome: 'Átomo (Física, Ciências)', d: [c(32, 32, 4), 'M8 32a24 10 0 1 0 48 0a24 10 0 1 0-48 0', 'M20 11.2a24 10 60 1 0 24 41.6a24 10 60 1 0-24-41.6', 'M44 11.2a24 10 -60 1 0-24 41.6a24 10 -60 1 0 24-41.6'] },
  raio: { area: 3, nome: 'Raio (Elétrica, energia)', d: ['M36 4 12 36h18l-4 24 26-34H34z'] },

  // Engenharias e arquitetura
  engrenagem: { area: 4, nome: 'Engrenagem', d: [engrenagem(), c(32, 32, 8)] },
  capacete: { area: 4, nome: 'Capacete (Segurança do trabalho)', d: ['M6 44h52v6H6z', 'M11 44c0-14 9-24 21-24s21 10 21 24', 'M27 20v-6h10v6', 'M23 22v14', 'M41 22v14'] },
  esquadro: { area: 4, nome: 'Esquadro (Arquitetura)', d: ['M8 56V8l48 48z', 'M18 46V32l14 14z', 'M8 18h6', 'M8 28h6', 'M8 38h6'] },
  predio: { area: 4, nome: 'Prédio (Civil)', d: ['M10 58V14l22-8v52', 'M32 22l22 6v30', 'M6 58h52', 'M18 22h6', 'M18 32h6', 'M18 42h6', 'M40 36h6', 'M40 46h6'] },
  fabrica: { area: 4, nome: 'Fábrica (Produção)', d: ['M4 58V30l14 8v-8l14 8v-8l14 8V10h10v48z', 'M2 58h60', 'M12 48h6', 'M26 48h6', 'M40 48h6'] },
  casa: { area: 4, nome: 'Casa (Imobiliária, Design de interiores)', d: ['M6 30 32 8l26 22', 'M12 26v30h40V26', 'M26 56V40h12v16'] },

  // Negócios e gestão
  grafico: { area: 5, nome: 'Gráfico em alta', d: ['M8 56h48', 'M14 56V44', 'M26 56V36', 'M38 56V40', 'M50 56V28', 'M12 34l12-12 9 8 17-16', 'M42 14h8v8'] },
  maleta: { area: 5, nome: 'Maleta (Administração)', d: [ret(6, 20, 52, 34), 'M24 20v-8h16v8', 'M6 34h52', 'M28 34v6h8v-6'] },
  moeda: { area: 5, nome: 'Moeda (Finanças, Contábeis)', d: [c(32, 32, 26), 'M40 22c-2-3-5-4-8-4-5 0-8 3-8 6 0 8 16 5 16 13 0 4-4 7-8 7-4 0-7-2-9-5', 'M32 12v6', 'M32 46v6'] },
  calculadora: { area: 5, nome: 'Calculadora (Contábeis)', d: [ret(12, 4, 40, 56), 'M18 12h28v12H18z', 'M20 34h4', 'M30 34h4', 'M40 34h4', 'M20 43h4', 'M30 43h4', 'M40 43h4', 'M20 52h4', 'M30 52h4', 'M40 52h4'] },
  carrinho: { area: 5, nome: 'Carrinho (Comércio, Vendas)', d: ['M4 10h8l6 32h32l6-22H15', c(22, 52, 4), c(46, 52, 4)] },
  caminhao: { area: 5, nome: 'Caminhão (Logística)', d: ['M4 16h34v28H4z', 'M38 26h12l8 10v8H38', c(16, 48, 5), c(46, 48, 5)] },
  pessoas: { area: 5, nome: 'Pessoas (RH, Gestão de pessoas)', d: [c(22, 22, 8), c(42, 22, 8), 'M6 54c0-10 7-16 16-16s16 6 16 16', 'M30 41c3-2 7-3 12-3 9 0 16 6 16 16'] },
  alvo: { area: 5, nome: 'Alvo (Metas, Marketing)', d: [c(32, 32, 24), c(32, 32, 15), c(32, 32, 6), 'M32 32 54 10', 'M48 10h6v6'] },
  aviao: { area: 5, nome: 'Avião (Turismo, Aviação)', d: ['M30 6c2-2 6 0 6 4v16l20 12v6l-20-6v12l6 4v4l-10-3-10 3v-4l6-4V38L8 44v-6l20-12V10c0-2 0-3 2-4z'] },

  // Humanas e sociais
  balanca: { area: 6, nome: 'Balança (Direito)', d: ['M32 8v46', 'M20 56h24', 'M10 16h44', 'M10 16 3 32h14z', 'M54 16l-7 16h14z', 'M3 32c0 4 3 6 7 6s7-2 7-6', 'M47 32c0 4 3 6 7 6s7-2 7-6'] },
  coracao: { area: 6, nome: 'Coração (Serviço social)', d: ['M32 54S8 40 8 24a12 12 0 0 1 24-5 12 12 0 0 1 24 5c0 16-24 30-24 30z'] },
  escudo: { area: 6, nome: 'Escudo (Segurança pública)', d: ['M32 6 10 14v16c0 14 10 24 22 28 12-4 22-14 22-28V14z', 'M22 32l7 7 13-14'] },
  lupa: { area: 6, nome: 'Lupa (Investigação, Pesquisa)', d: [c(26, 26, 18), 'M39 39l17 17'] },
  teologia: { area: 6, nome: 'Cruz (Teologia)', d: ['M28 6h8v14h12v8H36v30h-8V28H16v-8h12z'] },

  // Comunicação e artes
  megafone: { area: 7, nome: 'Megafone', d: ['M8 26v12h9l22 11V15L17 26z', 'M17 38l4 14h7l-3-13', 'M47 25c3 3 3 11 0 14', 'M53 19c6 6 6 20 0 26'] },
  microfone: { area: 7, nome: 'Microfone (Jornalismo, Rádio)', d: ['M32 4a8 8 0 0 1 8 8v16a8 8 0 0 1-16 0V12a8 8 0 0 1 8-8z', 'M16 28a16 16 0 0 0 32 0', 'M32 44v12', 'M22 56h20'] },
  camera: { area: 7, nome: 'Câmera (Fotografia)', d: ['M8 20h12l4-6h16l4 6h12v32H8z', c(32, 35, 10)] },
  paleta: { area: 7, nome: 'Paleta (Artes, Design)', d: ['M32 6C17 6 6 17 6 30c0 13 10 22 22 22 4 0 6-2 6-5 0-4-3-5-3-8 0-3 2-5 6-5h7c9 0 14-5 14-12C58 12 46 6 32 6z', c(20, 24, 3), c(30, 16, 3), c(42, 18, 3), c(48, 28, 3)] },
  musica: { area: 7, nome: 'Nota musical (Música)', d: ['M24 48V14l28-6v34', c(18, 48, 6), c(46, 42, 6), 'M24 24l28-6'] },
  cabide: { area: 7, nome: 'Cabide (Moda)', d: ['M32 16a5 5 0 1 1 5 5c-3 0-5 2-5 5', 'M32 26 6 46c-2 2-1 4 2 4h48c3 0 4-2 2-4z'] },
  tesoura: { area: 7, nome: 'Tesoura (Moda, Estética)', d: [c(14, 48, 6), c(14, 16, 6), 'M19 44 56 12', 'M19 20l37 32'] },
  chef: { area: 7, nome: 'Chapéu de chef (Gastronomia)', d: ['M18 36c-6 0-10-4-10-10s5-10 11-9c2-6 7-9 13-9s11 3 13 9c6-1 11 3 11 9s-4 10-10 10', 'M18 36v18h28V36', 'M18 46h28'] },

  // Agrárias e meio ambiente
  folha: { area: 8, nome: 'Folha (Biologia, Ambiental)', d: ['M12 52C12 26 28 10 54 10c0 26-16 42-42 42z', 'M12 52 40 24'] },
  broto: { area: 8, nome: 'Broto (Agronomia)', d: ['M32 58V30', 'M32 34c0-10-8-16-18-16 0 10 8 16 18 16z', 'M32 28c0-10 8-16 18-16 0 10-8 16-18 16z', 'M20 58h24'] },
  pata: { area: 8, nome: 'Pata (Veterinária)', d: ['M32 34c-8 0-14 8-14 14 0 5 4 8 8 7 3-1 4-2 6-2s3 1 6 2c4 1 8-2 8-7 0-6-6-14-14-14z', c(14, 28, 5), c(24, 16, 5), c(40, 16, 5), c(50, 28, 5)] },

  // Esporte e bem-estar
  cronometro: { area: 9, nome: 'Cronômetro', d: [c(32, 38, 20), 'M32 38V27', 'M26 8h12', 'M32 8v10', 'M49 21l4-4'] },
  halteres: { area: 9, nome: 'Halteres', d: ['M14 32h36', 'M8 22h6v20H8z', 'M50 22h6v20h-6z', 'M2 26h6v12H2z', 'M56 26h6v12h-6z'] },
  bola: { area: 9, nome: 'Bola', d: [c(32, 32, 24), 'M8 32h48', 'M32 8v48', 'M15 15c6 6 6 28 0 34', 'M49 15c-6 6-6 28 0 34'] }
};

function iconeSVG(chave, cor = '#00D0FF', tamanho = '100%') {
  const ic = ICONES[chave] || ICONES.capelo;
  return `<svg viewBox="0 0 64 64" width="${tamanho}" height="${tamanho}" fill="none" stroke="${cor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${ic.d.map(d => `<path d="${d}"/>`).join('')}</svg>`;
}

// Sugestão de ícone pelo nome do curso (a ordem importa: o mais específico vem primeiro)
const REGRAS = [
  [/criminolog/, 'lupa'], [/cinema|audiovisual/, 'camera'], [/bibliotec/, 'livro'], [/gestão pública|administração pública/, 'museu'], [/comunicação/, 'megafone'],
  [/espectro autista|\btea\b/, 'pessoas'], [/psicoped/, 'lampada'],
 [/pedagog|educação infantil/, 'maca'], [/letras|português|inglês|espanhol|libras/, 'livro'],
  [/educação física|esporte|personal/, 'cronometro'], [/história/, 'museu'], [/geografia|relações internacionais|comércio exterior/, 'globo'],
  [/matemática|estatística/, 'matematica'], [/física(?! )|ciências exatas/, 'atomo'], [/química/, 'frasco'], [/filosofia|sociologia|ciências sociais/, 'lampada'],
  [/veterin|zootec/, 'pata'], [/engenharia de software|engenharia de computação/, 'computador'], [/odonto/, 'dente'], [/farmác/, 'pilula'], [/enfermagem|medicina|radiologia/, 'estetoscopio'], [/biomedic|análises clínicas|ciências biológicas|biologia/, 'microscopio'],
  [/psicolog|neuro/, 'cerebro'], [/nutri/, 'maca_nutri'], [/estética|cosmét|podologia/, 'gota'], [/fisioterap|saúde|gerontologia/, 'coracao_saude'],
  [/veterin|zootec/, 'pata'], [/agronom|agronegócio|agrícola/, 'broto'], [/ambiental|sustentab|florest/, 'folha'],
  [/segurança do trabalho|segurança no trabalho/, 'capacete'], [/segurança pública|segurança privada|criminal/, 'escudo'], [/investigação|perícia/, 'lupa'],
  [/arquitet|urbanis/, 'esquadro'], [/engenharia civil|construção|edificações/, 'predio'], [/elétric|energia|eletrônica/, 'raio'], [/produção|industrial/, 'fabrica'],
  [/engenharia|mecânica|automação|mecatrônica/, 'engrenagem'], [/imobiliár|interiores/, 'casa'],
  [/inteligência artificial|robótica/, 'robo'], [/jogos|games/, 'controle'], [/redes de computadores|telecom/, 'rede'], [/dados|big data|banco de dados/, 'banco_dados'],
  [/nuvem|cloud/, 'nuvem'], [/sistemas|computa|software|tecnologia da informação|programação|\bti\b|análise e desenvolvimento|segurança da informação|cibersegurança/, 'computador'],
  [/direito|jurídic|serviços jurídicos/, 'balanca'], [/serviço social|assistência/, 'coracao'], [/teologia|ciências da religião/, 'teologia'],
  [/jornalismo|rádio|tv|produção audiovisual/, 'microfone'], [/fotografia/, 'camera'], [/música/, 'musica'], [/moda/, 'cabide'],
  [/design|artes visuais|artes/, 'paleta'], [/gastronomia|cozinha/, 'chef'], [/turismo|aviação|aeronáut|hotelaria|eventos/, 'aviao'],
  [/marketing|publicidade|propaganda/, 'megafone'], [/logística/, 'caminhao'], [/contáb|controladoria/, 'calculadora'], [/financ|economia|banc|seguros/, 'moeda'],
  [/recursos humanos|gestão de pessoas|\brh\b/, 'pessoas'], [/comercial|vendas|varejo|comércio/, 'carrinho'], [/empreendedor|startup|inovação/, 'foguete'],
  [/administra|gestão|negócios|secretariado|processos/, 'maleta']
];
function sugerirIcone(nomeCurso) {
  const n = String(nomeCurso || '').toLowerCase().normalize('NFC');
  const r = REGRAS.find(([re]) => re.test(n));
  return r ? r[1] : 'capelo';
}

module.exports = { ICONES, AREAS, iconeSVG, sugerirIcone };
