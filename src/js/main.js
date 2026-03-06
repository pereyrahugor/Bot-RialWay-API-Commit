// Obtener el nombre del asistente dinámicamente y actualizar el div
window.addEventListener('DOMContentLoaded', function () {
    fetch('/api/assistant-name')
        .then(res => res.json())
        .then(data => {
            var el = document.getElementById('assistantName');
            if (el && data.name) {
                el.textContent = data.name;
            }
        });
});
const textarea = document.getElementById('input')
const input = document.getElementById('input')
const sendBtn = document.getElementById('send')
const chat = document.getElementById('chat') // style - agus



// ===== Viewport dinámico para Chrome/Firefox/iOS =====
function setAppVh() {
    // Prioriza visualViewport si existe; si no, usa innerHeight
    const h = (window.visualViewport?.height || window.innerHeight);
    document.documentElement.style.setProperty('--app-vh', `${h}px`);
}
setAppVh();

// Eventos que disparan cambio real de alto en mobile
window.addEventListener('resize', setAppVh, { passive: true })
window.addEventListener('orientationchange', setAppVh, { passive: true })
window.addEventListener('pageshow', setAppVh, { passive: true }) // vuelve de bfcache
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppVh, { passive: true })
    window.visualViewport.addEventListener('scroll', setAppVh, { passive: true }) // FF/Chrome barras
}

/* ============================================
   AUTOSIZE: solo crecer en 2+ líneas
   ============================================ */

// Lee estilos actuales del textarea
function computeHeights() {
    const cs = getComputedStyle(textarea)
    const minH = parseFloat(cs.minHeight) || 45
    const maxH = parseFloat(cs.maxHeight) || 120
    const lineH = parseFloat(cs.lineHeight) || 20
    const vPad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    const vBorder = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
    const oneLine = Math.ceil(lineH + vPad + vBorder)
    // Altura base = mayor entre min-height y una línea real
    const baseH = Math.max(minH, oneLine)
    return { MIN_H: minH, MAX_H: maxH, BASE_H: baseH }
}

let { MIN_H, MAX_H, BASE_H } = computeHeights()
const HYST = 1 // px de tolerancia para evitar saltitos

function autosizeSmart(el) {
    // Si está vacío, vuelve a base
    if (!el.value.trim()) {
        el.style.height = BASE_H + 'px'
        return
    }

    // Medir wrap partiendo desde base
    el.style.height = BASE_H + 'px'
    const sh = el.scrollHeight

    // Si entra en una sola línea, no crecer
    if (sh <= BASE_H + HYST) {
        el.style.height = BASE_H + 'px'
        return
    }

    // 2+ líneas: crecer hasta el tope
    el.style.height = Math.min(sh, MAX_H) + 'px'
}

// Inicializa altura base
textarea.style.height = BASE_H + 'px'

// Recalcular en input
textarea.addEventListener('input', function () {
    autosizeSmart(this)
})

// Recalcular base si cambia layout (rotación/teclado)
window.addEventListener('resize', () => {
    const prevBase = BASE_H
        ; ({ MIN_H, MAX_H, BASE_H } = computeHeights())
    // Si estaba en 1 línea, mantener base; si estaba alto, recalcular con nuevo base/tope
    if ((parseFloat(textarea.style.height) || prevBase) <= prevBase + HYST) {
        textarea.style.height = BASE_H + 'px'
    } else {
        autosizeSmart(textarea)
    }
})

/* ============================================
   UX: mantener scroll al fondo al escribir/enfocar
   ============================================ */
function scrollBottom() {
    chat.scrollTop = chat.scrollHeight
}
textarea.addEventListener('focus', () => {
    autosizeSmart(textarea) // asegura altura correcta al enfocar
    scrollBottom()
})
textarea.addEventListener('input', scrollBottom)

/* ============================================
   Envío de mensajes
   ============================================ */
async function sendMessage() {
    const msg = input.value.trim()
    if (!msg) return
    addMessage(msg, 'user')
    input.value = ''

    // Reset de altura correcto (usa BASE_H)
    autosizeSmart(textarea)

    try {
        const res = await fetch('/webchat-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        })
        const data = await res.json()
        addMessage(data.reply, 'bot')
    } catch (err) {
        addMessage('Hubo un error procesando tu mensaje.', 'bot')
    }
}

// Evento para el clip de adjuntos
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attach');

if (attachBtn) {
    attachBtn.onclick = function (e) {
        e.preventDefault();
        fileInput.click();
    };
}

if (fileInput) {
    fileInput.onchange = async function () {
        const file = fileInput.files[0];
        if (!file) return;

        // Limite de 15MB para prevenir error de red en Railway
        if (file.size > 15 * 1024 * 1024) {
            alert("El archivo es demasiado grande (Máximo soportado: 15MB)");
            fileInput.value = '';
            return;
        }

        // Reset UI altura (usa BASE_H)
        autosizeSmart(textarea);

        if (file.type.startsWith('image/')) {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 1200;
                let width = img.width;
                let height = img.height;
                if (width > height && width > MAX_SIZE) {
                    height *= MAX_SIZE / width;
                    width = MAX_SIZE;
                } else if (height > MAX_SIZE) {
                    width *= MAX_SIZE / height;
                    height = MAX_SIZE;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // Convertir y enviar payload optimizado
                const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
                sendPayload('image', optimizedBase64, file.name, 'image/jpeg');
            };
            img.src = URL.createObjectURL(file);
        } else {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result.split(',')[1];
                let type = 'document';
                if (file.type.startsWith('audio/')) type = 'audio';
                else if (file.type.startsWith('video/')) type = 'video';
                sendPayload(type, base64, file.name, file.type || 'application/octet-stream');
            };
            reader.readAsDataURL(file);
        }

        function sendPayload(type, base64, filename, mimeType) {
            const msgPayload = {
                message: "",
                file: {
                    base64: base64,
                    name: filename,
                    mime: mimeType,
                    type: type
                }
            };

            const displayType = type === 'image' ? '🖼️' : (type === 'video' ? '📽️' : '📎');
            addMessage(`${displayType} ${filename}`, 'user');
            fileInput.value = '';

            fetch('/webchat-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(msgPayload)
            }).then(res => res.json()).then(data => {
                if (data.reply) addMessage(data.reply, 'bot');
            }).catch(err => {
                addMessage('Hubo un error procesando tu archivo.', 'bot');
            });
        }
    };
}

// Enter envía / Shift+Enter = nueva línea
sendBtn.onclick = sendMessage
input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
    }
})

function addMessage(text, type) {
    const div = document.createElement('div')
    div.className = 'msg ' + type
    div.innerText = text
    chat.appendChild(div)
    chat.scrollTop = chat.scrollHeight

    // Reproducir sonido si es respuesta del bot
    if (type === 'bot') {
        let audio = document.getElementById('msgReceivedAudio');
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = 'msgReceivedAudio';
            audio.src = 'assets/msgReceived.mp3';
            audio.style.display = 'none';
            document.body.appendChild(audio);
        }
        audio.currentTime = 0;
        audio.play();
    }
}