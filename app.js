pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let db = null;
let currentBook = null;
let currentLoadedPdf = null;
let currentPageNumber = 1;

let sentences = [];
let currentIndex = -1;
let isPlaying = false;
let currentSpeed = 1.0;
const speeds = [1.0, 1.25, 1.5, 0.75];

let currentFontSize = 1.25; // em rem
const audioPlayer = new Audio();

// Elementos da Interface
const btnShelfView = document.getElementById('btnShelfView');
const btnReaderView = document.getElementById('btnReaderView');
const btnProfileView = document.getElementById('btnProfileView');
const shelfSection = document.getElementById('shelfSection');
const readerSection = document.getElementById('readerSection');
const playerBar = document.getElementById('playerBar');
const booksGrid = document.getElementById('booksGrid');
const pdfInput = document.getElementById('pdfInput');
const textContainer = document.getElementById('textContainer');
const bookTitle = document.getElementById('bookTitle');
const pageIndicator = document.getElementById('pageIndicator');
const pageNavControls = document.getElementById('pageNavControls');
const pageFooterIndicator = document.getElementById('pageFooterIndicator');
const btnPrevPage = document.getElementById('btnPrevPage');
const btnNextPage = document.getElementById('btnNextPage');
const voiceSelect = document.getElementById('voiceSelect');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const speedBtn = document.getElementById('speedBtn');
const btnFontInc = document.getElementById('btnFontInc');
const btnFontDec = document.getElementById('btnFontDec');
const themeButtons = document.querySelectorAll('[data-set-theme]');

// Ícones usados na interface (SVG, herdam a cor do texto)
const ICON_PLAY  = '<svg class="icon icon-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const ICON_PAUSE = '<svg class="icon icon-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>';
const ICON_TRASH = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9.5 7V5h5v2M7 7l.9 12h8.2L17 7"/></svg>';
const ICON_PLUS  = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

function notify(msg, ms = 2600) {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(notify._t);
  notify._t = setTimeout(() => box.classList.remove('show'), ms);
}

function setPlayIcon(playing) {
  document.body.classList.toggle('playing', !!playing);
  playPauseBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 1. Inicializar Banco Local (IndexedDB)
function initDB() {
  const request = indexedDB.open("BibliotecaDB", 3);

  request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (db.objectStoreNames.contains("books")) {
      db.deleteObjectStore("books");
    }
    db.createObjectStore("books", { keyPath: "id", autoIncrement: true });
  };

  request.onsuccess = (e) => {
    db = e.target.result;
    loadShelf();
  };

  request.onerror = (e) => {
    console.error("Erro ao inicializar IndexedDB:", e);
  };
}

// 2. Sistema de Temas e Preferências
function setupThemes() {
  const savedTheme = localStorage.getItem('app_theme') || 'paper';
  applyTheme(savedTheme);

  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.setTheme;
      applyTheme(theme);
    });
  });

  const savedFontSize = localStorage.getItem('app_font_size');
  if (savedFontSize) {
    currentFontSize = parseFloat(savedFontSize);
    document.documentElement.style.setProperty('--reader-font-size', `${currentFontSize}rem`);
  }

  btnFontInc.addEventListener('click', () => {
    if (currentFontSize < 2.0) {
      currentFontSize = +(currentFontSize + 0.1).toFixed(2);
      document.documentElement.style.setProperty('--reader-font-size', `${currentFontSize}rem`);
      localStorage.setItem('app_font_size', currentFontSize);
    }
  });

  btnFontDec.addEventListener('click', () => {
    if (currentFontSize > 0.9) {
      currentFontSize = +(currentFontSize - 0.1).toFixed(2);
      document.documentElement.style.setProperty('--reader-font-size', `${currentFontSize}rem`);
      localStorage.setItem('app_font_size', currentFontSize);
    }
  });
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('app_theme', theme);
  themeButtons.forEach(b => {
    b.classList.toggle('active', b.dataset.setTheme === theme);
  });
}

// 3. Configurar Opções de Vozes Neurais
// Voz do aparelho: usa a leitura em voz alta do próprio celular/navegador (sem servidor, sem internet).
// As vozes neurais (Francisca, Antonio, Thalita) precisam do servidor local rodando.
// Link com ?servidor=https://... guarda o endereço do servidor de vozes (ex.: um túnel). ?servidor=padrao volta ao normal.
(function readServerParam() {
  const q = new URLSearchParams(location.search);
  if (!q.has('servidor')) return;
  const val = q.get('servidor');
  try {
    if (!val || val === 'padrao') {
      localStorage.removeItem('app_tts_server');
    } else {
      const u = new URL(val);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
      if (u.protocol === 'https:' || local) localStorage.setItem('app_tts_server', u.origin);
    }
  } catch (e) { /* endereço inválido: ignora */ }
  q.delete('servidor');
  const rest = q.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
})();
const CUSTOM_TTS_SERVER = localStorage.getItem('app_tts_server');
const TTS_SERVER_URL = (window.TTS_SERVER_URL || CUSTOM_TTS_SERVER || 'http://127.0.0.1:8000').replace(/\/$/, '');
const DEVICE_VOICE = 'device';
const CLONED_VOICE = 'voicestudio'; // voz clonada, gerada pelo VoiceStudio no PC (mais lenta: prepara frases à frente)
const canDeviceVoice = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

// Vozes neurais precisam do servidor (server.py). Fora do seu computador, se ele não estiver acessível, o app volta sozinho para a voz do aparelho.
const isLocalHost = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function setupVoices() {
  const device = canDeviceVoice ? `<option value="${DEVICE_VOICE}">Voz do aparelho</option>` : '';
  const tag = (isLocalHost || CUSTOM_TTS_SERVER) ? 'servidor' : 'requer servidor';
  const neural = `
    <option value="pt-BR-FranciscaNeural">Francisca (${tag})</option>
    <option value="pt-BR-AntonioNeural">Antonio (${tag})</option>
    <option value="pt-BR-ThalitaNeural">Thalita (${tag})</option>`;
  // "Minha voz" (clone do VoiceStudio) está desligada: a qualidade em português não ficou boa. O servidor ainda aceita 'voicestudio'.
  // Para voltar: acrescente aqui <option value="${CLONED_VOICE}">Minha voz (${tag})</option>
  voiceSelect.innerHTML = (device + neural) || '<option value="">Voz indisponível</option>';
  // No app instalado (Capacitor) ou sem preferência salva, a voz do aparelho é a padrão
  const saved = localStorage.getItem('app_voice');
  const isApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  voiceSelect.value = saved && [...voiceSelect.options].some(o => o.value === saved)
    ? saved
    : (canDeviceVoice && (isApp || !isLocalHost) && !CUSTOM_TTS_SERVER ? DEVICE_VOICE : 'pt-BR-FranciscaNeural');
  if (!voiceSelect.value) voiceSelect.selectedIndex = 0;
  voiceSelect.addEventListener('change', () => {
    localStorage.setItem('app_voice', voiceSelect.value);
    if (isPlaying) playSentence(currentIndex >= 0 ? currentIndex : 0);
  });
}
setupVoices();

// 4. Alternância de Telas (Estante, Leitura e Perfil)
function setView(view) {
  document.body.dataset.view = view;
  shelfSection.style.display = view === 'shelf' ? 'block' : 'none';
  readerSection.style.display = view === 'reader' ? 'flex' : 'none';
  profileSection.style.display = view === 'profile' ? 'block' : 'none';
  playerBar.style.display = view === 'reader' ? 'flex' : 'none';
  btnShelfView.classList.toggle('active-tab', view === 'shelf');
  btnReaderView.classList.toggle('active-tab', view === 'reader');
  btnProfileView.classList.toggle('active-tab', view === 'profile');
  viewTitle.textContent = view === 'profile' ? 'Meu perfil' : 'Estante';
  closeSheets();
}

function showShelfView() {
  setView('shelf');
  pageIndicator.style.display = 'none';
  stopAudio();
  loadShelf();
}

function showReaderView() {
  setView('reader');
  if (currentBook) pageIndicator.style.display = 'inline-block';
}

function showProfileView() {
  setView('profile');
  stopAudio();
  renderProfile();
}

btnShelfView.addEventListener('click', (e) => {
  e.preventDefault();
  showShelfView();
});

btnReaderView.addEventListener('click', (e) => {
  e.preventDefault();
  if (document.body.dataset.view !== 'reader') showReaderView();
});

btnProfileView.addEventListener('click', (e) => {
  e.preventDefault();
  showProfileView();
});

// 5. Carregar Livros da Estante com Capa e Progresso
// Cor da capa gerada (quando o PDF não tem imagem de capa), sempre a mesma para o mesmo título
function coverHue(title) {
  const hues = [152, 22, 205, 350, 38, 270];
  let h = 0;
  for (const ch of String(title)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hues[h % hues.length];
}

function createShelfSlot(book) {
  const slot = document.createElement('div');
  slot.className = 'shelf-slot';

  const currentPage = book.currentPage || 1;
  const totalPages = book.totalPages || 1;
  const percent = Math.min(100, Math.round((currentPage / totalPages) * 100));
  const isNew = currentPage <= 1 && !book.currentSentence;
  const title = escapeHtml(book.title);

  const coverHtml = book.cover
    ? `<img src="${book.cover}" class="book-cover" alt="" draggable="false">`
    : `<div class="book-cover-generated" style="--hue:${coverHue(book.title)}">${title}</div>`;

  slot.innerHTML = `
    <div class="book">
      <button type="button" class="book-open" aria-label="Abrir ${title}, ${isNew ? 'ainda não lido' : percent + '% lido'}">${coverHtml}</button>
      <button type="button" class="book-delete" title="Remover da estante" aria-label="Remover ${title} da estante">${ICON_TRASH}</button>
    </div>
    <div class="shelf-plate" title="${title}">
      <span class="plate-title">${title}</span>
      <span class="plate-progress">
        <span class="plate-bar"><i style="width:${isNew ? 0 : percent}%"></i></span>
        <b>${isNew ? 'Novo' : percent + '%'}</b>
      </span>
    </div>
  `;

  slot.addEventListener('click', (e) => {
    if (e.target.closest('.book-delete')) return;
    openBook(book);
  });

  slot.querySelector('.book-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteBook(book.id);
  });

  return slot;
}

// Espaço pontilhado no fim da estante: convite para adicionar outro PDF
function createAddSlot() {
  const slot = document.createElement('div');
  slot.className = 'shelf-slot slot-add';
  slot.innerHTML = `
    <div class="book">
      <button type="button" class="book-ghost" aria-label="Adicionar PDF">${ICON_PLUS}<span>Adicionar PDF</span></button>
    </div>
  `;
  slot.querySelector('.book-ghost').addEventListener('click', () => pdfInput.click());
  return slot;
}

function loadShelf() {
  if (!db) return;
  const transaction = db.transaction(["books"], "readonly");
  const store = transaction.objectStore("books");
  const request = store.getAll();

  request.onsuccess = () => {
    const books = request.result;
    booksGrid.innerHTML = '';

    books.forEach(book => booksGrid.appendChild(createShelfSlot(book)));
    booksGrid.appendChild(createAddSlot());

    if (books.length === 0) {
      const note = document.createElement('p');
      note.className = 'shelf-note';
      note.textContent = 'Sua estante está vazia. Adicione um PDF para começar a ouvir.';
      booksGrid.appendChild(note);
    }
  };
}

// 6. Excluir exemplar
function deleteBook(id) {
  if (!confirm("Deseja remover este livro da sua estante?")) return;
  const transaction = db.transaction(["books"], "readwrite");
  const store = transaction.objectStore("books");
  store.delete(id).onsuccess = () => {
    if (currentBook && currentBook.id === id) {
      currentBook = null;
      currentLoadedPdf = null;
      textContainer.innerHTML = '<p class="placeholder-text">Livro removido.</p>';
      bookTitle.textContent = "Nenhum livro aberto";
      pageIndicator.style.display = 'none';
      pageNavControls.style.display = 'none';
      stopAudio();
    }
    loadShelf();
  };
}

// 7. Gerar Capa
async function generateCoverThumbnail(firstPage) {
  const viewport = firstPage.getViewport({ scale: 0.5 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await firstPage.render({
    canvasContext: context,
    viewport: viewport
  }).promise;

  return canvas.toDataURL('image/jpeg', 0.8);
}

// 8. Upload de Novo Livro
pdfInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const rawTitle = file.name.replace(/\.[^/.]+$/, "");
  const reader = new FileReader();

  reader.onload = async function() {
    try {
      const pdfBuffer = this.result;
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer.slice(0)) });
      const pdf = await loadingTask.promise;

      let coverDataUrl = null;
      try {
        const page1 = await pdf.getPage(1);
        coverDataUrl = await generateCoverThumbnail(page1);
      } catch (err) {
        console.warn("Falha ao renderizar capa:", err);
      }

      const bookRecord = {
        title: rawTitle,
        cover: coverDataUrl,
        pdfData: pdfBuffer,
        totalPages: pdf.numPages,
        currentPage: 1,
        currentSentence: 0,
        addedAt: new Date().toISOString()
      };

      const transaction = db.transaction(["books"], "readwrite");
      const store = transaction.objectStore("books");
      const addReq = store.add(bookRecord);

      addReq.onsuccess = (e) => {
        bookRecord.id = e.target.result;
        pdfInput.value = ''; // permite adicionar o mesmo arquivo de novo
        showShelfView();     // fica na estante; o livro novo aparece lá para você escolher
      };
    } catch (err) {
      console.error("Erro ao processar PDF:", err);
      alert("Não foi possível carregar este PDF.");
    }
  };

  reader.readAsArrayBuffer(file);
});

// 9. Abrir Livro e Carregar Página
async function openBook(book) {
  currentBook = book;
  currentPageNumber = book.currentPage || 1;
  const targetSentence = book.currentSentence || 0;
  bookTitle.textContent = book.title;

  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(book.pdfData.slice(0)) });
    currentLoadedPdf = await loadingTask.promise;
    showReaderView();
    await loadPage(currentPageNumber, targetSentence, false);
  } catch (err) {
    console.error("Erro ao abrir livro:", err);
    alert("Erro ao recarregar os dados deste PDF.");
  }
}

// ---- Reconstrução do texto da página ----
// Junta letras espaçadas ("S U N T Z U" -> "SUNTZU"), ignora números de página
// nas margens e reúne palavras hifenizadas no fim da linha.

// Agrupa os itens do pdf.js em linhas (o pdf.js marca o fim de linha com um item vazio)
function groupIntoLines(items) {
  const lines = [];
  let cur = [];
  let curY = null;
  for (const it of items) {
    if (it.hasEOL && !it.str) {
      if (cur.length) lines.push(cur);
      cur = [];
      curY = null;
      continue;
    }
    if (!it.str) continue;
    const y = it.transform[5];
    const size = Math.abs(it.transform[3]) || it.height || 10;
    if (cur.length && Math.abs(y - curY) > size * 0.5) {
      lines.push(cur); // mudou de linha mesmo sem marcador
      cur = [];
    }
    if (!cur.length) curY = y;
    cur.push(it);
    if (it.hasEOL) {
      lines.push(cur);
      cur = [];
      curY = null;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// Transforma uma linha em palavras ("tokens") e lacunas entre elas, guardando a largura de cada lacuna
function lineToTokens(items) {
  const tokens = [];   // { text }
  const gaps = [];     // gaps[i] fica entre tokens[i] e tokens[i+1]: { width: número|null, n }
  let pendingGap = null;
  let prev = null;

  const addText = (text) => {
    if (tokens.length === 0) {
      tokens.push({ text });
    } else if (pendingGap) {
      gaps.push(pendingGap);
      tokens.push({ text });
    } else {
      tokens[tokens.length - 1].text += text; // sem espaço entre eles: mesma palavra
    }
    pendingGap = null;
  };

  const addGap = (width, n) => {
    if (tokens.length === 0) return; // ignora espaço no começo da linha
    if (!pendingGap) {
      pendingGap = { width, n };
    } else {
      pendingGap.width = (pendingGap.width == null && width == null)
        ? null
        : (pendingGap.width || 0) + (width || 0);
      pendingGap.n += n;
    }
  };

  for (const it of items) {
    const size = Math.abs(it.transform[3]) || it.height || 10;

    if (/^\s+$/.test(it.str)) {
      addGap(it.width > 0 ? it.width : null, it.str.length);
      prev = it;
      continue;
    }

    // lacuna entre itens vizinhos que não têm um item de espaço no meio
    if (prev && !pendingGap && tokens.length) {
      const gapX = it.transform[4] - (prev.transform[4] + prev.width);
      if (gapX > size * 0.15) addGap(gapX, 1);
    }

    for (const part of it.str.match(/\s+|\S+/g)) {
      if (/^\s/.test(part)) addGap(null, part.length); // espaço dentro do item
      else addText(part);
    }
    prev = it;
  }
  return { tokens, gaps };
}

// Letras espaçadas: os espaços "estreitos" são entre letras e os "largos" são entre palavras
function joinLetterSpaced(run, gaps) {
  const known = gaps.map(g => g.width).filter(w => w != null && w > 0);
  const hasInternal = gaps.some(g => g.width == null);
  let threshold = Infinity;
  if (known.length) {
    const min = Math.min(...known);
    const max = Math.max(...known);
    if (max >= min * 1.8) threshold = min * 1.8;  // dois tamanhos: o maior separa palavras
    else if (hasInternal) threshold = 0;          // espaços soltos separam palavras; os de dentro do item, letras
  }
  let text = run[0].text;
  for (let k = 1; k < run.length; k++) {
    const g = gaps[k - 1];
    const isWordGap = g.width != null ? g.width >= threshold : g.n >= 2;
    text += (isWordGap ? ' ' : '') + run[k].text;
  }
  return text;
}

function joinTokens(tokens, gaps) {
  const isSingle = (t) => Array.from(t.text).length === 1;
  const isAlnum = (t) => /^[\p{L}\p{N}]$/u.test(t.text);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    if (isSingle(tokens[i])) {
      let j = i;
      while (j + 1 < tokens.length && isSingle(tokens[j + 1])) j++;
      const count = j - i + 1;
      const alnum = tokens.slice(i, j + 1).filter(isAlnum).length;
      if (count >= 4 && alnum >= 3) {
        out.push(joinLetterSpaced(tokens.slice(i, j + 1), gaps.slice(i, j)));
        i = j + 1;
        continue;
      }
    }
    out.push(tokens[i].text);
    i++;
  }
  return out.join(' ');
}

function buildPageText(content, view) {
  const y0 = view ? view[1] : 0;
  const height = view ? (view[3] - view[1]) : 0;
  const lines = [];

  for (const items of groupIntoLines(content.items)) {
    const { tokens, gaps } = lineToTokens(items);
    if (!tokens.length) continue;

    const text = joinTokens(tokens, gaps).trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue; // linhas só de símbolos ("· · ·")

    // número de página solto no topo ou no rodapé
    if (height > 0) {
      const rel = (items[0].transform[5] - y0) / height;
      const compact = text.replace(/\s+/g, '');
      if ((rel < 0.08 || rel > 0.92) && compact.length <= 6 &&
          (/^\d+$/.test(compact) || /^[ivxlcdm]+$/i.test(compact))) continue;
    }
    lines.push(text);
  }

  // junta as linhas; palavra hifenizada no fim da linha volta a ser uma só
  let result = '';
  for (const line of lines) {
    if (!result) result = line;
    else if (/\p{L}-$/u.test(result) && /^\p{Ll}/u.test(line)) result = result.slice(0, -1) + line;
    else result += ' ' + line;
  }
  return result;
}

// 10. Carregar Página com Suporte a Reprodução Contínua
async function loadPage(pageNum, startSentenceIndex = 0, autoPlay = false) {
  if (!currentLoadedPdf) return;

  // Só interrompe o reprodutor se NÃO for avanço automático de leitura
  if (!autoPlay) {
    stopAudio();
  } else {
    audioPlayer.pause();
  }

  const prevPage = currentPageNumber;
  currentPageNumber = pageNum;
  currentBook.currentPage = pageNum;
  currentBook.currentSentence = startSentenceIndex;

  saveProgress();

  const total = currentLoadedPdf.numPages;
  pageHeadBook.textContent = currentBook.title;
  pageHeadNum.textContent = pageNum;
  if (pageNum !== prevPage) turnPage(pageNum > prevPage ? 'next' : 'prev');
  pageIndicator.textContent = `Pág. ${pageNum} / ${total}`;
  pageIndicator.style.display = 'inline-block';

  pageFooterIndicator.textContent = `Página ${pageNum} de ${total}`;
  pageNavControls.style.display = 'flex';

  btnPrevPage.disabled = (pageNum <= 1);
  btnNextPage.disabled = (pageNum >= total);

  textContainer.innerHTML = '<p class="placeholder-text">Carregando página...</p>';

  try {
    const page = await currentLoadedPdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageStrings = buildPageText(content, page.view);
    renderReaderMode(pageStrings, startSentenceIndex);

    // Se estava tocando antes, dispara a primeira frase da nova página imediatamente
    if (autoPlay && sentences.length > 0) {
      playSentence(0);
    }
  } catch (err) {
    console.error("Erro ao carregar página:", err);
    textContainer.innerHTML = '<p class="placeholder-text" style="color:#ef4444;">Erro ao extrair o texto desta página.</p>';
  }
}

function saveProgress() {
  if (!db || !currentBook) return;
  const transaction = db.transaction(["books"], "readwrite");
  const store = transaction.objectStore("books");
  store.put(currentBook);
}

// 11. Botões de Navegação Manual de Páginas
btnPrevPage.addEventListener('click', (e) => {
  e.preventDefault();
  if (currentPageNumber > 1) {
    loadPage(currentPageNumber - 1, 0, false);
  }
});

btnNextPage.addEventListener('click', (e) => {
  e.preventDefault();
  if (currentLoadedPdf && currentPageNumber < currentLoadedPdf.numPages) {
    loadPage(currentPageNumber + 1, 0, false);
  }
});

// Divisão de frases que respeita abreviações (Dr., p., etc.), iniciais e continuações
const ABBREVIATIONS = new Set([
  'dr', 'dra', 'sr', 'sra', 'srta', 'prof', 'profa', 'av', 'cap', 'art', 'p', 'pp',
  'pág', 'pag', 'vol', 'vols', 'n', 'nº', 'no', 'etc', 'ex', 'obs', 'ltda', 'jr',
  'ed', 'séc', 'sec', 'v', 'vs', 'exmo', 'exma', 'min', 'gen', 'cel', 'cia', 'eng',
  'sto', 'sta', 'tel', 'dep', 'fig', 'tab', 'cf', 'ibid', 'op', 'cit', 'aprox',
  'apr', 'máx', 'mín'
]);
// Abreviações que também podem terminar uma frase (quando a próxima começa com maiúscula)
const ABBREVIATIONS_CAN_END = new Set(['etc', 'ltda', 'cia', 'jr']);

function splitSentences(text) {
  const result = [];
  let start = 0;
  const boundary = /([.!?…]+["'”’)\]»]*)(\s+)/g;
  let m;

  while ((m = boundary.exec(text)) !== null) {
    const nextChar = text.charAt(m.index + m[0].length);
    const core = m[1].replace(/["'”’)\]»]+$/, '');
    const nextIsLower = /\p{Ll}/u.test(nextChar);
    const nextIsUpper = /\p{Lu}/u.test(nextChar);
    let isBoundary = true;

    if (nextIsLower) {
      // a frase continua (ex.: "etc. e tal", "disse ele" depois de aspas)
      isBoundary = false;
    } else if (core === '.') {
      const before = text.slice(start, m.index);
      const wm = before.match(/([\p{L}ºª]+)$/u);
      const word = wm ? wm[1] : '';
      const lower = word.toLowerCase();

      if (word.length === 1 && /\p{Lu}/u.test(word)) {
        isBoundary = false; // inicial, como em "J. R. R. Tolkien"
      } else if (ABBREVIATIONS.has(lower)) {
        isBoundary = ABBREVIATIONS_CAN_END.has(lower) && nextIsUpper;
      }
    }

    if (isBoundary) {
      const piece = text.slice(start, m.index + m[1].length).trim();
      if (piece) result.push(piece);
      start = m.index + m[0].length;
    }
  }

  const rest = text.slice(start).trim();
  if (rest) result.push(rest);
  return result.length ? result : [text];
}

// 12. Renderização das Sentenças
function renderReaderMode(rawText, initialHighlightIndex = 0) {
  textContainer.innerHTML = '';
  const normalized = rawText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    textContainer.innerHTML = '<p class="placeholder-text">Esta página não contém texto legível.</p>';
    sentences = [];
    return;
  }

  const segments = splitSentences(normalized);
  sentences = [];

  segments.forEach((chunk) => {
    const textPart = chunk.trim();
    if (textPart.length > 0) {
      const span = document.createElement('span');
      span.className = 'sentence';
      span.textContent = textPart + ' ';
      
      const itemIndex = sentences.length;
      span.dataset.index = itemIndex;

      span.addEventListener('click', (e) => {
        e.preventDefault();
        openActionSheet(itemIndex);
      });

      textContainer.appendChild(span);
      sentences.push({ text: textPart, element: span });
    }
  });

  sentences.forEach((_, i) => paintMark(i));

  currentIndex = initialHighlightIndex < sentences.length ? initialHighlightIndex : 0;
  if (sentences.length > 0 && sentences[currentIndex]) {
    const markedItem = sentences[currentIndex];
    markedItem.element.classList.add('active-sentence');
    scrollToElementSafely(markedItem.element);
  }
}

// 13. Rolagem Suave Centralizada
function scrollToElementSafely(el) {
  if (!el || !readerSection) return;
  const containerRect = readerSection.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const offset = elRect.top - containerRect.top - (containerRect.height / 2) + (elRect.height / 2);
  readerSection.scrollBy({ top: offset, behavior: 'smooth' });
}

// 14. Reprodução de Áudio Neural com Estado Persistente
const audioCache = new Map();   // chave: voz|texto -> Promise com a URL do áudio
const AUDIO_CACHE_MAX = 20;
let playToken = 0;              // evita que cliques rápidos toquem frases fora de ordem
let resumable = false;          // true quando o áudio foi pausado no meio e pode continuar

// A voz neural soletra palavras em CAIXA ALTA (acha que são siglas).
// Antes de enviar ao servidor, passamos para minúsculas só para a fala; o texto na tela não muda.
// Siglas que devem continuar sendo soletradas: acrescente aqui (em maiúsculas).
const SPELLED_ACRONYMS = new Set([
  'IBGE', 'CNPJ', 'INSS', 'FGTS', 'HTML', 'HTTP', 'HTTPS', 'CPF', 'RG', 'CNH', 'USP',
  'UFRJ', 'UFMG', 'ONU', 'FBI', 'CIA', 'KGB', 'PDF', 'USB', 'SUS', 'CLT', 'OAB', 'STF',
  'STJ', 'TSE', 'PIB', 'IPCA', 'CEP', 'DNA', 'RNA', 'PIX', 'TV', 'CD', 'DVD', 'EUA', 'URSS'
]);

function normalizeForSpeech(text) {
  const keep = (w) => SPELLED_ACRONYMS.has(w) || /^[IVXLCDM]+$/.test(w); // siglas e números romanos
  const lower = (w) => (keep(w) ? w : w.toLowerCase());
  const letters = text.replace(/[^\p{L}]/gu, '');

  // Frase inteira em maiúsculas (títulos): converte todas as palavras
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    return text.replace(/(?<![\p{L}\p{N}])\p{Lu}+(?![\p{L}\p{N}])/gu, lower);
  }

  // Sequências como "SUN TZU" ou "TRADUÇÃO, INTRODUÇÃO E NOTAS": nomes e títulos, não siglas
  text = text.replace(
    /(?<![\p{L}\p{N}])\p{Lu}{2,}(?:[\s,]+(?:\p{Lu}{2,}|[AEO]))+(?![\p{L}\p{N}])/gu,
    (seq) => {
      const multi = seq.split(/[\s,]+/).filter(w => w.length >= 2).length;
      return multi >= 2 ? seq.replace(/\p{Lu}+/gu, lower) : seq;
    }
  );

  // Palavras isoladas com 4+ letras (siglas curtas, como CPF, continuam soletradas)
  return text.replace(/(?<![\p{L}\p{N}])\p{Lu}{4,}(?![\p{L}\p{N}])/gu, lower);
}

const usingDeviceVoice = () => voiceSelect.value === DEVICE_VOICE;

// Fala uma frase com a voz do aparelho. Resolve quando termina; rejeita se der erro.
function speakWithDevice(text, token) {
  return new Promise((resolve, reject) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(normalizeForSpeech(text));
    utter.lang = 'pt-BR';
    const voices = synth.getVoices();
    const voice = voices.find(v => v.lang === 'pt-BR') || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pt'));
    if (voice) utter.voice = voice;
    utter.rate = currentSpeed;
    utter.onend = () => resolve(token);
    utter.onerror = (e) => (e.error === 'canceled' || e.error === 'interrupted') ? resolve(null) : reject(e);
    synth.speak(utter);
  });
}

function stopDeviceVoice() {
  if (canDeviceVoice) window.speechSynthesis.cancel();
}

function requestAudioUrl(text) {
  const key = `${voiceSelect.value}|${text}`;
  if (audioCache.has(key)) return audioCache.get(key);

  const promise = fetch(`${TTS_SERVER_URL}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: normalizeForSpeech(text),
      voice: voiceSelect.value,
      rate: "+0%" // velocidade é aplicada só no navegador (playbackRate)
    })
  })
    .then(res => {
      if (!res.ok) throw new Error(`Erro na síntese: ${res.status}`);
      return res.json();
    })
    .then(data => new URL(data.audio_url, TTS_SERVER_URL + '/').href);

  promise.catch(() => audioCache.delete(key)); // não guarda falhas
  audioCache.set(key, promise);

  if (audioCache.size > AUDIO_CACHE_MAX) {
    audioCache.delete(audioCache.keys().next().value); // descarta a mais antiga
  }
  return promise;
}

async function playSentence(index, isRetry = false) {
  if (index < 0 || index >= sentences.length) {
    stopAudio();
    return;
  }

  const myToken = ++playToken;
  audioPlayer.pause();
  stopDeviceVoice();
  resumable = false;
  currentIndex = index;

  if (currentBook) {
    currentBook.currentSentence = currentIndex;
    saveProgress();
  }

  document.querySelectorAll('.sentence.active-sentence').forEach(el => {
    el.classList.remove('active-sentence');
  });

  const item = sentences[currentIndex];
  if (!item || !item.element) return;

  item.element.classList.add('active-sentence');
  scrollToElementSafely(item.element);

  if (usingDeviceVoice()) {
    try {
      isPlaying = true;
      setPlayIcon(true);
      const done = await speakWithDevice(item.text, myToken);
      if (done === myToken && myToken === playToken) onSentenceEnded();
    } catch (err) {
      if (myToken !== playToken) return;
      console.error("Falha na voz do aparelho:", err);
      isPlaying = false;
      setPlayIcon(false);
    }
    return;
  }

  // A voz clonada demora mais para gerar: avisa se a frase não ficar pronta logo
  const cloned = voiceSelect.value === CLONED_VOICE;
  const slowTimer = cloned ? setTimeout(() => notify('Preparando a voz…', 8000), 1500) : null;
  try {
    const url = await requestAudioUrl(item.text);
    if (slowTimer) clearTimeout(slowTimer);
    if (myToken !== playToken) return; // outra frase foi escolhida enquanto esta carregava

    audioPlayer.src = url;
    audioPlayer.defaultPlaybackRate = currentSpeed;
    audioPlayer.playbackRate = currentSpeed;
    await audioPlayer.play();
    if (myToken !== playToken) return;

    isPlaying = true;
    setPlayIcon(true);

    // Prepara as próximas frases enquanto esta toca (elimina a pausa entre frases).
    // A voz clonada gera mais devagar que a fala, então prepara algumas a mais.
    const ahead = cloned ? 4 : 1;
    for (let k = 1; k <= ahead; k++) {
      const nx = sentences[currentIndex + k];
      if (nx) requestAudioUrl(nx.text).catch(() => {});
    }
  } catch (err) {
    if (slowTimer) clearTimeout(slowTimer);
    if (myToken !== playToken) return;
    if (!isRetry) {
      // o arquivo pode ter sido apagado pela limpeza do servidor: pede de novo uma vez
      audioCache.delete(`${voiceSelect.value}|${item.text}`);
      return playSentence(index, true);
    }
    console.error("Falha ao tocar frase:", err);
    if (canDeviceVoice && !usingDeviceVoice()) {
      // servidor de voz fora do ar: continua com a voz do aparelho em vez de parar
      voiceSelect.value = DEVICE_VOICE;
      notify('Servidor de voz indisponível. Usando a voz do aparelho.');
      return playSentence(index);
    }
    isPlaying = false;
    setPlayIcon(false);
  }
}

// Transição Ininterrupta: próxima frase ou próxima página sem pausar
function onSentenceEnded() {
  if (isPlaying) {
    if (currentIndex + 1 < sentences.length) {
      playSentence(currentIndex + 1);
    } else {
      // Chegou ao fim da página: se houver próxima, vira e continua tocando sem parar
      if (currentLoadedPdf && currentPageNumber < currentLoadedPdf.numPages) {
        loadPage(currentPageNumber + 1, 0, true);
      } else {
        stopAudio();
      }
    }
  }
}
audioPlayer.onended = onSentenceEnded;

// Pausa de verdade: mantém o destaque e a posição dentro da frase
function pauseAudio() {
  playToken++; // cancela qualquer frase que ainda esteja carregando
  if (usingDeviceVoice()) {
    // a voz do aparelho não pausa de forma confiável no Android: para e recomeça a frase ao continuar
    stopDeviceVoice();
    resumable = false;
    isPlaying = false;
    setPlayIcon(false);
    return;
  }
  const started = audioPlayer.src && !audioPlayer.ended && audioPlayer.currentTime > 0;
  audioPlayer.pause();
  resumable = !!started;
  isPlaying = false;
  setPlayIcon(false);
}

// Parada completa (troca de tela/página): limpa o destaque
function stopAudio() {
  playToken++;
  resumable = false;
  audioPlayer.pause();
  stopDeviceVoice();
  isPlaying = false;
  setPlayIcon(false);
  document.querySelectorAll('.sentence.active-sentence').forEach(el => {
    el.classList.remove('active-sentence');
  });
}

// 15. Controles do Reprodutor
playPauseBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (isPlaying) {
    pauseAudio();
  } else if (resumable) {
    // continua exatamente de onde parou, sem refazer a frase
    resumable = false;
    isPlaying = true;
    setPlayIcon(true);
    audioPlayer.play().catch(() => playSentence(currentIndex));
  } else {
    playSentence(currentIndex >= 0 ? currentIndex : 0);
  }
});

prevBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (currentIndex > 0) playSentence(currentIndex - 1);
});

nextBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (currentIndex + 1 < sentences.length) playSentence(currentIndex + 1);
});

speedBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const currentIdx = speeds.indexOf(currentSpeed);
  currentSpeed = speeds[(currentIdx + 1) % speeds.length];
  speedBtn.textContent = `${currentSpeed.toFixed(2).replace(/0$/, '')}x`;
  audioPlayer.defaultPlaybackRate = currentSpeed;
  audioPlayer.playbackRate = currentSpeed;
  if (isPlaying && usingDeviceVoice()) playSentence(currentIndex); // a voz do aparelho aplica a velocidade ao recomeçar a frase
});

// ============================================================
// Perfil, painéis de baixo, destaques e anotações
// ============================================================
const profileSection = document.getElementById('profileSection');
const profileList = document.getElementById('profileList');
const viewTitle = document.getElementById('viewTitle');
const btnSettings = document.getElementById('btnSettings');
const settingsSheet = document.getElementById('settingsSheet');
const actionSheet = document.getElementById('actionSheet');
const sheetBackdrop = document.getElementById('sheetBackdrop');
const pageHeadBook = document.getElementById('pageHeadBook');
const pageHeadNum = document.getElementById('pageHeadNum');
const asTitle = document.getElementById('asTitle');
const swatchesBox = document.getElementById('swatches');
const actGrid = document.getElementById('actGrid');
const noteBox = document.getElementById('noteBox');
const noteText = document.getElementById('noteText');

// Cores de destaque (as mesmas no claro, sépia e noturno; o CSS ajusta a força)
const HL_COLORS = ['#f6b26b', '#e57373', '#81c784', '#64b5f6', '#4dd0e1', '#f4e04d', '#ffcc80', '#f48fb1'];
let selectedIdx = -1;

// Painéis que sobem de baixo
function hideSheets() {
  [settingsSheet, actionSheet].forEach((sh) => {
    sh.classList.remove('show');
    sh.setAttribute('aria-hidden', 'true');
  });
  sheetBackdrop.classList.remove('show');
}

function openSheet(sheet, clearBackdrop) {
  hideSheets();
  sheet.classList.add('show');
  sheet.setAttribute('aria-hidden', 'false');
  sheetBackdrop.classList.toggle('clear', !!clearBackdrop);
  sheetBackdrop.classList.add('show');
}

function closeSheets() {
  hideSheets();
  if (selectedIdx >= 0 && sentences[selectedIdx]) sentences[selectedIdx].element.classList.remove('selected');
  selectedIdx = -1;
}

sheetBackdrop.addEventListener('click', closeSheets);
btnSettings.addEventListener('click', () => openSheet(settingsSheet, false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

// Marcações do leitor: ficam gravadas no livro (no aparelho)
function markKey(idx) { return currentPageNumber + ':' + idx; }
function getMark(idx) { return (currentBook && currentBook.marks && currentBook.marks[markKey(idx)]) || null; }

function paintMark(idx) {
  const item = sentences[idx];
  if (!item) return;
  const el = item.element;
  const m = getMark(idx);
  if (m && m.c) { el.dataset.hl = '1'; el.style.setProperty('--hlc', m.c); }
  else { delete el.dataset.hl; el.style.removeProperty('--hlc'); }
  if (m && m.n) el.dataset.note = '1'; else delete el.dataset.note;
}

function updateMark(idx, patch) {
  if (!currentBook || !sentences[idx]) return;
  currentBook.marks = currentBook.marks || {};
  const k = markKey(idx);
  const cur = Object.assign({}, currentBook.marks[k] || {}, patch, { p: currentPageNumber, i: idx, t: sentences[idx].text });
  if (!cur.c) delete cur.c;
  if (!cur.n) delete cur.n;
  if (!cur.c && !cur.n) delete currentBook.marks[k]; else currentBook.marks[k] = cur;
  paintMark(idx);
  saveProgress();
}

function renderSwatches() {
  const m = getMark(selectedIdx);
  swatchesBox.innerHTML = '';
  HL_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (m && m.c === c ? ' on' : '');
    b.style.setProperty('--c', c);
    b.setAttribute('aria-label', 'Destacar com esta cor');
    b.addEventListener('click', () => {
      const on = m && m.c === c;
      updateMark(selectedIdx, { c: on ? '' : c });
      renderSwatches();
    });
    swatchesBox.appendChild(b);
  });
}

function openActionSheet(idx) {
  if (!sentences[idx] || !currentBook) return;
  closeSheets();
  selectedIdx = idx;
  const el = sentences[idx].element;
  el.classList.add('selected');
  asTitle.textContent = `${currentBook.title} · pág. ${currentPageNumber}`;
  renderSwatches();
  noteBox.hidden = true;
  actGrid.hidden = false;
  openSheet(actionSheet, true);
  // leva a frase para o alto da tela, para o painel não cobrir
  const cr = readerSection.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  readerSection.scrollBy({ top: er.top - cr.top - cr.height * 0.18, behavior: 'smooth' });
}

function quoteText(idx) {
  return `“${sentences[idx].text}”\n— ${currentBook.title}, pág. ${currentPageNumber}`;
}

async function copyText(txt) {
  try {
    await navigator.clipboard.writeText(txt);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { /* sem permissão */ }
    ta.remove();
  }
}

actGrid.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || selectedIdx < 0) return;
  const idx = selectedIdx;
  const act = btn.dataset.act;
  if (act === 'copy') {
    await copyText(quoteText(idx));
    closeSheets();
    notify('Copiado');
  } else if (act === 'share') {
    const txt = quoteText(idx);
    if (navigator.share) {
      try { await navigator.share({ text: txt }); } catch (err) { /* cancelou */ }
    } else {
      await copyText(txt);
      notify('Copiado (este aparelho não tem compartilhar)');
    }
    closeSheets();
  } else if (act === 'listen') {
    closeSheets();
    playSentence(idx);
  } else if (act === 'note') {
    const m = getMark(idx);
    noteText.value = (m && m.n) || '';
    actGrid.hidden = true;
    noteBox.hidden = false;
    noteText.focus();
  }
});

document.getElementById('noteSave').addEventListener('click', () => {
  if (selectedIdx < 0) return;
  updateMark(selectedIdx, { n: noteText.value.trim() });
  closeSheets();
  notify('Anotação salva');
});

document.getElementById('noteDelete').addEventListener('click', () => {
  if (selectedIdx < 0) return;
  updateMark(selectedIdx, { n: '' });
  closeSheets();
});

// Virar a página como folha (animação) e deslizar o dedo para trocar
function turnPage(dir) {
  const card = document.querySelector('.reader-page-card');
  if (!card) return;
  card.classList.remove('turn-next', 'turn-prev');
  void card.offsetWidth; // reinicia a animação
  card.classList.add(dir === 'next' ? 'turn-next' : 'turn-prev');
}

(function setupSwipe() {
  let sx = 0, sy = 0, st = 0;
  readerSection.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    sx = t.clientX; sy = t.clientY; st = Date.now();
  }, { passive: true });
  readerSection.addEventListener('touchend', (e) => {
    if (!currentLoadedPdf) return;
    if (window.getSelection && String(window.getSelection())) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 45 && Date.now() - st < 700) {
      (dx < 0 ? btnNextPage : btnPrevPage).click();
    }
  }, { passive: true });
})();

// Perfil: progresso, destaques e anotações de todos os livros
let profileTab = 'progress';

function allBooks(cb) {
  if (!db) return cb([]);
  const req = db.transaction(['books'], 'readonly').objectStore('books').getAll();
  req.onsuccess = () => cb(req.result || []);
  req.onerror = () => cb([]);
}

function openAtMark(book, m) {
  book.currentPage = m.p;
  book.currentSentence = m.i;
  openBook(book);
}

function renderProfile() {
  document.querySelectorAll('.chip[data-ptab]').forEach((c) => c.classList.toggle('active', c.dataset.ptab === profileTab));
  allBooks((books) => {
    profileList.innerHTML = '';
    const add = (html, onClick, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'p-card' + (cls ? ' ' + cls : '');
      b.innerHTML = html;
      b.addEventListener('click', onClick);
      profileList.appendChild(b);
      return b;
    };

    if (profileTab === 'progress') {
      books.forEach((book) => {
        const cur = book.currentPage || 1;
        const tot = book.totalPages || 1;
        const isNew = cur <= 1 && !book.currentSentence;
        const pct = isNew ? 0 : Math.min(100, Math.round((cur / tot) * 100));
        add(`<b>${escapeHtml(book.title)}</b><small>${isNew ? 'Ainda não lido' : `Pág. ${cur} de ${tot}`}</small>
             <div class="p-bar"><span><i style="width:${pct}%"></i></span><em>${pct}%</em></div>`, () => openBook(book));
      });
      if (!books.length) profileList.innerHTML = '<p class="p-empty">Adicione um PDF na estante para acompanhar seu progresso.</p>';
      return;
    }

    let count = 0;
    books.forEach((book) => {
      const marks = Object.values(book.marks || {}).sort((a, b) => (a.p - b.p) || (a.i - b.i));
      marks.forEach((m) => {
        if (profileTab === 'highlights' && !m.c) return;
        if (profileTab === 'notes' && !m.n) return;
        count++;
        const body = profileTab === 'notes'
          ? `<q>${escapeHtml(m.n)}</q><small>“${escapeHtml(m.t.length > 110 ? m.t.slice(0, 110) + '…' : m.t)}”</small>`
          : `<q>${escapeHtml(m.t)}</q>`;
        const card = add(`${body}<small>${escapeHtml(book.title)} · pág. ${m.p}</small>`, () => openAtMark(book, m), profileTab === 'highlights' ? 'hl' : '');
        if (m.c) card.style.setProperty('--c', m.c);
      });
    });
    if (!count) {
      profileList.innerHTML = profileTab === 'highlights'
        ? '<p class="p-empty">Toque numa frase durante a leitura e escolha uma cor para destacar.</p>'
        : '<p class="p-empty">Toque numa frase durante a leitura e escolha “Anotação”.</p>';
    }
  });
}

document.querySelectorAll('.chip[data-ptab]').forEach((c) => {
  c.addEventListener('click', () => { profileTab = c.dataset.ptab; renderProfile(); });
});

// Inicialização
window.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  setupThemes();
  initDB();
});