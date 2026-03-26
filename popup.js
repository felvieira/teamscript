// TeamScript — popup controller
let transcriptData = null;
let transcriptEntries = [];
let meetingTitle = '';

const $ = (id) => document.getElementById(id);

const btnExtract = $('btnExtract');
const statusCard = $('statusCard');
const dot = $('dot');
const statusText = $('statusText');
const progress = $('progress');
const progressBar = $('progressBar');
const resultsSection = $('resultsSection');
const searchInput = $('searchInput');
const searchCount = $('searchCount');
const preview = $('preview');

function setStatus(type, text) {
  dot.className = 'dot ' + type;
  statusCard.className = 'status-card' + (type === 'running' ? ' active' : type === 'done' ? ' success' : type === 'error' ? ' error' : '');
  statusText.textContent = text;
}

function showProgress() {
  progress.classList.add('visible');
  let w = 0;
  const iv = setInterval(() => {
    w = Math.min(w + Math.random() * 10, 92);
    progressBar.style.width = w + '%';
  }, 400);
  return iv;
}

function hideProgress() {
  progressBar.style.width = '100%';
  setTimeout(() => {
    progress.classList.remove('visible');
    progressBar.style.width = '0%';
  }, 600);
}

// ── Extract ──
btnExtract.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  setStatus('running', 'Extraindo transcrição...');
  btnExtract.disabled = true;
  resultsSection.classList.add('hidden');

  const iv = showProgress();

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractTranscript,
    });
    clearInterval(iv);
    hideProgress();

    const result = results[0]?.result;
    if (!result || result.error) {
      setStatus('error', result?.error || 'Painel de transcrição não encontrado.');
      btnExtract.disabled = false;
      return;
    }

    transcriptData = result.text;
    transcriptEntries = result.entries;
    meetingTitle = result.title || 'transcricao';

    setStatus('done', `${result.total} entradas extraídas!`);
    $('statEntries').textContent = result.total;
    $('statSpeakers').textContent = result.speakers;
    $('statDuration').textContent = result.duration || '—';

    resultsSection.classList.remove('hidden');
    renderPreview(transcriptEntries);

    btnExtract.disabled = false;
    btnExtract.innerHTML = '<span>🔄</span> Extrair Novamente';
  } catch (err) {
    clearInterval(iv);
    hideProgress();
    setStatus('error', 'Erro: ' + err.message);
    btnExtract.disabled = false;
  }
});

// ── Preview renderer ──
function renderPreview(entries, query) {
  preview.classList.remove('hidden');
  const html = entries.slice(0, 100).map(e => {
    let text = escapeHtml(e.text);
    if (query) {
      const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
      text = text.replace(re, '<span class="highlight">$1</span>');
    }
    return `<div class="line"><span class="time">[${e.timestamp}]</span> <span class="speaker">${escapeHtml(e.speaker)}:</span> ${text}</div>`;
  }).join('');
  preview.innerHTML = html || '<div class="line" style="color:#666">Nenhum resultado</div>';
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Search ──
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (!q) {
    searchCount.classList.add('hidden');
    renderPreview(transcriptEntries);
    return;
  }
  const filtered = transcriptEntries.filter(e =>
    e.text.toLowerCase().includes(q.toLowerCase()) ||
    e.speaker.toLowerCase().includes(q.toLowerCase())
  );
  searchCount.textContent = `${filtered.length} found`;
  searchCount.classList.remove('hidden');
  renderPreview(filtered, q);
});

// ── Downloads ──
$('btnTxt').addEventListener('click', () => {
  if (!transcriptData) return;
  download(transcriptData, `${meetingTitle}.txt`, 'text/plain');
});

$('btnMd').addEventListener('click', () => {
  if (!transcriptEntries.length) return;
  let md = `# ${meetingTitle.replace(/_/g, ' ')}\n\n`;
  let lastSpeaker = '';
  transcriptEntries.forEach(e => {
    if (e.speaker !== lastSpeaker) {
      md += `\n### ${e.speaker}\n`;
      lastSpeaker = e.speaker;
    }
    md += `> \`${e.timestamp}\` ${e.text}\n\n`;
  });
  download(md, `${meetingTitle}.md`, 'text/markdown');
});

$('btnSrt').addEventListener('click', () => {
  if (!transcriptEntries.length) return;
  const srt = transcriptEntries.map((e, i) => {
    const start = toSrtTime(e.timestamp);
    const next = transcriptEntries[i + 1];
    const end = next ? toSrtTime(next.timestamp) : addSeconds(start, 3);
    return `${i + 1}\n${start} --> ${end}\n${e.speaker}: ${e.text}\n`;
  }).join('\n');
  download(srt, `${meetingTitle}.srt`, 'text/srt');
});

$('btnJson').addEventListener('click', () => {
  if (!transcriptEntries.length) return;
  const json = JSON.stringify({ title: meetingTitle, entries: transcriptEntries }, null, 2);
  download(json, `${meetingTitle}.json`, 'application/json');
});

$('btnCopy').addEventListener('click', async () => {
  if (!transcriptData) return;
  await navigator.clipboard.writeText(transcriptData);
  $('btnCopy').innerHTML = '✅ Copiado!';
  setTimeout(() => { $('btnCopy').innerHTML = '📋 Copiar tudo'; }, 2000);
});

function toSrtTime(ts) {
  const parts = ts.split(':').map(Number);
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) { h = parts[0]; m = parts[1]; s = parts[2]; }
  else if (parts.length === 2) { m = parts[0]; s = parts[1]; }
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},000`;
}

function addSeconds(srtTime, sec) {
  const [h, m, rest] = srtTime.split(':');
  const s = parseInt(rest) + sec;
  return `${h}:${m}:${String(s).padStart(2,'0')},000`;
}

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Extraction function (injected into page) ──
function extractTranscript() {
  return new Promise((resolve) => {
    const scrollContainer = document.getElementById('scrollToTargetTargetedFocusZone');

    if (!scrollContainer) {
      resolve({ error: 'Painel de transcrição não encontrado. Abra o painel "Transcrição" na reunião.' });
      return;
    }

    const collected = new Map();

    function parseTime(ariaLabel) {
      if (!ariaLabel) return '0:00';
      const h = ariaLabel.match(/(\d+)\s*hour/i)?.[1] || ariaLabel.match(/(\d+)\s*hora/)?.[1];
      const m = ariaLabel.match(/(\d+)\s*minute/i)?.[1] || ariaLabel.match(/(\d+)\s*minuto/)?.[1];
      const s = ariaLabel.match(/(\d+)\s*second/i)?.[1] || ariaLabel.match(/(\d+)\s*segundo/)?.[1];
      const mm = m ? String(m).padStart(2, '0') : '00';
      const ss = s ? String(s).padStart(2, '0') : '00';
      if (h) return `${h}:${mm}:${ss}`;
      return `${parseInt(m || 0)}:${ss}`;
    }

    function collectVisible() {
      document.querySelectorAll('[data-list-index]').forEach(item => {
        const index = item.getAttribute('data-list-index');
        if (collected.has(index)) return;
        const speaker = item.querySelector('[class*="itemDisplayName"]')?.innerText?.trim() || null;
        const entryEl = item.querySelector('[id^="entry-"]');
        const ariaLabel = entryEl?.getAttribute('aria-label') || '';
        const timestamp = parseTime(ariaLabel);
        const text = item.querySelector('[class*="entryText"]')?.innerText?.trim() || null;
        if (text) {
          collected.set(index, { index: parseInt(index), speaker, timestamp, text });
        }
      });
    }

    function resolveSpeakers(entries) {
      let lastSpeaker = '';
      return entries.map(e => {
        if (e.speaker) lastSpeaker = e.speaker;
        return { ...e, speaker: lastSpeaker || 'Unknown' };
      });
    }

    const title = document.title
      .replace(/[^a-zA-Z0-9À-ÿ\s_-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 60) || 'transcricao';

    collectVisible();

    const interval = setInterval(() => {
      collectVisible();
      const before = scrollContainer.scrollTop;
      scrollContainer.scrollTop += 300;

      setTimeout(() => {
        if (scrollContainer.scrollTop === before) {
          clearInterval(interval);

          const sorted = [...collected.values()].sort((a, b) => a.index - b.index);
          const entries = resolveSpeakers(sorted);
          const speakers = new Set(entries.map(e => e.speaker)).size;
          const lines = entries.map(e => `[${e.timestamp}] ${e.speaker}: ${e.text}`);
          const text = lines.join('\n');

          // Calculate duration from first and last timestamp
          let duration = '—';
          if (entries.length > 1) {
            const last = entries[entries.length - 1].timestamp;
            duration = last;
          }

          resolve({ text, entries, total: collected.size, speakers, duration, title });
        }
      }, 100);
    }, 800);
  });
}
