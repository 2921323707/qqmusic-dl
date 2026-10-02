/* qqmusic-dl 产品动画驱动：标题逐字 / 打字机 / 进度计数 / 重播 */
(() => {
  const stage = document.getElementById('stage');
  const taglineEl = document.getElementById('tagline-text');
  const queryEl = document.getElementById('mock-query');
  const pctEl = document.getElementById('mock-pct');

  const TAGLINE = '输入歌名 · 选择音质 · 下载 —— 一个轻量的 QQ 音乐下载服务';
  const QUERY = '稻香';

  let timers = [];
  let rafId = 0;

  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const clearAll = () => {
    timers.forEach(clearTimeout);
    timers = [];
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  /** 标题拆字 + 为需要错峰的元素设置 --i */
  function prepare() {
    const title = document.querySelector('.title');
    const text = title.getAttribute('aria-label') || 'qqmusic-dl';
    title.textContent = '';
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.setProperty('--i', i);
      title.append(s);
    });
    document.querySelectorAll('.chip, .feat, .mock-row').forEach((el, i) => {
      el.style.setProperty('--i', i);
    });
  }

  /** 打字机 */
  function typeText(el, text, speed) {
    el.textContent = '';
    [...text].forEach((ch, i) => later(() => { el.textContent += ch; }, speed * i));
  }

  /** 进度百分比（与 CSS fill 7.3s→9.3s 同步） */
  function runCounter() {
    const t0 = Date.now();
    const tick = () => {
      const p = Math.min(100, Math.round(((Date.now() - t0) / 2000) * 100));
      pctEl.textContent = `${p}%`;
      if (p < 100) rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  function play() {
    clearAll();
    stage.classList.remove('playing');
    void stage.offsetWidth; // 强制 reflow，使 CSS 动画重新播放
    stage.classList.add('playing');

    // 重置 JS 驱动状态
    taglineEl.textContent = '';
    queryEl.textContent = '';
    pctEl.textContent = '0%';

    later(() => typeText(taglineEl, TAGLINE, 85), 1400);   // 标语
    later(() => typeText(queryEl, QUERY, 230), 3400);      // 搜索词
    later(runCounter, 7300);                                // 进度计数
  }

  document.getElementById('replay').addEventListener('click', play);
  prepare();
  play();
})();
