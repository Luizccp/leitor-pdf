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
function setupVoices() {
  voiceSelect.innerHTML = `
    <option value="pt-BR-FranciscaNeural" selected>Francisca Neural (pt-BR - Feminina)</option>
    <option value="pt-BR-AntonioNeural">Antonio Neural (pt-BR - Masculino)</option>
    <option value="pt-BR-ThalitaNeural">Thalita Neural (pt-BR - Feminina)</option>
  `;
}
setupVoices();

// 4. Alternância de Telas
function showShelfView() {
  shelfSection.style.display = 'block';
  readerSection.style.display = 'none';
  playerBar.style.display = 'none';
  pageIndicator.style.display = 'none';
  btnShelfView.classList.add('active-tab');
  btnReaderView.classList.remove('active-tab');
  stopAudio();
  loadShelf();
}

function showReaderView() {
  shelfSection.style.display = 'none';
  readerSection.style.display = 'flex';
  playerBar.style.display = 'flex';
  if (currentBook) pageIndicator.style.display = 'inline-block';
  btnShelfView.classList.remove('active-tab');
  btnReaderView.classList.add('active-tab');
}

btnShelfView.addEventListener('click', (e) => {
  e.preventDefault();
  showShelfView();
});

btnReaderView.addEventListener('click', (e) => {
  e.preventDefault();
  showReaderView();
});

// 5. Carregar Livros da Estante com Capa e Progresso
function loadShelf() {
  if (!db) return;
  const transaction = db.transaction(["books"], "readonly");
  const store = transaction.objectStore("books");
  const request = store.getAll();

  request.onsuccess = () => {
    const books = request.result;
    booksGrid.innerHTML = '';

    if (books.length === 0) {
      booksGrid.innerHTML = `<p class="placeholder-text" style="grid-column: 1/-1;">Sua estante está vazia. Clique em <strong>+ Adicionar Livro</strong> para começar.</p>`;
      return;
    }

    books.forEach(book => {
      const card = document.createElement('div');
      card.className = 'book-card';

      const currentPage = book.currentPage || 1;
      const totalPages = book.totalPages || 1;
      const percent = Math.min(100, Math.round((currentPage / totalPages) * 100));

      const coverHtml = book.cover 
        ? `<img src="${book.cover}" class="book-card-cover-img" alt="Capa de ${book.title}">`
        : `<div class="book-card-cover-wrap"><span style="font-size:2.5rem;">📖</span></div>`;

      card.innerHTML = `
        <div class="book-card-cover-wrap">
          ${coverHtml}
        </div>
        
        <div class="progress-container">
          <div class="progress-info">
            <span>Progresso</span>
            <span>${percent}%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${percent}%;"></div>
          </div>
        </div>

        <div class="book-card-info">
          <h3 title="${book.title}">${book.title}</h3>
        </div>

        <div class="book-card-actions">
          <button type="button" class="btn-delete-book" title="Excluir exemplar">Excluir</button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-delete-book')) return;
        openBook(book);
      });

      const delBtn = card.querySelector('.btn-delete-book');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteBook(book.id);
      });

      booksGrid.appendChild(card);
    });
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
        loadShelf();
        openBook(bookRecord);
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

// 10. Carregar Página com Suporte a Reprodução Contínua
async function loadPage(pageNum, startSentenceIndex = 0, autoPlay = false) {
  if (!currentLoadedPdf) return;

  // Só interrompe o reprodutor se NÃO for avanço automático de leitura
  if (!autoPlay) {
    stopAudio();
  } else {
    audioPlayer.pause();
  }

  currentPageNumber = pageNum;
  currentBook.currentPage = pageNum;
  currentBook.currentSentence = startSentenceIndex;

  saveProgress();

  const total = currentLoadedPdf.numPages;
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
    const pageStrings = content.items.map(item => item.str).join(' ');
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

// 12. Renderização das Sentenças
function renderReaderMode(rawText, initialHighlightIndex = 0) {
  textContainer.innerHTML = '';
  const normalized = rawText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    textContainer.innerHTML = '<p class="placeholder-text">Esta página não contém texto legível.</p>';
    sentences = [];
    return;
  }

  const segments = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
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
        playSentence(itemIndex);
      });

      textContainer.appendChild(span);
      sentences.push({ text: textPart, element: span });
    }
  });

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
async function playSentence(index) {
  if (index < 0 || index >= sentences.length) {
    stopAudio();
    return;
  }

  audioPlayer.pause();
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

  const ratePercent = Math.round((currentSpeed - 1.0) * 100);
  const rateParam = `${ratePercent >= 0 ? '+' : ''}${ratePercent}%`;

  try {
    const res = await fetch("http://127.0.0.1:8000/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: item.text,
        voice: voiceSelect.value,
        rate: rateParam
      })
    });

    if (!res.ok) throw new Error(`Erro na síntese: ${res.status}`);

    const data = await res.json();
    audioPlayer.src = data.audio_url;
    audioPlayer.playbackRate = currentSpeed;
    await audioPlayer.play();

    isPlaying = true;
    playPauseBtn.textContent = '⏸';
  } catch (err) {
    console.error("Falha ao tocar frase:", err);
    isPlaying = false;
    playPauseBtn.textContent = '▶';
  }
}

// Transição Ininterrupta: próxima frase ou próxima página sem pausar
audioPlayer.onended = () => {
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
};

function stopAudio() {
  audioPlayer.pause();
  isPlaying = false;
  playPauseBtn.textContent = '▶';
  document.querySelectorAll('.sentence.active-sentence').forEach(el => {
    el.classList.remove('active-sentence');
  });
}

// 15. Controles do Reprodutor
playPauseBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (isPlaying) {
    stopAudio();
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
  speedBtn.textContent = `${currentSpeed}x`;
  audioPlayer.playbackRate = currentSpeed;
});

// Inicialização
window.addEventListener('DOMContentLoaded', () => {
  setupThemes();
  initDB();
});