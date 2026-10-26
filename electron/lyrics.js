const stateIcon = document.getElementById('state-icon');
const trackTitle = document.getElementById('track-title');
const previousLine = document.getElementById('lyric-previous');
const currentLine = document.getElementById('lyric-current');
const nextLine = document.getElementById('lyric-next');
const lineButton = document.getElementById('lyrics-lines');
const progressFill = document.getElementById('progress-fill');
const shell = document.getElementById('lyrics-shell');
const bridge = window.qqdlDesktopOverlay;

let currentState = null;
let fontSize = Number.parseInt(localStorage.getItem('lyrics-font-size') || '28', 10);

if (!Number.isFinite(fontSize)) fontSize = 28;
fontSize = Math.min(48, Math.max(18, fontSize));

function setText(element, value) {
  const text = typeof value === 'string' ? value : '';
  if (element.textContent !== text) element.textContent = text;
}

function applyFontSize() {
  document.documentElement.style.setProperty('--font-size', `${fontSize}px`);
}

function render(nextState) {
  currentState = nextState && typeof nextState === 'object' ? nextState : {};
  setText(trackTitle, currentState.title || '桌面歌词');
  setText(previousLine, currentState.previous || '');
  setText(currentLine, currentState.current || currentState.title || '播放歌曲后显示歌词');
  setText(nextLine, currentState.next || '');

  const canSeek = Number.isFinite(currentState.seekTime);
  lineButton.classList.toggle('can-seek', canSeek);
  lineButton.title = canSeek ? '点击当前歌词跳转' : '当前歌词不可跳转';

  const progress = Number(currentState.progress);
  const safeProgress = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  progressFill.style.width = `${safeProgress * 100}%`;
  stateIcon.classList.toggle('is-playing', currentState.playing === true);
}

function changeFontSize(delta) {
  fontSize = Math.min(48, Math.max(18, fontSize + delta));
  localStorage.setItem('lyrics-font-size', String(fontSize));
  applyFontSize();
}

document.getElementById('font-down').addEventListener('click', () => changeFontSize(-2));
document.getElementById('font-up').addEventListener('click', () => changeFontSize(2));
document.getElementById('close-button').addEventListener('click', () => bridge.close());

lineButton.addEventListener('click', () => {
  if (Number.isFinite(currentState?.seekTime)) bridge.seek(currentState.seekTime);
});

shell.addEventListener('dblclick', (event) => {
  if (event.target.closest('button')) return;
  bridge.close();
});

bridge.onState(render);
bridge.ready();
applyFontSize();
