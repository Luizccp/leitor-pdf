// ==========================================
// 1. CONFIGURAÇÃO DO SUPABASE
// ==========================================
const SUPABASE_URL = "https://rgziehivrwbnohtqutts.supabase.co";
const SUPABASE_KEY = "sb_publishable_np_Abvm8QS8nm84ZjlWGKg_AyUtN6DS";

// Inicializa a conexão com o Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 2. ELEMENTOS DO DOM (INTERFACE)
// ==========================================
const userDisplay = document.getElementById("user-display");
const btnLogin = document.getElementById("btn-login");
const btnLogout = document.getElementById("btn-logout");
const authModal = document.getElementById("auth-modal");
const modalTitle = document.getElementById("modal-title");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const btnSubmitAuth = document.getElementById("btn-submit-auth");
const btnToggleAuthMode = document.getElementById("btn-toggle-auth-mode");
const btnCloseModal = document.getElementById("btn-close-modal");

const fileInput = document.getElementById("file-input");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageNumSpan = document.getElementById("page-num");
const pageCountSpan = document.getElementById("page-count");
const playPauseBtn = document.getElementById("play-pause-btn");
const canvas = document.getElementById("pdf-render");
const ctx = canvas.getContext("2d");

// ==========================================
// 3. ESTADO DA APLICAÇÃO
// ==========================================
let currentUser = null;
let isSignUpMode = false;

let pdfDoc = null;
let pageNum = 1;
let pageIsRendering = false;
let pageNumIsPending = null;
let currentPdfName = "";
let currentAudioIndex = 0;
const scale = 1.5;

// ==========================================
// 4. LÓGICA DE AUTENTICAÇÃO (LOGIN / REGISTO)
// ==========================================
btnLogin.addEventListener("click", () => {
  authModal.style.display = "flex";
});

btnCloseModal.addEventListener("click", () => {
  authModal.style.display = "none";
});

btnToggleAuthMode.addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  modalTitle.textContent = isSignUpMode ? "Criar Nova Conta" : "Entrar na Conta";
  btnSubmitAuth.textContent = isSignUpMode ? "Registar" : "Entrar";
  btnToggleAuthMode.textContent = isSignUpMode
    ? "Já tem conta? Entrar"
    : "Não tem conta? Criar registo";
});

btnSubmitAuth.addEventListener("click", async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) {
    alert("Por favor, preencha o e-mail e a palavra-passe.");
    return;
  }

  if (isSignUpMode) {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
      alert("Erro ao registar: " + error.message);
    } else {
      alert("Registo concluído! Já pode iniciar sessão.");
      authModal.style.display = "none";
    }
  } else {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      alert("Erro ao entrar: " + error.message);
    } else {
      authModal.style.display = "none";
    }
  }
});

btnLogout.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

// Deteta automaticamente quando o utilizador entra ou sai
supabaseClient.auth.onAuthStateChange(async (event, session) => {
  if (session && session.user) {
    currentUser = session.user;
    userDisplay.textContent = currentUser.email;
    btnLogin.style.display = "none";
    btnLogout.style.display = "inline-block";

    // Se já houver um PDF aberto ao entrar, sincroniza o progresso guardado
    if (currentPdfName) {
      await carregarProgressoNuvem(currentPdfName);
    }
  } else {
    currentUser = null;
    userDisplay.textContent = "Não autenticado";
    btnLogin.style.display = "inline-block";
    btnLogout.style.display = "none";
  }
});

// ==========================================
// 5. SINCRONIZAÇÃO COM O SUPABASE
// ==========================================
async function salvarProgressoNuvem(pdfName, pagina, audioIndex = 0) {
  if (!currentUser || !pdfName) return;

  try {
    // Procura se já existe um registo deste ficheiro para o utilizador
    const { data: existingRows } = await supabaseClient
      .from("user_progress")
      .select("id")
      .eq("user_id", currentUser.id)
      .eq("pdf_name", pdfName);

    if (existingRows && existingRows.length > 0) {
      // Atualiza a linha existente
      await supabaseClient
        .from("user_progress")
        .update({
          current_page: pagina,
          audio_index: audioIndex,
        })
        .eq("id", existingRows[0].id);
    } else {
      // Cria um novo registo
      await supabaseClient
        .from("user_progress")
        .insert([
          {
            user_id: currentUser.id,
            pdf_name: pdfName,
            current_page: pagina,
            audio_index: audioIndex,
          },
        ]);
    }
  } catch (err) {
    console.error("Erro ao sincronizar progresso com a nuvem:", err);
  }
}

async function carregarProgressoNuvem(pdfName) {
  if (!currentUser || !pdfName) return;

  try {
    const { data, error } = await supabaseClient
      .from("user_progress")
      .select("current_page, audio_index")
      .eq("user_id", currentUser.id)
      .eq("pdf_name", pdfName)
      .maybeSingle();

    if (data && data.current_page) {
      pageNum = data.current_page;
      currentAudioIndex = data.audio_index || 0;
      queueRenderPage(pageNum);
    }
  } catch (err) {
    console.error("Erro ao carregar progresso da nuvem:", err);
  }
}

// ==========================================
// 6. RENDERIZAÇÃO E NAVEGAÇÃO DO PDF
// ==========================================
function renderPage(num) {
  pageIsRendering = true;

  pdfDoc.getPage(num).then((page) => {
    const viewport = page.getViewport({ scale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderCtx = {
      canvasContext: ctx,
      viewport: viewport,
    };

    page.render(renderCtx).promise.then(() => {
      pageIsRendering = false;

      if (pageNumIsPending !== null) {
        renderPage(pageNumIsPending);
        pageNumIsPending = null;
      }
    });

    pageNumSpan.textContent = num;

    // Guarda na nuvem a página onde o utilizador se encontra
    if (currentPdfName) {
      salvarProgressoNuvem(currentPdfName, num, currentAudioIndex);
    }
  });
}

function queueRenderPage(num) {
  if (pageIsRendering) {
    pageNumIsPending = num;
  } else {
    renderPage(num);
  }
}

function showPrevPage() {
  if (pageNum <= 1) return;
  pageNum--;
  queueRenderPage(pageNum);
}

function showNextPage() {
  if (pageNum >= pdfDoc.numPages) return;
  pageNum++;
  queueRenderPage(pageNum);
}

// Ações dos botões de página
prevPageBtn.addEventListener("click", showPrevPage);
nextPageBtn.addEventListener("click", showNextPage);

// ==========================================
// 7. CARREGAMENTO DE ARQUIVOS PDF
// ==========================================
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file || file.type !== "application/pdf") return;

  currentPdfName = file.name;
  pageNum = 1;
  currentAudioIndex = 0;

  const fileReader = new FileReader();
  fileReader.onload = function () {
    const typedarray = new Uint8Array(this.result);

    pdfjsLib.getDocument(typedarray).promise.then(async (pdfDoc_) => {
      pdfDoc = pdfDoc_;
      pageCountSpan.textContent = pdfDoc.numPages;

      // Se o utilizador estiver autenticado, tenta recuperar a página onde parou
      if (currentUser) {
        await carregarProgressoNuvem(currentPdfName);
      } else {
        renderPage(pageNum);
      }
    });
  };

  fileReader.readAsArrayBuffer(file);
});