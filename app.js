// =========================================================
// Dory — funcionamento do app
// Partes deste arquivo (procure pelos títulos em CAIXA ALTA):
//   1. CONEXÃO COM O FIREBASE
//   2. ESTADO DO APP (o que está aberto, listas carregadas)
//   3. FUNÇÕES DE APOIO (datas, textos, ícones)
//   4. LOGIN
//   5. LEITURA DOS DADOS EM TEMPO REAL
//   6. AÇÕES (salvar, concluir, apagar, desfazer)
//   7. TELAS (desenho de cada tela)
//   8. CLIQUES E GESTOS
// =========================================================

// ---------- 1. CONEXÃO COM O FIREBASE ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB6WEmIHtabZA6x3Ovn417mN6GqDF0IYzs",
  authDomain: "dory-3636c.firebaseapp.com",
  projectId: "dory-3636c",
  storageBucket: "dory-3636c.firebasestorage.app",
  messagingSenderId: "238140467749",
  appId: "1:238140467749:web:029f56d1cd61495beeedcc"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// "persistentLocalCache" = guarda uma cópia dos dados no celular.
// É isso que faz o Dory funcionar sem internet.
let db;
try {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true });
}

// ---------- 2. ESTADO DO APP ----------
const S = {
  usuario: null,          // quem está logado
  semAcesso: false,       // logou com e-mail que não está na lista
  erroLogin: "",
  carregando: true,
  pessoas: [],            // Hugo e Vanessa (coleção "pessoas")
  itens: [],              // pendências e compras (coleção "itens")
  categorias: [],         // lugares de compra (coleção "categorias")
  sugestoes: [],          // itens já comprados antes (coleção "sugestoes")
  aba: lerLocal("aba", "pendencias"),
  filtro: "todas",
  verFeitos: false,
  form: null,             // formulário de item aberto
  sobre: null,            // página aberta por cima: form | config | mercado | importar
  folha: null,            // janela que sobe de baixo
  mercado: { sel: lerLocal("lugaresMercado", null), verOutros: false },
  importar: null,
  limpezaFeita: false,
};

let fotosCache = {};      // fotos já baixadas, para não baixar de novo
let avisoTimer = null;
let travaTela = null;     // "tela sempre acesa" do modo compras
let instalarEvento = null;
let compartilhado = lerCompartilhado();

// ---------- 3. FUNÇÕES DE APOIO ----------
function lerLocal(chave, padrao) {
  try { const v = localStorage.getItem("dory." + chave); return v === null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
}
function gravarLocal(chave, valor) {
  try { localStorage.setItem("dory." + chave, JSON.stringify(valor)); } catch (e) { /* sem espaço: ignora */ }
}
function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function normalizar(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function maiuscula(t) { t = String(t || "").trim(); return t.charAt(0).toUpperCase() + t.slice(1); }
function novoId(colecao) { return doc(collection(db, colecao)).id; }
function agora() { return Date.now(); }

// Datas no formato "AAAA-MM-DD" (fácil de ordenar)
function isoDe(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function hojeISO() { return isoDe(new Date()); }
function dataDe(iso) { const [a, m, d] = iso.split("-").map(Number); return new Date(a, m - 1, d); }
function ddmm(iso) { const [, m, d] = iso.split("-"); return `${d}/${m}`; }
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DIAS_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function dataExtensa() { const d = new Date(); return `${maiuscula(DIAS[d.getDay()])}, ${d.getDate()} de ${MESES[d.getMonth()]}`; }
function somarMeses(data, n, diaDesejado) {
  const r = new Date(data.getFullYear(), data.getMonth() + n, 1);
  const ultimo = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(diaDesejado, ultimo));
  return r;
}

// Próxima data de uma pendência que se repete
function proximaData(rep, base) {
  const b = dataDe(base || hojeISO());
  if (rep.tipo === "dia") { b.setDate(b.getDate() + 1); return isoDe(b); }
  if (rep.tipo === "semana") {
    const alvo = rep.diaSemana ?? b.getDay();
    const d = new Date(b); d.setDate(d.getDate() + 1);
    while (d.getDay() !== alvo) d.setDate(d.getDate() + 1);
    return isoDe(d);
  }
  if (rep.tipo === "mes") return isoDe(somarMeses(b, 1, rep.diaMes || b.getDate()));
  if (rep.tipo === "meses") return isoDe(somarMeses(b, rep.cadaMeses || 1, b.getDate()));
  return null;
}
// Primeira data quando a pessoa liga "repetir" sem escolher data
function primeiraData(rep) {
  const h = dataDe(hojeISO());
  if (rep.tipo === "dia") return isoDe(h);
  if (rep.tipo === "semana") { const d = new Date(h); while (d.getDay() !== rep.diaSemana) d.setDate(d.getDate() + 1); return isoDe(d); }
  if (rep.tipo === "mes") {
    const ult = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
    const dEste = new Date(h.getFullYear(), h.getMonth(), Math.min(rep.diaMes, ult));
    return isoDe(dEste >= h ? dEste : somarMeses(h, 1, rep.diaMes));
  }
  if (rep.tipo === "meses") return isoDe(somarMeses(h, rep.cadaMeses || 1, h.getDate()));
  return null;
}
function textoRepetir(rep) {
  if (!rep || rep.tipo === "nao") return "";
  if (rep.tipo === "dia") return "Todo dia";
  if (rep.tipo === "semana") return "Toda " + DIAS[rep.diaSemana ?? 1];
  if (rep.tipo === "mes") return "Todo dia " + rep.diaMes;
  if (rep.tipo === "meses") return `A cada ${rep.cadaMeses} ${rep.cadaMeses > 1 ? "meses" : "mês"}`;
  return "";
}

// Pessoas
function eu() { return S.usuario?.email?.toLowerCase(); }
function pessoa(email) { return S.pessoas.find(p => p.email === email); }
function nomeDe(email) {
  if (!email) return "";
  if (email === "qualquer") return "Qualquer um";
  const p = pessoa(email);
  if (p) return p.nome;
  return email === eu() ? primeiroNome(S.usuario) : email.split("@")[0];
}
function primeiroNome(u) { return maiuscula((u?.displayName || u?.email || "").split(/[ @]/)[0]); }
function outraPessoa() { return S.pessoas.find(p => p.email !== eu()); }
function categoria(id) { return S.categorias.find(c => c.id === id); }
function categoriasOrdenadas() { return [...S.categorias].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome)); }

// Ícones (desenhos em SVG, sem precisar de imagens)
const ICONES = {
  carrinho: '<path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  farmacia: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  ferramenta: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  pata: '<circle cx="5.5" cy="11" r="2"/><circle cx="9.5" cy="6.5" r="2"/><circle cx="14.5" cy="6.5" r="2"/><circle cx="18.5" cy="11" r="2"/><path d="M12 12c-3 0-6 4-5 6.5 1 2 3.5 1 5 1s4 1 5-1c1-2.5-2-6.5-5-6.5z"/>',
  pao: '<path d="M5 10a4 4 0 0 1 1-7.5c2-.8 4 0 6 0s4-.8 6 0A4 4 0 0 1 19 10v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/>',
  folha: '<path d="M11 20A7 7 0 0 1 4 13c0-6 6-9 16-9 0 10-3 16-9 16z"/><path d="M4 21c4-5 7-8 12-11"/>',
  casa: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  presente: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8c-2-4-6-4-6-1.5S10 8 12 8zm0 0c2-4 6-4 6-1.5S14 8 12 8z"/>',
  camisa: '<path d="M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
  sacola: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  // ícones de interface
  mais: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  voltar: '<path d="M15 6l-6 6 6 6"/>',
  seta: '<path d="M9 6l6 6-6 6"/>',
  baixo: '<path d="M6 9l6 6 6-6"/>',
  cima: '<path d="M6 15l6-6 6 6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  imagem: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  balao: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  repetir: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  lapis: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  semNet: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.3-1.6M12 20h.01"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  baixar: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
};
const ICONES_LUGAR = ["carrinho", "farmacia", "ferramenta", "pata", "pao", "folha", "casa", "presente", "camisa", "sacola"];
function ic(nome, tam = 20, cor = "currentColor", esp = 2) {
  return `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="${esp}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ICONES.sacola}</svg>`;
}
const LOGO = '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4 4 10-10"/><circle cx="18.5" cy="17.5" r="1.6"/><circle cx="15" cy="20.5" r="1"/></svg>';
const GOOGLE = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

// Texto recebido pelo "Compartilhar" do celular (ex.: do WhatsApp)
function lerCompartilhado() {
  const p = new URLSearchParams(location.search);
  const partes = [p.get("titulo"), p.get("texto"), p.get("link")].filter(Boolean);
  if (!partes.length) return null;
  history.replaceState(null, "", location.pathname);
  return partes.join("\n");
}

// Separa um texto em vários itens: "tomate, cebola e alho" -> 3 itens
function separarItens(texto) {
  const itens = [];
  String(texto || "").split(/\n+/).forEach(linha => {
    let l = linha.trim();
    if (l.includes(":")) { const depois = l.slice(l.lastIndexOf(":") + 1).trim(); if (depois) l = depois; else return; }
    l.split(/[,;]|\s+e\s+|\s+mais\s+/i).forEach(parte => {
      let t = parte.replace(/^[\s\-•*·–]+/, "").replace(/^\d+[.)]\s+/, "").replace(/[.!]+$/, "").trim();
      t = t.replace(/^(comprar|compra|preciso de|precisa de|pegar)\s+/i, "");
      if (t && t.length <= 80) itens.push(maiuscula(t));
    });
  });
  return itens;
}

// ---------- 4. LOGIN ----------
async function entrar() {
  S.erroLogin = "";
  const provedor = new GoogleAuthProvider();
  provedor.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provedor);
  } catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
      await signInWithRedirect(auth, provedor);
    } else if (e.code !== "auth/popup-closed-by-user") {
      S.erroLogin = "Não foi possível entrar (" + e.code + "). Tente de novo.";
      desenharTela();
    }
  }
}
async function sairDaConta() {
  pararEscutas();
  S.sobre = null; S.folha = null; S.form = null;
  await signOut(auth);
}
getRedirectResult(auth).catch(e => { S.erroLogin = "Não foi possível entrar (" + e.code + ")."; });

onAuthStateChanged(auth, async (user) => {
  S.usuario = user;
  S.semAcesso = false;
  S.carregando = !!user;
  if (!user) { pararEscutas(); desenharTudo(); return; }
  desenharTudo();
  try {
    await setDoc(doc(db, "pessoas", eu()), { email: eu(), nome: primeiroNome(user), foto: user.photoURL || "" }, { merge: true });
  } catch (e) {
    if (e.code === "permission-denied") { mostrarSemAcesso(); return; }
  }
  iniciarEscutas();
});

function mostrarSemAcesso() {
  pararEscutas();
  S.semAcesso = true; S.carregando = false;
  desenharTudo();
}

// ---------- 5. LEITURA DOS DADOS EM TEMPO REAL ----------
let escutas = [];
function pararEscutas() { escutas.forEach(f => f()); escutas = []; }
function aoErro(e) { if (e.code === "permission-denied") mostrarSemAcesso(); else console.error(e); }

function iniciarEscutas() {
  pararEscutas();
  escutas.push(onSnapshot(collection(db, "itens"), snap => {
    S.itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.carregando = false;
    if (!S.limpezaFeita && !snap.metadata.fromCache) { S.limpezaFeita = true; limparAntigos(); }
    desenharTela();
    if (S.sobre === "mercado") desenharSobre();
    S.itensProntos = true; abrirCompartilhado();
  }, aoErro));
  escutas.push(onSnapshot(collection(db, "categorias"), snap => {
    S.categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!snap.docs.length && !snap.metadata.fromCache) criarCategoriasIniciais();
    desenharTela();
    if (S.sobre === "config" || S.sobre === "mercado" || S.sobre === "importar") desenharSobre();
    if (snap.docs.length) { S.categoriasProntas = true; abrirCompartilhado(); }
  }, aoErro));
  escutas.push(onSnapshot(collection(db, "pessoas"), snap => {
    S.pessoas = snap.docs.map(d => d.data()).sort((a, b) => (a.email === eu() ? -1 : b.email === eu() ? 1 : 0));
    desenharTela();
  }, aoErro));
  escutas.push(onSnapshot(collection(db, "sugestoes"), snap => {
    S.sugestoes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }, aoErro));
}

function abrirCompartilhado() {
  if (!compartilhado || !S.itensProntos || !S.categoriasProntas) return;
  const texto = compartilhado; compartilhado = null;
  abrirImportar(texto, "compartilhado");
}

function criarCategoriasIniciais() {
  setDoc(doc(db, "categorias", "mercado"), { nome: "Mercado", icone: "carrinho", ordem: 1 });
  setDoc(doc(db, "categorias", "farmacia"), { nome: "Farmácia", icone: "farmacia", ordem: 2 });
}

// Pendências concluídas há mais de 30 dias são apagadas para a lista não crescer para sempre
function limparAntigos() {
  const limite = agora() - 30 * 24 * 3600 * 1000;
  S.itens.filter(i => i.tipo === "pendencia" && i.feito && (i.feitoEm || 0) < limite).forEach(i => apagarDeVez(i));
}

// ---------- 6. AÇÕES ----------
function gravar(promessa) { promessa.catch(e => { if (e.code === "permission-denied") mostrarSemAcesso(); else console.error(e); }); }
function item(id) { return S.itens.find(i => i.id === id); }

function mostrarAviso(texto, desfazer) {
  clearTimeout(avisoTimer);
  const el = document.getElementById("aviso");
  el.innerHTML = `<div class="aviso" role="status"><span>${esc(texto)}</span>${desfazer ? '<button data-acao="desfazer">Desfazer</button>' : ""}</div>`;
  el._desfazer = desfazer || null;
  avisoTimer = setTimeout(() => { el.innerHTML = ""; el._desfazer = null; if (el._depois) { el._depois(); el._depois = null; } }, 5500);
}
function aoFimDoAviso(fn) { document.getElementById("aviso")._depois = fn; }

function apagarDeVez(i) {
  gravar(deleteDoc(doc(db, "itens", i.id)));
  if (i.temFoto) gravar(deleteDoc(doc(db, "fotos", i.id)));
}

function alternarFeito(id) {
  const i = item(id); if (!i) return;
  const marcar = !i.feito;
  const mud = marcar ? { feito: true, feitoEm: agora(), feitoPor: eu() } : { feito: false, feitoEm: null, feitoPor: null };
  gravar(updateDoc(doc(db, "itens", id), mud));
  // compra ligada a uma pendência: avisa a pendência
  if (i.tipo === "compra" && i.pendenciaId && item(i.pendenciaId)) {
    gravar(updateDoc(doc(db, "itens", i.pendenciaId), { compraStatus: marcar ? "comprado" : "falta" }));
  }
  let proximaId = null;
  // pendência que se repete: cria a próxima
  if (i.tipo === "pendencia" && marcar && i.repetir && i.repetir.tipo !== "nao") {
    proximaId = novoId("itens");
    const { id: _x, feito, feitoEm, feitoPor, temFoto, ...resto } = i;
    const prox = { ...resto, feito: false, criadoEm: agora(), dataLimite: proximaData(i.repetir, i.dataLimite), temFoto: false };
    gravar(setDoc(doc(db, "itens", proximaId), prox));
  }
  if (i.tipo === "pendencia" && marcar) {
    mostrarAviso(proximaId ? `Concluída. A próxima ficou para ${ddmm(proximaData(i.repetir, i.dataLimite))}` : `"${i.titulo}" foi concluída`, () => {
      gravar(updateDoc(doc(db, "itens", id), { feito: false, feitoEm: null, feitoPor: null }));
      if (proximaId) gravar(deleteDoc(doc(db, "itens", proximaId)));
    });
  }
}

function apagarComDesfazer(id) {
  const i = item(id); if (!i) return;
  const { id: _x, ...dados } = i;
  gravar(deleteDoc(doc(db, "itens", id)));
  let desfeito = false;
  mostrarAviso(`"${i.titulo}" foi apagado`, () => { desfeito = true; gravar(setDoc(doc(db, "itens", id), dados)); });
  aoFimDoAviso(() => { if (!desfeito && i.temFoto) gravar(deleteDoc(doc(db, "fotos", id))); });
}

function limparComprados(ids) {
  const lista = ids.map(item).filter(Boolean);
  if (!lista.length) return;
  const lote = writeBatch(db);
  lista.forEach(i => { lote.delete(doc(db, "itens", i.id)); if (i.temFoto) lote.delete(doc(db, "fotos", i.id)); });
  gravar(lote.commit());
}

function lembrarSugestao(titulo, quantidade, categoriaId) {
  const chave = normalizar(titulo).replace(/[^a-z0-9 ]/g, "").replace(/ /g, "-").slice(0, 60);
  if (!chave) return;
  gravar(setDoc(doc(db, "sugestoes", chave), { nome: maiuscula(titulo), quantidade: quantidade || 1, categoriaId: categoriaId || null, usadoEm: agora() }, { merge: true }));
}

// Formulário: abrir para item novo ou para editar
function abrirForm(tipo, id) {
  const i = id ? item(id) : null;
  const ultimaCat = lerLocal("ultimaCategoria", null);
  const cats = categoriasOrdenadas();
  S.form = i ? {
    id: i.id, novo: false, tipo: i.tipo, titulo: i.titulo || "", comentario: i.comentario || "",
    quemFaz: i.quemFaz || "qualquer", urgente: !!i.urgente, dataLimite: i.dataLimite || "",
    repetir: i.repetir || { tipo: "nao" }, quantidade: i.quantidade || 1,
    categoriaId: i.categoriaId || (cats[0] && cats[0].id), temFoto: !!i.temFoto, fotoNova: null, fotoRemovida: false,
    compraId: i.compraId || null, compraTitulo: i.compraTitulo || "", compraStatus: i.compraStatus || "",
    precisaComprar: false, compraNova: "", compraCategoria: (cats[0] && cats[0].id), pendenciaId: i.pendenciaId || null,
  } : {
    id: null, novo: true, tipo, titulo: "", comentario: "", quemFaz: eu(), urgente: false, dataLimite: "",
    repetir: { tipo: "nao" }, quantidade: 1,
    categoriaId: (categoria(ultimaCat) ? ultimaCat : cats[0] && cats[0].id), temFoto: false, fotoNova: null, fotoRemovida: false,
    compraId: null, compraTitulo: "", compraStatus: "", precisaComprar: false, compraNova: "",
    compraCategoria: (categoria(ultimaCat) ? ultimaCat : cats[0] && cats[0].id), pendenciaId: null,
  };
  S.sobre = "form";
  desenharSobre();
  if (!i) setTimeout(() => document.getElementById("campo-titulo")?.focus(), 50);
}

function salvarForm() {
  const f = S.form;
  f.titulo = maiuscula(f.titulo);
  if (!f.titulo) { const c = document.getElementById("campo-titulo"); c?.focus(); c?.setAttribute("placeholder", "Escreva o que é antes de salvar"); return; }
  const id = f.id || novoId("itens");
  const base = { tipo: f.tipo, titulo: f.titulo, comentario: f.comentario.trim() };
  let dados;
  if (f.tipo === "pendencia") {
    let data = f.dataLimite || null;
    if (f.repetir.tipo !== "nao" && !data) data = primeiraData(f.repetir);
    dados = { ...base, quemFaz: f.quemFaz, urgente: f.urgente, dataLimite: data, repetir: f.repetir };
    if (f.precisaComprar && f.compraNova.trim()) {
      const compraId = novoId("itens");
      const tituloCompra = maiuscula(f.compraNova);
      gravar(setDoc(doc(db, "itens", compraId), {
        tipo: "compra", titulo: tituloCompra, comentario: "", quantidade: 1, categoriaId: f.compraCategoria,
        pendenciaId: id, pendenciaTitulo: f.titulo, feito: false, criadoPor: eu(), criadoEm: agora(), temFoto: false,
      }));
      lembrarSugestao(tituloCompra, 1, f.compraCategoria);
      Object.assign(dados, { compraId, compraTitulo: tituloCompra, compraStatus: "falta" });
    }
  } else {
    dados = { ...base, quantidade: f.quantidade, categoriaId: f.categoriaId };
    gravarLocal("ultimaCategoria", f.categoriaId);
    lembrarSugestao(f.titulo, f.quantidade, f.categoriaId);
  }
  // foto
  if (f.fotoNova) { gravar(setDoc(doc(db, "fotos", id), { dados: f.fotoNova })); fotosCache[id] = f.fotoNova; dados.temFoto = true; }
  else if (f.fotoRemovida) { gravar(deleteDoc(doc(db, "fotos", id))); delete fotosCache[id]; dados.temFoto = false; }
  if (f.novo) {
    gravar(setDoc(doc(db, "itens", id), { ...dados, temFoto: !!dados.temFoto, feito: false, criadoPor: eu(), criadoEm: agora() }));
  } else {
    gravar(updateDoc(doc(db, "itens", id), dados));
    // se mudou o nome da pendência, atualiza o "Para:" da compra ligada
    if (f.tipo === "pendencia" && f.compraId && item(f.compraId)) gravar(updateDoc(doc(db, "itens", f.compraId), { pendenciaTitulo: f.titulo }));
  }
  fecharSobre();
}

// Fotos: diminui o tamanho antes de enviar (de ~4 MB para ~150 KB)
function reduzirFoto(arquivo) {
  return new Promise((ok, erro) => {
    const leitor = new FileReader();
    leitor.onerror = erro;
    leitor.onload = () => {
      const img = new Image();
      img.onerror = erro;
      img.onload = () => {
        let lado = 1280, qualidade = 0.72, url;
        do {
          const escala = Math.min(1, lado / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          url = c.toDataURL("image/jpeg", qualidade);
          lado = Math.round(lado * 0.8); qualidade = Math.max(0.5, qualidade - 0.06);
        } while (url.length > 700000 && lado > 400);
        ok(url);
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}
async function carregarFoto(id) {
  if (fotosCache[id]) return fotosCache[id];
  try {
    const d = await getDoc(doc(db, "fotos", id));
    if (d.exists()) { fotosCache[id] = d.data().dados; return fotosCache[id]; }
  } catch (e) { console.error(e); }
  return null;
}
async function verFoto(id) {
  const v = document.getElementById("visor");
  v.innerHTML = `<p style="color:#fff">Carregando foto…</p>`;
  const url = await carregarFoto(id);
  v.innerHTML = url
    ? `<img src="${url}" alt="Foto do item"><button class="fechar" data-acao="fecharFoto" aria-label="Fechar foto">${ic("x", 24, "#fff")}</button>`
    : `<p style="color:#fff;padding:20px;text-align:center">Foto ainda não disponível. Ela aparece quando o celular tiver internet.<br><br><button class="btn-secundario" data-acao="fecharFoto">Fechar</button></p>`;
}
function preencherMiniaturas() {
  document.querySelectorAll("[data-miniatura]").forEach(async el => {
    const url = await carregarFoto(el.dataset.miniatura);
    if (url) { el.style.backgroundImage = `url("${url}")`; el.innerHTML = ""; }
  });
}

// Microfone: transforma fala em texto (recurso do Chrome)
function ouvir(aoTerminar) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) { mostrarAviso("Este navegador não reconhece fala. Use o Chrome."); return; }
  const r = new Rec();
  r.lang = "pt-BR"; r.interimResults = true; r.maxAlternatives = 1;
  const el = document.getElementById("ouvindo");
  let final = "";
  el.innerHTML = `<div class="ouvindo" role="dialog" aria-label="Ouvindo">
    <div class="onda">${ic("mic", 36, "#fff")}</div>
    <h2 style="font-size:20px">Pode falar…</h2>
    <div class="parcial" id="parcial"></div>
    <p>Ex.: "leite, café e detergente" ou "trocar a lâmpada da cozinha"</p>
    <button class="btn-secundario" data-acao="pararOuvir">Pronto</button></div>`;
  el._rec = r;
  r.onresult = ev => {
    let txt = "";
    for (let k = 0; k < ev.results.length; k++) txt += ev.results[k][0].transcript;
    final = txt;
    const p = document.getElementById("parcial"); if (p) p.textContent = txt;
  };
  r.onerror = ev => {
    el.innerHTML = "";
    if (ev.error === "not-allowed") mostrarAviso("Permita o uso do microfone para o Dory nas configurações do Chrome.");
    else if (ev.error === "network") mostrarAviso("Para falar, o celular precisa estar com internet.");
    else if (ev.error !== "no-speech" && ev.error !== "aborted") mostrarAviso("Não consegui ouvir. Tente de novo.");
  };
  r.onend = () => { el.innerHTML = ""; if (final.trim()) aoTerminar(final.trim()); };
  try { r.start(); } catch (e) { el.innerHTML = ""; }
}

// Importar vários itens de uma vez (fala ou "Compartilhar" do WhatsApp)
function abrirImportar(texto, origem) {
  const itens = separarItens(texto);
  const destino = origem === "fala" ? (S.aba === "compras" ? "compra" : "pendencia") : "compra";
  const cats = categoriasOrdenadas();
  S.importar = {
    origem, texto, destino,
    categoriaId: lerLocal("ultimaCategoria", cats[0] && cats[0].id),
    itens: itens.map(t => ({ titulo: t, marcado: true })),
  };
  if (!categoria(S.importar.categoriaId) && cats[0]) S.importar.categoriaId = cats[0].id;
  // um item só, falado: vai direto para o formulário
  if (origem === "fala" && itens.length === 1) {
    abrirForm(destino);
    S.form.titulo = itens[0];
    aplicarSugestaoSeHouver();
    desenharSobre();
    return;
  }
  S.sobre = "importar";
  desenharSobre();
}
function aplicarSugestaoSeHouver() {
  if (S.form.tipo !== "compra") return;
  const s = S.sugestoes.find(x => normalizar(x.nome) === normalizar(S.form.titulo));
  if (s) { S.form.quantidade = s.quantidade || 1; if (categoria(s.categoriaId)) S.form.categoriaId = s.categoriaId; }
}
function salvarImportar() {
  const imp = S.importar;
  const escolhidos = imp.itens.filter(i => i.marcado && i.titulo.trim());
  escolhidos.forEach(i => {
    const titulo = maiuscula(i.titulo);
    const dados = { tipo: imp.destino, titulo, comentario: "", feito: false, criadoPor: eu(), criadoEm: agora(), temFoto: false };
    if (imp.destino === "compra") {
      const s = S.sugestoes.find(x => normalizar(x.nome) === normalizar(titulo));
      dados.quantidade = s?.quantidade || 1;
      dados.categoriaId = imp.categoriaId;
      lembrarSugestao(titulo, dados.quantidade, imp.categoriaId);
    } else {
      Object.assign(dados, { quemFaz: "qualquer", urgente: false, dataLimite: null, repetir: { tipo: "nao" } });
    }
    gravar(setDoc(doc(db, "itens", novoId("itens")), dados));
  });
  if (imp.destino === "compra") gravarLocal("ultimaCategoria", imp.categoriaId);
  S.aba = imp.destino === "compra" ? "compras" : "pendencias"; gravarLocal("aba", S.aba);
  fecharSobre();
  mostrarAviso(`${escolhidos.length} ${escolhidos.length === 1 ? "item adicionado" : "itens adicionados"}`);
}

// Tela sempre acesa (modo compras)
async function manterTelaAcesa() {
  try { if ("wakeLock" in navigator) travaTela = await navigator.wakeLock.request("screen"); } catch (e) { travaTela = null; }
}
function liberarTela() { try { travaTela?.release(); } catch (e) { } travaTela = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.sobre === "mercado") manterTelaAcesa(); });

// Categorias (lugares de compra)
function salvarCategoria() {
  const f = S.folha;
  const nome = maiuscula(f.nome);
  if (!nome) { document.getElementById("campo-lugar")?.focus(); return; }
  const id = f.id || novoId("categorias");
  const ordem = f.id ? (categoria(f.id)?.ordem ?? 0) : Math.max(0, ...S.categorias.map(c => c.ordem || 0)) + 1;
  gravar(setDoc(doc(db, "categorias", id), { nome, icone: f.icone, ordem }));
  const volta = f.voltar;
  S.folha = null; desenharFolha();
  if (volta === "form" && S.form) {
    if (S.form.tipo === "compra") S.form.categoriaId = id; else S.form.compraCategoria = id;
    S.categorias.push({ id, nome, icone: f.icone, ordem }); // aparece na hora
    desenharSobre();
  }
}
function apagarCategoria(id, moverPara) {
  const lote = writeBatch(db);
  S.itens.filter(i => i.tipo === "compra" && i.categoriaId === id).forEach(i => lote.update(doc(db, "itens", i.id), { categoriaId: moverPara }));
  lote.delete(doc(db, "categorias", id));
  gravar(lote.commit());
  S.folha = null; desenharFolha();
}

function fecharSobre() {
  if (S.sobre === "mercado") liberarTela();
  S.sobre = null; S.form = null; S.importar = null;
  desenharSobre(); desenharTela();
}

// ---------- 7. TELAS ----------
function desenharTudo() { desenharTela(); desenharSobre(); desenharFolha(); }

function desenharTela() {
  const t = document.getElementById("tela");
  if (!S.usuario) { t.innerHTML = telaLogin(); return; }
  if (S.semAcesso) { t.innerHTML = telaSemAcesso(); return; }
  if (S.carregando) { t.innerHTML = `<div class="entrada-app"><div class="logo">${LOGO}</div><p>Carregando…</p></div>`; return; }
  t.innerHTML = telaPrincipal();
  preencherMiniaturas();
}

function telaLogin() {
  return `<div class="entrada-app">
    <div class="logo">${LOGO}</div>
    <h1>Dory</h1>
    <p>As pendências da casa e a lista de compras, sempre à mão de vocês dois.</p>
    <button class="btn-google" data-acao="entrar">${GOOGLE} Entrar com Google</button>
    ${S.erroLogin ? `<div class="erro">${esc(S.erroLogin)}</div>` : ""}
    <p style="font-size:13px;color:var(--cinza)">Só as contas autorizadas conseguem ver os itens.</p>
  </div>`;
}
function telaSemAcesso() {
  return `<div class="entrada-app">
    <div class="logo">${LOGO}</div>
    <h1 style="font-size:24px">Sem acesso</h1>
    <p>A conta <b>${esc(S.usuario.email)}</b> não está liberada no Dory.</p>
    <p style="font-size:14px">Entre com a conta Google que foi cadastrada nas regras do Firebase.</p>
    <button class="btn-secundario" data-acao="sair">${ic("sair", 18)} Sair e trocar de conta</button>
  </div>`;
}

function avatares() {
  const lista = S.pessoas.length ? S.pessoas : [{ email: eu(), nome: primeiroNome(S.usuario) }];
  return lista.slice(0, 2).map(p => `<span class="avatar ${p.email === eu() ? "eu" : "outro"}">${esc((p.nome || "?").charAt(0).toUpperCase())}</span>`).join("");
}

function telaPrincipal() {
  const pend = S.itens.filter(i => i.tipo === "pendencia");
  const comp = S.itens.filter(i => i.tipo === "compra");
  const nPend = pend.filter(i => !i.feito).length;
  const nComp = comp.filter(i => !i.feito).length;
  const corpo = S.aba === "compras" ? listaCompras(comp) : listaPendencias(pend);
  return `<div class="pagina">
    <div class="topo">
      <div><div class="topo-data">${dataExtensa()}</div><h1>Dory</h1></div>
      <button class="avatares" data-acao="abrirConfig" aria-label="Abrir configurações">${avatares()}</button>
    </div>
    <div class="segmento" role="tablist">
      <button role="tab" class="${S.aba === "pendencias" ? "ativo" : ""}" data-acao="aba" data-valor="pendencias">Pendências · ${nPend}</button>
      <button role="tab" class="${S.aba === "compras" ? "ativo" : ""}" data-acao="aba" data-valor="compras">Compras · ${nComp}</button>
    </div>
    ${corpo}
  </div>
  ${S.aba === "compras" ? rodapeCompras(comp) : `<div class="rodape-flutuante">
    <button class="btn-redondo" data-acao="falar" aria-label="Adicionar falando">${ic("mic", 24)}</button>
    <button class="btn-principal" data-acao="novo" data-valor="pendencia">${ic("mais", 22, "#fff", 2.4)} Adicionar</button>
  </div>`}`;
}

function ordemPendencias(a, b) {
  if (!!a.urgente !== !!b.urgente) return a.urgente ? -1 : 1;
  const da = a.dataLimite || "9999", dbb = b.dataLimite || "9999";
  if (da !== dbb) return da < dbb ? -1 : 1;
  return (b.criadoEm || 0) - (a.criadoEm || 0);
}

function listaPendencias(pend) {
  const outra = outraPessoa();
  let abertas = pend.filter(i => !i.feito);
  if (S.filtro === "minhas") abertas = abertas.filter(i => i.quemFaz === eu());
  if (S.filtro === "outra" && outra) abertas = abertas.filter(i => i.quemFaz === outra.email);
  abertas.sort(ordemPendencias);
  const feitas = pend.filter(i => i.feito).sort((a, b) => (b.feitoEm || 0) - (a.feitoEm || 0)).slice(0, 15);
  const dica = !lerLocal("dicaGesto", false) && abertas.length ? `<div class="dica">${ic("info", 18, "#5F6368")}<span>Toque no item para editar. Arraste para a <b>direita</b> para concluir e para a <b>esquerda</b> para apagar.</span><button class="fechar-dica" data-acao="fecharDica">Entendi</button></div>` : "";
  return `
    <div class="chips" role="group" aria-label="Filtrar pendências">
      <button class="chip pequeno ${S.filtro === "todas" ? "ativo" : ""}" data-acao="filtro" data-valor="todas">Todas</button>
      <button class="chip pequeno ${S.filtro === "minhas" ? "ativo" : ""}" data-acao="filtro" data-valor="minhas">Minhas</button>
      ${outra ? `<button class="chip pequeno ${S.filtro === "outra" ? "ativo" : ""}" data-acao="filtro" data-valor="outra">Da ${esc(outra.nome)}</button>` : ""}
    </div>
    ${dica}
    <div class="lista">
      ${abertas.length ? abertas.map(cardPendencia).join("") : `<div class="vazio">${S.filtro === "todas" ? "Nenhuma pendência. 🎉<br>Toque em <b>Adicionar</b> para anotar algo." : "Nada por aqui neste filtro."}</div>`}
    </div>
    ${feitas.length ? `<button class="botao-texto" data-acao="verFeitos" aria-expanded="${S.verFeitos}"><span>Feitas recentemente (${feitas.length})</span>${ic(S.verFeitos ? "cima" : "baixo", 18, "#5F6368")}</button>
      ${S.verFeitos ? `<div class="lista">${feitas.map(cardPendencia).join("")}</div>` : ""}` : ""}`;
}

function seloData(i) {
  if (!i.dataLimite) return "";
  const h = hojeISO();
  if (!i.feito && i.dataLimite < h) return `<span class="selo atrasada">Atrasada · ${ddmm(i.dataLimite)}</span>`;
  if (!i.feito && i.dataLimite === h) return `<span class="selo urgente">Vence hoje</span>`;
  return `<span class="selo">Até ${ddmm(i.dataLimite)}</span>`;
}

function cardPendencia(i) {
  const rep = textoRepetir(i.repetir);
  const compra = i.compraId ? (() => {
    const c = item(i.compraId);
    const st = c ? (c.feito ? "comprado ✓" : "falta") : (i.compraStatus === "comprado" ? "comprado ✓" : "tirada da lista");
    return `<span class="selo-compra">${ic("carrinho", 14)} Precisa comprar: ${esc(i.compraTitulo)} (${st})</span>`;
  })() : "";
  return `<div class="card-item" data-gesto="${i.id}">
    <div class="card-fundo direita">${ic("check", 20, "#fff", 2.6)} ${i.feito ? "Desfazer" : "Concluir"}</div>
    <div class="card-fundo esquerda">Apagar ${ic("lixo", 20, "#fff")}</div>
    <div class="card-conteudo">
      <button class="circulo ${i.feito ? "feito" : ""}" data-acao="feito" data-id="${i.id}" aria-label="${i.feito ? "Marcar como não feita" : "Marcar como feita"}">${i.feito ? ic("check", 16, "#fff", 3) : ""}</button>
      <button class="card-corpo" data-acao="editar" data-id="${i.id}">
        <span class="card-titulo ${i.feito ? "feito" : ""}">${esc(i.titulo)}</span>
        ${i.comentario ? `<span class="card-coment">${ic("balao", 15, "#5F6368")}<span>${esc(i.comentario)}</span></span>` : ""}
        ${compra}
        <span class="selos">
          ${i.urgente && !i.feito ? `<span class="selo urgente">! Urgente</span>` : ""}
          ${seloData(i)}
          ${rep ? `<span class="selo">${ic("repetir", 12, "currentColor", 2.4)} ${rep}</span>` : ""}
          <span class="quem">Quem faz: <b>${esc(nomeDe(i.quemFaz))}</b></span>
        </span>
      </button>
      ${i.temFoto ? `<button class="miniatura" data-acao="verFoto" data-id="${i.id}" data-miniatura="${i.id}" aria-label="Ver foto">${ic("imagem", 24, "#5F6368", 1.8)}</button>` : ""}
    </div>
  </div>`;
}

function listaCompras(comp) {
  const cats = categoriasOrdenadas();
  const grupos = cats.map(c => ({ c, itens: comp.filter(i => i.categoriaId === c.id) })).filter(g => g.itens.length);
  const semLugar = comp.filter(i => !categoria(i.categoriaId));
  if (semLugar.length) grupos.push({ c: { id: "", nome: "Sem lugar", icone: "sacola" }, itens: semLugar });
  const nFaltam = comp.filter(i => !i.feito).length;
  return `
    <button class="botao-mercado" data-acao="escolherLugares" ${nFaltam ? "" : "disabled"}>
      ${ic("carrinho", 24, "var(--verde)")}
      <span class="txt"><b>Estou fazendo compras</b><small>Veja só os itens do lugar onde está</small></span>
      ${ic("seta", 20, "#5F6368")}
    </button>
    ${grupos.length ? grupos.map(g => {
      const lista = [...g.itens].sort((a, b) => (!!a.feito - !!b.feito) || (b.criadoEm || 0) - (a.criadoEm || 0));
      return `<div class="grupo">
        <span class="rotulo-secao">${ic(g.c.icone, 15, "#5F6368", 2.2)} ${esc(g.c.nome)} · ${g.itens.filter(i => !i.feito).length}</span>
        <div class="caixa">${lista.map(linhaCompra).join("")}</div>
      </div>`;
    }).join("") : `<div class="vazio">A lista de compras está vazia.<br>Toque em <b>Adicionar</b> ou no microfone.</div>`}`;
}

function linhaCompra(i) {
  return `<div class="linha-compra" data-gesto="${i.id}">
    <div class="card-fundo direita">${ic("check", 20, "#fff", 2.6)} ${i.feito ? "Desmarcar" : "Comprado"}</div>
    <div class="card-fundo esquerda">Apagar ${ic("lixo", 20, "#fff")}</div>
    <div class="card-conteudo">
      <button class="quadrado ${i.feito ? "feito" : ""}" data-acao="feito" data-id="${i.id}" aria-label="${i.feito ? "Desmarcar" : "Marcar como comprado"}">${i.feito ? ic("check", 14, "#fff", 3.2) : ""}</button>
      <button class="card-corpo" data-acao="editar" data-id="${i.id}" style="gap:2px">
        <span class="card-titulo ${i.feito ? "feito" : ""}">${esc(i.titulo)}${(i.quantidade || 1) > 1 ? ` <span class="qtd">× ${i.quantidade}</span>` : ""}</span>
        ${i.pendenciaId ? `<span class="sub">Para: ${esc(i.pendenciaTitulo || "pendência")}</span>` : ""}
        ${i.comentario ? `<span class="sub">${esc(i.comentario)}</span>` : ""}
      </button>
      ${i.temFoto ? `<button class="btn-icone" style="background:transparent" data-acao="verFoto" data-id="${i.id}" aria-label="Ver foto">${ic("imagem", 20, "#5F6368")}</button>` : ""}
      <span class="quem" style="${i.feito ? "color:var(--cinza-claro)" : ""}">${esc(nomeDe(i.criadoPor))}</span>
    </div>
  </div>`;
}

function rodapeCompras(comp) {
  const comprados = comp.filter(i => i.feito).length;
  return `<div class="rodape-barra"><div class="dentro">
    ${comprados ? `<button class="btn-secundario" data-acao="limparComprados" style="flex:1;white-space:nowrap;font-size:14px;padding:0 10px">Limpar comprados</button>` : `<span style="flex:1"></span>`}
    <button class="btn-redondo" style="box-shadow:none;width:52px;height:52px" data-acao="falar" aria-label="Adicionar falando">${ic("mic", 22)}</button>
    <button class="btn-principal" style="box-shadow:none;min-height:52px" data-acao="novo" data-valor="compra">${ic("mais", 20, "#fff", 2.4)} Adicionar</button>
  </div></div>`;
}

// ----- Páginas por cima -----
function desenharSobre() {
  const el = document.getElementById("sobreposicao");
  if (!S.sobre) { el.innerHTML = ""; document.body.style.overflow = ""; return; }
  document.body.style.overflow = "hidden";
  const rolagem = el.scrollTop;
  if (S.sobre === "form") el.innerHTML = paginaForm();
  if (S.sobre === "config") el.innerHTML = paginaConfig();
  if (S.sobre === "mercado") el.innerHTML = paginaMercado();
  if (S.sobre === "importar") el.innerHTML = paginaImportar();
  el.scrollTop = rolagem;
  if (S.sobre === "form" && S.form.temFoto && !S.form.fotoNova && !S.form.fotoRemovida && S.form.id) {
    carregarFoto(S.form.id).then(url => { const im = document.getElementById("previa-foto"); if (im && url) im.src = url; });
  }
}

function chipsLugar(selecionado, acao) {
  return `<div class="chips">${categoriasOrdenadas().map(c => `<button class="chip ${c.id === selecionado ? "ativo" : ""}" data-acao="${acao}" data-valor="${c.id}">${ic(c.icone, 17)} ${esc(c.nome)}</button>`).join("")}
    <button class="chip tracejado" data-acao="novoLugar" data-valor="form">+ Novo lugar</button></div>`;
}

function paginaForm() {
  const f = S.form;
  const ehCompra = f.tipo === "compra";
  const titulo = (f.novo ? (ehCompra ? "Novo item de compra" : "Nova pendência") : (ehCompra ? "Editar compra" : "Editar pendência"));
  const pessoas = S.pessoas.length ? S.pessoas : [{ email: eu(), nome: primeiroNome(S.usuario) }];
  const fotoAtual = f.fotoNova || (f.temFoto && !f.fotoRemovida ? (fotosCache[f.id] || "") : "");
  const temFoto = f.fotoNova || (f.temFoto && !f.fotoRemovida);
  const rep = textoRepetir(f.repetir);
  return `<div class="form">
    <div class="form-topo">
      <button class="btn-icone" data-acao="fecharSobre" aria-label="Voltar sem salvar">${ic("voltar", 20)}</button>
      <h2>${titulo}</h2>
    </div>
    ${f.novo ? `<div class="segmento">
      <button class="${!ehCompra ? "ativo" : ""}" data-acao="tipoForm" data-valor="pendencia">Pendência</button>
      <button class="${ehCompra ? "ativo" : ""}" data-acao="tipoForm" data-valor="compra">Compra</button>
    </div>` : ""}
    <div class="campo">
      <label for="campo-titulo">${ehCompra ? "O que precisa comprar?" : "O que precisa fazer?"}</label>
      <div class="linha-entrada">
        <input id="campo-titulo" class="entrada" type="text" autocomplete="off" maxlength="120" data-campo="titulo" value="${esc(f.titulo)}" placeholder="${ehCompra ? "Ex.: Leite" : "Ex.: Arrumar o chuveiro"}">
        <button class="btn-mic" data-acao="falarTitulo" aria-label="Falar em vez de digitar">${ic("mic", 22)}</button>
      </div>
      ${ehCompra ? `<div class="sugestoes" id="sugestoes">${htmlSugestoes()}</div>` : ""}
    </div>
    ${ehCompra ? `
      <div class="campo"><span class="rotulo">Quantidade</span>
        <div class="contador">
          <button data-acao="qtd" data-valor="-1" aria-label="Diminuir quantidade">${ic("menos", 22, "currentColor", 2.6)}</button>
          <span aria-live="polite">${f.quantidade}</span>
          <button data-acao="qtd" data-valor="1" aria-label="Aumentar quantidade">${ic("mais", 22, "currentColor", 2.6)}</button>
        </div>
      </div>
      <div class="campo"><span class="rotulo">Onde comprar?</span>${chipsLugar(f.categoriaId, "lugarForm")}</div>
    ` : `
      <div class="campo"><span class="rotulo">Quem faz?</span>
        <div class="chips">
          ${pessoas.map(p => `<button class="chip ${f.quemFaz === p.email ? "ativo" : ""}" data-acao="quemFaz" data-valor="${esc(p.email)}">${esc(p.nome)}</button>`).join("")}
          <button class="chip ${f.quemFaz === "qualquer" ? "ativo" : ""}" data-acao="quemFaz" data-valor="qualquer">Qualquer um</button>
        </div>
      </div>
      <div class="campo"><span class="rotulo">Prioridade</span>
        <div class="chips">
          <button class="chip ${!f.urgente ? "ativo" : ""}" data-acao="urgente" data-valor="0">Normal</button>
          <button class="chip urgente ${f.urgente ? "ativo" : ""}" data-acao="urgente" data-valor="1">! Urgente</button>
        </div>
      </div>
      <div class="campo"><label for="campo-data">Data limite (opcional)</label>
        <div class="data-linha">
          <input id="campo-data" class="entrada" type="date" data-campo="dataLimite" value="${esc(f.dataLimite)}">
          ${f.dataLimite ? `<button class="btn-icone" data-acao="limparData" aria-label="Tirar data">${ic("x", 18)}</button>` : ""}
        </div>
      </div>
      <div class="campo"><span class="rotulo">Repetir</span>
        <button class="chip" style="align-self:flex-start" data-acao="abrirRepetir">${ic("repetir", 17)} ${rep || "Não repetir"}</button>
      </div>
    `}
    <div class="campo"><span class="rotulo">Foto (opcional)</span>
      ${temFoto ? `<div class="foto-previa"><img id="previa-foto" src="${fotoAtual}" alt="Foto do item"><button data-acao="tirarFoto" aria-label="Remover foto">${ic("x", 18, "#fff", 2.4)}</button></div>` : `
      <div class="duas-colunas">
        <label class="btn-foto">${ic("camera", 20)} Tirar foto<input class="sr" type="file" accept="image/*" capture="environment" data-foto></label>
        <label class="btn-foto">${ic("imagem", 20)} Da galeria<input class="sr" type="file" accept="image/*" data-foto></label>
      </div>`}
    </div>
    <div class="campo"><label for="campo-coment">Comentário (opcional)</label>
      <textarea id="campo-coment" class="entrada" data-campo="comentario" maxlength="500" placeholder="Algum detalhe para lembrar">${esc(f.comentario)}</textarea>
    </div>
    ${!ehCompra ? (f.compraId ? `<div class="caixa-compra">${ic("carrinho", 18)} <span>Compra ligada: <b>${esc(f.compraTitulo)}</b> (${item(f.compraId) && !item(f.compraId).feito ? "falta comprar" : "comprado ✓"})</span></div>` : `
      <div class="campo"><span class="rotulo">Precisa comprar algo para isso?</span>
        ${f.precisaComprar ? `<div class="caixa-compra">
          <label for="campo-compra" style="font-size:13px;font-weight:600;color:var(--texto-2)">O que comprar? (vai para a lista de compras)</label>
          <input id="campo-compra" class="entrada" type="text" maxlength="120" data-campo="compraNova" value="${esc(f.compraNova)}" placeholder="Ex.: Resistência do chuveiro">
          <span style="font-size:13px;font-weight:600;color:var(--texto-2)">Onde comprar?</span>
          ${chipsLugar(f.compraCategoria, "lugarCompraForm")}
          <button class="link" style="align-self:flex-start" data-acao="precisaComprar" data-valor="0">Não precisa comprar</button>
        </div>` : `<button class="chip" style="align-self:flex-start" data-acao="precisaComprar" data-valor="1">${ic("carrinho", 17)} Sim, adicionar à lista de compras</button>`}
      </div>`) : ""}
    <div class="espaco"></div>
    <div class="botoes-folha">
      <button class="btn-principal largo" data-acao="salvarForm">Salvar</button>
      ${!f.novo ? `<button class="btn-perigo" data-acao="apagarDoForm">Apagar este item</button>` : ""}
    </div>
  </div>`;
}

function htmlSugestoes() {
  const f = S.form;
  const t = normalizar(f.titulo);
  if (!t || t.length < 2) return "";
  const lista = S.sugestoes
    .filter(s => normalizar(s.nome).includes(t) && normalizar(s.nome) !== t)
    .sort((a, b) => (normalizar(a.nome).startsWith(t) ? 0 : 1) - (normalizar(b.nome).startsWith(t) ? 0 : 1) || (b.usadoEm || 0) - (a.usadoEm || 0))
    .slice(0, 4);
  if (!lista.length) return "";
  return `<div class="titulo-sug">Vocês já compraram antes:</div>` + lista.map(s => `<button data-acao="usarSugestao" data-valor="${esc(s.id)}">
    ${ic("repetir", 16, "#5F6368")}<span>${esc(s.nome)}${(s.quantidade || 1) > 1 ? ` × ${s.quantidade}` : ""}</span><span class="lugar">${esc(categoria(s.categoriaId)?.nome || "")}</span></button>`).join("");
}

function paginaConfig() {
  const cats = categoriasOrdenadas();
  return `<div class="form lista-config">
    <div class="form-topo">
      <button class="btn-icone" data-acao="fecharSobre" aria-label="Voltar">${ic("voltar", 20)}</button>
      <h2>Configurações</h2>
    </div>
    <div class="grupo"><span class="rotulo-secao">Quem usa o Dory</span>
      <div class="caixa">${S.pessoas.map(p => `<div class="linha-config">
        <span class="avatar ${p.email === eu() ? "eu" : "outro"}" style="border:none">${esc(p.nome.charAt(0).toUpperCase())}</span>
        <span class="nome">${esc(p.nome)} ${p.email === eu() ? "<small>(você)</small>" : ""}<br><small>${esc(p.email)}</small></span></div>`).join("")}
        ${S.pessoas.length < 2 ? `<div class="linha-config"><span class="nome"><small>A outra pessoa aparece aqui depois que entrar no Dory pela primeira vez.</small></span></div>` : ""}
      </div>
    </div>
    <div class="grupo"><span class="rotulo-secao">Lugares de compra</span>
      <div class="caixa">
        ${cats.map(c => `<div class="linha-config">${ic(c.icone, 20)}<span class="nome">${esc(c.nome)}</span>
          <button class="btn-icone" style="background:transparent" data-acao="editarLugar" data-id="${c.id}" aria-label="Editar ${esc(c.nome)}">${ic("lapis", 18, "#5F6368")}</button></div>`).join("")}
        <button class="linha-botao" data-acao="novoLugar" data-valor="config">${ic("mais", 20, "var(--verde)", 2.4)} Novo lugar</button>
      </div>
    </div>
    <div class="grupo"><span class="rotulo-secao">Avisos no celular</span>
      <div class="dica">${ic("info", 18, "#5F6368")}<span>Os avisos (quando o outro adiciona algo e no dia da data limite) entram na próxima etapa de configuração.</span></div>
    </div>
    <div class="grupo"><span class="rotulo-secao">Como usar</span>
      <div class="caixa"><div style="padding:12px 14px;font-size:14px;line-height:1.6;color:var(--texto-2)">
        • <b>Concluir:</b> toque no círculo ou arraste o item para a direita.<br>
        • <b>Apagar:</b> arraste para a esquerda (dá para desfazer).<br>
        • <b>Editar:</b> toque no item.<br>
        • <b>Falar:</b> toque no microfone e diga, por exemplo, "leite, café e pão".<br>
        • <b>Do WhatsApp:</b> segure a mensagem, toque em Compartilhar e escolha o Dory (com o app instalado).<br>
        • <b>Sem internet:</b> continua funcionando; envia sozinho quando a internet voltar.
      </div></div>
    </div>
    ${instalarEvento ? `<button class="btn-principal largo" data-acao="instalar">${ic("baixar", 20, "#fff")} Instalar o Dory neste celular</button>` : ""}
    <button class="btn-secundario" data-acao="sair">${ic("sair", 18)} Sair da conta (${esc(S.usuario?.email || "")})</button>
  </div>`;
}

function paginaMercado() {
  const sel = S.mercado.sel || [];
  const comp = S.itens.filter(i => i.tipo === "compra");
  const cats = categoriasOrdenadas().filter(c => sel.includes(c.id));
  const doLugar = comp.filter(i => sel.includes(i.categoriaId));
  const outrosCats = categoriasOrdenadas().filter(c => !sel.includes(c.id));
  const outrosFaltam = comp.filter(i => !i.feito && !sel.includes(i.categoriaId));
  const mostradas = S.mercado.verOutros ? [...cats, ...outrosCats] : cats;
  const visiveis = S.mercado.verOutros ? comp : doLugar;
  const total = visiveis.length, noCarrinho = visiveis.filter(i => i.feito).length;
  const linha = i => `<button class="linha-grande ${i.feito ? "feito" : ""}" data-acao="feitoMercado" data-id="${i.id}" aria-label="${i.feito ? "Tirar do carrinho" : "Pegar"} ${esc(i.titulo)}">
      <span class="quadrado ${i.feito ? "feito" : ""}">${i.feito ? ic("check", 18, "#fff", 3.2) : ""}</span>
      <span class="nome">${esc(i.titulo)}</span>
      ${(i.quantidade || 1) > 1 ? `<span class="qtd-grande">× ${i.quantidade}</span>` : ""}
    </button>`;
  const grupos = mostradas.map(c => {
    const falta = comp.filter(i => i.categoriaId === c.id && !i.feito);
    if (!falta.length) return "";
    return `<span class="rotulo-secao">${ic(c.icone, 15, "#5F6368", 2.2)} ${esc(c.nome)} · falta ${falta.length}</span>${falta.map(linha).join("")}`;
  }).join("");
  const carrinho = visiveis.filter(i => i.feito);
  const nomesOutros = [...new Set(outrosFaltam.map(i => categoria(i.categoriaId)?.nome || "Sem lugar"))];
  return `<div class="mercado">
    <div class="mercado-topo">
      <div class="topo">
        <div><h1>Fazendo compras</h1><div class="lugares">${cats.map(c => esc(c.nome)).join(" + ")}</div></div>
        <button class="btn-sair" data-acao="fecharSobre">Sair</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="progresso-num">${noCarrinho} de ${total}</span><span style="font-size:15px;font-weight:500">no carrinho</span></div>
        <div class="barra"><div style="width:${total ? Math.round(noCarrinho / total * 100) : 0}%"></div></div>
      </div>
      <div class="chips" style="gap:8px">
        <span class="pilula">${ic("sol", 14, "#fff")} Tela sempre acesa</span>
        ${navigator.onLine ? "" : `<span class="pilula">${ic("semNet", 14, "#fff")} Sem internet · salvando no celular</span>`}
      </div>
    </div>
    <div class="mercado-lista">
      ${grupos || `<div class="vazio">Tudo no carrinho! 🎉<br>Toque em <b>Terminar compras</b>.</div>`}
      ${carrinho.length ? `<span class="rotulo-secao">Já no carrinho · ${carrinho.length}</span>${carrinho.map(linha).join("")}` : ""}
      ${outrosFaltam.length && !S.mercado.verOutros ? `<button class="btn-outros" data-acao="verOutros">Tem também ${outrosFaltam.length} ${outrosFaltam.length === 1 ? "item" : "itens"} de ${esc(nomesOutros.join(", "))} · ver</button>` : ""}
    </div>
    <div class="mercado-rodape"><div class="dentro"><button class="btn-escuro" data-acao="terminarCompras">Terminar compras</button></div></div>
  </div>`;
}

function paginaImportar() {
  const imp = S.importar;
  const n = imp.itens.filter(i => i.marcado && i.titulo.trim()).length;
  const origem = imp.origem === "fala" ? "Você falou" : "Texto recebido";
  return `<div class="form">
    <div class="form-topo">
      <button class="btn-icone" data-acao="fecharSobre" aria-label="Cancelar">${ic("x", 18)}</button>
      <h2>${imp.origem === "fala" ? "Adicionar o que você falou" : "Recebido de outro app"}</h2>
    </div>
    <div style="background:var(--fundo);border-left:4px solid #9AA0A6;border-radius:4px 12px 12px 4px;padding:10px 12px;display:flex;flex-direction:column;gap:4px">
      <span style="font-size:12px;font-weight:600;color:var(--cinza)">${origem}</span>
      <span style="font-size:14px;line-height:1.45;color:var(--texto-2);white-space:pre-line">${esc(imp.texto)}</span>
    </div>
    <div class="campo"><span class="rotulo">Vai para</span>
      <div class="segmento">
        <button class="${imp.destino === "pendencia" ? "ativo" : ""}" data-acao="destinoImportar" data-valor="pendencia">Pendências</button>
        <button class="${imp.destino === "compra" ? "ativo" : ""}" data-acao="destinoImportar" data-valor="compra">Compras</button>
      </div>
    </div>
    ${imp.destino === "compra" ? `<div class="campo"><span class="rotulo">Onde comprar?</span><div class="chips">${categoriasOrdenadas().map(c => `<button class="chip ${c.id === imp.categoriaId ? "ativo" : ""}" data-acao="lugarImportar" data-valor="${c.id}">${ic(c.icone, 17)} ${esc(c.nome)}</button>`).join("")}</div></div>` : ""}
    <div class="campo"><span class="rotulo">O Dory separou em ${imp.itens.length} ${imp.itens.length === 1 ? "item" : "itens"}. Desmarque o que não quiser:</span>
      <div class="caixa" style="border:1.5px solid #E4E1DA">
        ${imp.itens.length ? imp.itens.map((i, k) => `<button class="linha-config" style="border:none;background:transparent;width:100%;text-align:left;${k ? "border-top:1px solid var(--linha)" : ""}" data-acao="marcarImportar" data-valor="${k}">
          <span class="quadrado ${i.marcado ? "feito" : ""}">${i.marcado ? ic("check", 14, "#fff", 3.2) : ""}</span>
          <span class="nome" style="${i.marcado ? "" : "color:var(--cinza)"}">${esc(i.titulo)}</span></button>`).join("") : `<div class="linha-config"><span class="nome"><small>Não encontrei itens neste texto.</small></span></div>`}
      </div>
    </div>
    <div class="espaco"></div>
    <button class="btn-principal largo" data-acao="salvarImportar" ${n ? "" : "disabled"}>Adicionar ${n} ${n === 1 ? "item" : "itens"}</button>
  </div>`;
}

// ----- Folhas que sobem de baixo -----
function desenharFolha() {
  const el = document.getElementById("folha");
  const f = S.folha;
  if (!f) { el.innerHTML = ""; return; }
  let h = "";
  if (f.tipo === "lugares") h = folhaLugares();
  if (f.tipo === "repetir") h = folhaRepetir();
  if (f.tipo === "lugar") h = folhaLugar();
  if (f.tipo === "confirmar") h = folhaConfirmar();
  if (f.tipo === "apagarLugar") h = folhaApagarLugar();
  el.innerHTML = `<div class="folha" role="dialog" aria-modal="true"><span class="alca"></span>${h}</div>`;
}

function folhaLugares() {
  const comp = S.itens.filter(i => i.tipo === "compra" && !i.feito);
  const sel = S.folha.sel;
  const total = comp.filter(i => sel.includes(i.categoriaId)).length;
  return `<h2>Onde você vai comprar?</h2><p class="subtitulo">Marque um ou mais lugares</p>
    ${categoriasOrdenadas().map(c => {
      const n = comp.filter(i => i.categoriaId === c.id).length;
      const ativo = sel.includes(c.id);
      return `<button class="opcao ${ativo ? "ativo" : ""}" data-acao="marcarLugar" data-valor="${c.id}" aria-pressed="${ativo}">
        <span class="marcador">${ativo ? ic("check", 16, "#fff", 3.2) : ""}</span>${ic(c.icone, 22)}
        <span class="nome">${esc(c.nome)}</span><span class="conta">${n} ${n === 1 ? "item" : "itens"}</span></button>`;
    }).join("")}
    <button class="link" style="align-self:flex-start" data-acao="marcarTodos">Marcar todos</button>
    <div class="dica">${ic("info", 18, "#5F6368")}<span>O Dory lembra da sua última escolha. Só aparecem itens que ainda faltam comprar.</span></div>
    <button class="btn-principal largo" data-acao="comecarCompras" ${total ? "" : "disabled"}>Começar · ${total} ${total === 1 ? "item" : "itens"}</button>`;
}

function folhaRepetir() {
  const r = S.folha.rep;
  const op = (tipo, nome, extra = "") => `<button class="opcao ${r.tipo === tipo ? "ativo" : ""}" style="min-height:52px" data-acao="tipoRepetir" data-valor="${tipo}"><span class="radio"></span><span class="nome" style="font-size:16px">${nome}</span>${extra}</button>`;
  return `<h2>Repetir</h2>
    ${op("nao", "Não repetir")}
    ${op("dia", "Todo dia")}
    ${op("semana", "Toda semana")}
    ${r.tipo === "semana" ? `<div class="chips" style="padding-left:6px">${DIAS_CURTO.map((d, k) => `<button class="chip pequeno ${r.diaSemana === k ? "ativo" : ""}" data-acao="diaSemana" data-valor="${k}">${d}</button>`).join("")}</div>` : ""}
    ${op("mes", "Todo mês")}
    ${r.tipo === "mes" ? `<div style="display:flex;align-items:center;gap:10px;padding-left:6px"><span>No dia</span>
      <div class="contador pequeno"><button data-acao="diaMes" data-valor="-1" aria-label="Dia anterior">−</button><span>${r.diaMes}</span><button data-acao="diaMes" data-valor="1" aria-label="Próximo dia">+</button></div></div>` : ""}
    ${op("meses", "A cada alguns meses", `<span class="conta">ex.: filtro de água</span>`)}
    ${r.tipo === "meses" ? `<div style="display:flex;align-items:center;gap:10px;padding-left:6px"><span>A cada</span>
      <div class="contador pequeno"><button data-acao="cadaMeses" data-valor="-1" aria-label="Menos meses">−</button><span>${r.cadaMeses}</span><button data-acao="cadaMeses" data-valor="1" aria-label="Mais meses">+</button></div><span>meses</span></div>` : ""}
    <div class="dica">${ic("info", 18, "#5F6368")}<span>Quando vocês marcarem como feita, o Dory cria sozinho a próxima, já com a nova data.</span></div>
    <button class="btn-principal largo" data-acao="okRepetir">Pronto</button>`;
}

function folhaLugar() {
  const f = S.folha;
  return `<h2>${f.id ? "Editar lugar" : "Novo lugar de compra"}</h2>
    <div class="campo"><label for="campo-lugar">Nome</label>
      <input id="campo-lugar" class="entrada" type="text" maxlength="40" data-campoFolha="nome" value="${esc(f.nome)}" placeholder="Ex.: Pet shop, Padaria, Feira"></div>
    <div class="campo"><span class="rotulo">Ícone</span>
      <div class="grade-icones">${ICONES_LUGAR.map(n => `<button class="${f.icone === n ? "ativo" : ""}" data-acao="iconeLugar" data-valor="${n}" aria-label="Ícone ${n}">${ic(n, 24)}</button>`).join("")}</div></div>
    <div class="botoes-folha">
      <button class="btn-principal largo" data-acao="salvarLugar">Salvar</button>
      ${f.id ? `<button class="btn-perigo" data-acao="pedirApagarLugar">Apagar este lugar</button>` : ""}
      <button class="btn-secundario" data-acao="fecharFolha">Cancelar</button>
    </div>`;
}

function folhaApagarLugar() {
  const f = S.folha;
  const c = categoria(f.id);
  const n = S.itens.filter(i => i.tipo === "compra" && i.categoriaId === f.id).length;
  const outras = categoriasOrdenadas().filter(x => x.id !== f.id);
  if (!n) return `<h2>Apagar "${esc(c?.nome)}"?</h2><p class="subtitulo">Este lugar não tem itens.</p>
    <div class="botoes-folha"><button class="btn-perigo" data-acao="confirmarApagarLugar">Apagar</button><button class="btn-secundario" data-acao="fecharFolha">Cancelar</button></div>`;
  if (!outras.length) return `<h2>Não dá para apagar</h2><p class="subtitulo">"${esc(c?.nome)}" é o único lugar e tem ${n} ${n === 1 ? "item" : "itens"}. Crie outro lugar antes.</p><button class="btn-secundario" data-acao="fecharFolha">Entendi</button>`;
  return `<h2>Apagar "${esc(c?.nome)}"?</h2><p class="subtitulo">Este lugar tem ${n} ${n === 1 ? "item" : "itens"}. Para onde eles vão?</p>
    <div class="chips">${outras.map(x => `<button class="chip ${f.mover === x.id ? "ativo" : ""}" data-acao="moverPara" data-valor="${x.id}">${ic(x.icone, 17)} ${esc(x.nome)}</button>`).join("")}</div>
    <div class="botoes-folha"><button class="btn-perigo" data-acao="confirmarApagarLugar" ${f.mover ? "" : "disabled"}>Mover itens e apagar</button><button class="btn-secundario" data-acao="fecharFolha">Cancelar</button></div>`;
}

function folhaConfirmar() {
  const f = S.folha;
  return `<h2>${esc(f.titulo)}</h2><p class="subtitulo">${esc(f.texto)}</p>
    <div class="botoes-folha"><button class="btn-principal largo" data-acao="confirmarSim">${esc(f.sim)}</button><button class="btn-secundario" data-acao="fecharFolha">Cancelar</button></div>`;
}
function confirmar(titulo, texto, sim, fn) { S.folha = { tipo: "confirmar", titulo, texto, sim, fn }; desenharFolha(); }

// ---------- 8. CLIQUES E GESTOS ----------
const acoes = {
  entrar: () => entrar(),
  sair: () => sairDaConta(),
  aba: el => { S.aba = el.dataset.valor; gravarLocal("aba", S.aba); desenharTela(); window.scrollTo(0, 0); },
  filtro: el => { S.filtro = el.dataset.valor; desenharTela(); },
  verFeitos: () => { S.verFeitos = !S.verFeitos; desenharTela(); },
  fecharDica: () => { gravarLocal("dicaGesto", true); desenharTela(); },
  novo: el => abrirForm(el.dataset.valor),
  editar: el => abrirForm(null, el.dataset.id),
  feito: el => alternarFeito(el.dataset.id),
  verFoto: el => verFoto(el.dataset.id),
  fecharFoto: () => { document.getElementById("visor").innerHTML = ""; },
  desfazer: () => {
    const a = document.getElementById("aviso");
    const fn = a._desfazer; a._desfazer = null; a.innerHTML = ""; clearTimeout(avisoTimer);
    if (fn) fn();
    if (a._depois) a._depois = null;
  },
  falar: () => ouvir(texto => abrirImportar(texto, "fala")),
  pararOuvir: () => { document.getElementById("ouvindo")._rec?.stop(); },
  limparComprados: () => {
    const ids = S.itens.filter(i => i.tipo === "compra" && i.feito).map(i => i.id);
    confirmar("Limpar comprados?", `Tirar da lista ${ids.length === 1 ? "o item que já foi comprado" : `os ${ids.length} itens que já foram comprados`}.`, "Limpar", () => limparComprados(ids));
  },
  abrirConfig: () => { S.sobre = "config"; desenharSobre(); },
  instalar: async () => { if (instalarEvento) { instalarEvento.prompt(); await instalarEvento.userChoice; instalarEvento = null; desenharSobre(); } },
  fecharSobre: () => fecharSobre(),
  // formulário
  tipoForm: el => { S.form.tipo = el.dataset.valor; desenharSobre(); },
  quemFaz: el => { S.form.quemFaz = el.dataset.valor; desenharSobre(); },
  urgente: el => { S.form.urgente = el.dataset.valor === "1"; desenharSobre(); },
  limparData: () => { S.form.dataLimite = ""; desenharSobre(); },
  qtd: el => { S.form.quantidade = Math.max(1, Math.min(99, S.form.quantidade + Number(el.dataset.valor))); desenharSobre(); },
  lugarForm: el => { S.form.categoriaId = el.dataset.valor; desenharSobre(); },
  lugarCompraForm: el => { S.form.compraCategoria = el.dataset.valor; desenharSobre(); },
  precisaComprar: el => { S.form.precisaComprar = el.dataset.valor === "1"; desenharSobre(); if (S.form.precisaComprar) setTimeout(() => document.getElementById("campo-compra")?.focus(), 50); },
  tirarFoto: () => { S.form.fotoNova = null; S.form.fotoRemovida = true; desenharSobre(); },
  usarSugestao: el => {
    const s = S.sugestoes.find(x => x.id === el.dataset.valor); if (!s) return;
    S.form.titulo = s.nome; S.form.quantidade = s.quantidade || 1; if (categoria(s.categoriaId)) S.form.categoriaId = s.categoriaId;
    desenharSobre();
  },
  falarTitulo: () => ouvir(texto => { S.form.titulo = maiuscula(texto); aplicarSugestaoSeHouver(); desenharSobre(); }),
  salvarForm: () => salvarForm(),
  apagarDoForm: () => { const id = S.form.id; fecharSobre(); apagarComDesfazer(id); },
  abrirRepetir: () => {
    const r = S.form.repetir || { tipo: "nao" };
    const base = S.form.dataLimite ? dataDe(S.form.dataLimite) : new Date();
    S.folha = { tipo: "repetir", rep: { tipo: r.tipo, diaSemana: r.diaSemana ?? base.getDay(), diaMes: r.diaMes ?? base.getDate(), cadaMeses: r.cadaMeses ?? 6 } };
    desenharFolha();
  },
  tipoRepetir: el => { S.folha.rep.tipo = el.dataset.valor; desenharFolha(); },
  diaSemana: el => { S.folha.rep.diaSemana = Number(el.dataset.valor); desenharFolha(); },
  diaMes: el => { S.folha.rep.diaMes = Math.max(1, Math.min(31, S.folha.rep.diaMes + Number(el.dataset.valor))); desenharFolha(); },
  cadaMeses: el => { S.folha.rep.cadaMeses = Math.max(2, Math.min(24, S.folha.rep.cadaMeses + Number(el.dataset.valor))); desenharFolha(); },
  okRepetir: () => {
    const r = S.folha.rep;
    const rep = r.tipo === "nao" ? { tipo: "nao" } : r.tipo === "dia" ? { tipo: "dia" } : r.tipo === "semana" ? { tipo: "semana", diaSemana: r.diaSemana } : r.tipo === "mes" ? { tipo: "mes", diaMes: r.diaMes } : { tipo: "meses", cadaMeses: r.cadaMeses };
    S.form.repetir = rep;
    if (rep.tipo !== "nao" && !S.form.dataLimite) S.form.dataLimite = primeiraData(rep);
    S.folha = null; desenharFolha(); desenharSobre();
  },
  // lugares
  novoLugar: el => { S.folha = { tipo: "lugar", id: null, nome: "", icone: "sacola", voltar: el.dataset.valor }; desenharFolha(); setTimeout(() => document.getElementById("campo-lugar")?.focus(), 50); },
  editarLugar: el => { const c = categoria(el.dataset.id); S.folha = { tipo: "lugar", id: c.id, nome: c.nome, icone: c.icone || "sacola", voltar: "config" }; desenharFolha(); },
  iconeLugar: el => { S.folha.icone = el.dataset.valor; desenharFolha(); },
  salvarLugar: () => salvarCategoria(),
  pedirApagarLugar: () => { S.folha = { tipo: "apagarLugar", id: S.folha.id, mover: null }; desenharFolha(); },
  moverPara: el => { S.folha.mover = el.dataset.valor; desenharFolha(); },
  confirmarApagarLugar: () => apagarCategoria(S.folha.id, S.folha.mover),
  fecharFolha: () => { S.folha = null; desenharFolha(); },
  confirmarSim: () => { const fn = S.folha.fn; S.folha = null; desenharFolha(); fn(); },
  // modo compras
  escolherLugares: () => {
    const comp = S.itens.filter(i => i.tipo === "compra" && !i.feito);
    let sel = (S.mercado.sel || []).filter(id => categoria(id));
    if (!sel.length) sel = categoriasOrdenadas().filter(c => comp.some(i => i.categoriaId === c.id)).map(c => c.id);
    S.folha = { tipo: "lugares", sel };
    desenharFolha();
  },
  marcarLugar: el => { const id = el.dataset.valor, s = S.folha.sel; S.folha.sel = s.includes(id) ? s.filter(x => x !== id) : [...s, id]; desenharFolha(); },
  marcarTodos: () => { S.folha.sel = S.categorias.map(c => c.id); desenharFolha(); },
  comecarCompras: () => {
    S.mercado.sel = S.folha.sel; S.mercado.verOutros = false; gravarLocal("lugaresMercado", S.mercado.sel);
    S.folha = null; desenharFolha();
    S.sobre = "mercado"; desenharSobre(); manterTelaAcesa();
  },
  feitoMercado: el => alternarFeito(el.dataset.id),
  verOutros: () => { S.mercado.verOutros = true; desenharSobre(); },
  terminarCompras: () => {
    const sel = S.mercado.sel || [];
    const ids = S.itens.filter(i => i.tipo === "compra" && i.feito && (S.mercado.verOutros || sel.includes(i.categoriaId))).map(i => i.id);
    if (!ids.length) { fecharSobre(); return; }
    confirmar("Terminar compras?", `Os ${ids.length} itens que estão no carrinho saem da lista. O que não foi comprado continua lá.`, "Terminar", () => { limparComprados(ids); fecharSobre(); });
  },
  // importar
  destinoImportar: el => { S.importar.destino = el.dataset.valor; desenharSobre(); },
  lugarImportar: el => { S.importar.categoriaId = el.dataset.valor; desenharSobre(); },
  marcarImportar: el => { const i = S.importar.itens[Number(el.dataset.valor)]; i.marcado = !i.marcado; desenharSobre(); },
  salvarImportar: () => salvarImportar(),
};

let gestoUsado = false;
document.addEventListener("click", ev => {
  if (gestoUsado) { gestoUsado = false; ev.preventDefault(); return; }
  const el = ev.target.closest("[data-acao]");
  if (el && acoes[el.dataset.acao]) { ev.preventDefault(); acoes[el.dataset.acao](el); return; }
  // tocar no fundo escuro fecha a folha
  if (ev.target.id === "folha") { S.folha = null; desenharFolha(); }
});

// Digitar nos campos: guarda o texto sem redesenhar a tela (para não perder o cursor)
document.addEventListener("input", ev => {
  const el = ev.target;
  if (el.dataset.campo && S.form) {
    S.form[el.dataset.campo] = el.value;
    if (el.dataset.campo === "titulo" && S.form.tipo === "compra") document.getElementById("sugestoes").innerHTML = htmlSugestoes();
  }
  if (el.dataset.campofolha && S.folha) S.folha[el.dataset.campofolha] = el.value;
});
document.addEventListener("change", async ev => {
  const el = ev.target;
  if (el.dataset.campo === "dataLimite" && S.form) { S.form.dataLimite = el.value; desenharSobre(); }
  if (el.hasAttribute("data-foto") && el.files && el.files[0] && S.form) {
    try { S.form.fotoNova = await reduzirFoto(el.files[0]); S.form.fotoRemovida = false; desenharSobre(); }
    catch (e) { mostrarAviso("Não consegui abrir essa foto."); }
  }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Enter" && ev.target.id === "campo-titulo") { ev.preventDefault(); salvarForm(); }
  if (ev.key === "Enter" && ev.target.id === "campo-lugar") { ev.preventDefault(); salvarCategoria(); }
});

// Arrastar o dedo: direita conclui, esquerda apaga
let arraste = null;
document.addEventListener("pointerdown", ev => {
  const alvo = ev.target.closest("[data-gesto]");
  if (!alvo || ev.button > 0) return;
  arraste = { alvo, id: alvo.dataset.gesto, x: ev.clientX, y: ev.clientY, dx: 0, ativo: false, conteudo: alvo.querySelector(".card-conteudo") };
});
document.addEventListener("pointermove", ev => {
  if (!arraste) return;
  const dx = ev.clientX - arraste.x, dy = ev.clientY - arraste.y;
  if (!arraste.ativo) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { arraste = null; return; }
    if (Math.abs(dx) < 12) return;
    arraste.ativo = true; arraste.conteudo.classList.add("arrastando");
  }
  arraste.dx = dx;
  arraste.conteudo.style.transform = `translateX(${dx}px)`;
  const [dir, esq] = arraste.alvo.querySelectorAll(".card-fundo");
  dir.style.opacity = dx > 0 ? Math.min(1, dx / 90) : 0;
  esq.style.opacity = dx < 0 ? Math.min(1, -dx / 90) : 0;
});
function fimArraste() {
  if (!arraste) return;
  const { ativo, dx, id, conteudo } = arraste;
  arraste = null;
  if (!ativo) return;
  gestoUsado = true; setTimeout(() => { gestoUsado = false; }, 350);
  conteudo.classList.remove("arrastando");
  const limite = Math.min(110, window.innerWidth * 0.28);
  if (dx > limite) { conteudo.style.transform = "translateX(100%)"; setTimeout(() => alternarFeito(id), 160); }
  else if (dx < -limite) { conteudo.style.transform = "translateX(-100%)"; setTimeout(() => apagarComDesfazer(id), 160); }
  else { conteudo.style.transform = ""; conteudo.parentElement.querySelectorAll(".card-fundo").forEach(f => f.style.opacity = 0); }
}
document.addEventListener("pointerup", fimArraste);
document.addEventListener("pointercancel", fimArraste);

// Internet caiu/voltou: atualiza o aviso no modo compras
window.addEventListener("online", () => { if (S.sobre === "mercado") desenharSobre(); });
window.addEventListener("offline", () => { if (S.sobre === "mercado") desenharSobre(); });

// Botão "voltar" do Android fecha a janela aberta em vez de sair do app
history.pushState({ dory: 1 }, "");
window.addEventListener("popstate", () => {
  if (document.getElementById("visor").innerHTML) acoes.fecharFoto();
  else if (S.folha) { S.folha = null; desenharFolha(); }
  else if (S.sobre) fecharSobre();
  else { history.back(); return; }
  history.pushState({ dory: 1 }, "");
});

// Instalação no celular
window.addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); instalarEvento = ev; if (S.sobre === "config") desenharSobre(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => { });

desenharTudo();
