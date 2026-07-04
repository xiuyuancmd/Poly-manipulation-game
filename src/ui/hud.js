// DOM HUD: top bar (level/timer), right panel (target preview + similarity
// gauge + hold ring), bottom toolbar (tools), toasts and overlays. All
// user-facing strings are Chinese.

import { drawTargetPreview } from '../render/render2d.js';
import { drawTargetPreview3D } from '../render/render3d.js';
import { dialFrac } from './dial.js';

const RING_R = 40;
const RING_C = 2 * Math.PI * RING_R;
// Outer score arc: the live similarity needle, wrapped around the hold ring.
const SCORE_R = 47;
const SCORE_C = 2 * Math.PI * SCORE_R;

export class HUD {
  constructor(root, cb) {
    this.cb = cb;
    root.insertAdjacentHTML('beforeend', `
      <div id="hud">
        <div id="topbar" class="hidden">
          <span id="level-name"></span>
          <span id="timer">0:00</span>
          <span id="target-progress"></span>
          <span class="spacer"></span>
          <button id="btn-restart" title="重开本关 (R)">重开</button>
          <button id="btn-menu">关卡列表</button>
        </div>
        <div id="sidepanel" class="hidden">
          <div class="panel-title">目标 <span id="target-name"></span></div>
          <canvas id="target-preview" width="212" height="150"></canvas>
          <div id="gauge">
            <svg width="110" height="110" viewBox="0 0 110 110">
              <circle class="ring-bg" cx="55" cy="55" r="${RING_R}"></circle>
              <circle id="ring-hold" cx="55" cy="55" r="${RING_R}"
                stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}"></circle>
              <circle id="ring-score" cx="55" cy="55" r="${SCORE_R}"
                stroke-dasharray="${SCORE_C.toFixed(1)}" stroke-dashoffset="${SCORE_C.toFixed(1)}"></circle>
              <line id="ring-tick" x1="98" y1="55" x2="106" y2="55"></line>
            </svg>
            <div id="score-num">0</div>
          </div>
          <div class="bars">
            <div class="bar-row"><span>外形</span><div class="bar"><div id="bar-outline"></div><div id="mark-outline" class="mark"></div></div></div>
            <div class="bar-row"><span>管道</span><div class="bar"><div id="bar-pipes"></div></div></div>
          </div>
          <div id="cutoff-label"></div>
          <div id="topo-warn" class="hidden">⚠ 管路结构不符 · 读数被压至 25%</div>
          <div id="hint-text"></div>
        </div>
        <div id="toolbar" class="hidden">
          <button data-tool="pull" class="tool active">🖐 牵拉 <kbd>1</kbd></button>
          <button data-tool="cut" class="tool">✂️ 切割 <kbd>2</kbd></button>
          <button data-tool="glue" class="tool">🔗 粘合 <kbd>3</kbd></button>
          <span id="controls-chip" title="控制点 = 抓取 + 图钉">◉ 0/3</span>
        </div>
        <div id="toast" class="hidden"></div>
        <div id="banner" class="hidden"></div>
        <div id="menu" class="overlay">
          <h1>形变工坊 <small>PolyForm</small></h1>
          <p class="tagline">拉扯、切割、粘合一块物性未知的工程软材料——内部管路的材质，要靠你亲手试出来。</p>
          <div id="level-grid"></div>
          <p class="help">操作：拖拽=抓取（最多 3 个控制点）· 双击=钉住/解除 · 切割须从软体外下刀 · 相似度达标并保持 3 秒即完成目标</p>
        </div>
        <div id="result" class="overlay hidden">
          <h2 id="result-title"></h2>
          <p id="result-detail"></p>
          <div class="result-buttons">
            <button id="btn-retry">再试一次</button>
            <button id="btn-next" class="hidden">下一关</button>
            <button id="btn-result-menu">关卡列表</button>
          </div>
        </div>
      </div>`);

    this.$ = (sel) => root.querySelector(sel);
    this.els = {
      topbar: this.$('#topbar'), sidepanel: this.$('#sidepanel'), toolbar: this.$('#toolbar'),
      levelName: this.$('#level-name'), timer: this.$('#timer'), progress: this.$('#target-progress'),
      targetName: this.$('#target-name'), preview: this.$('#target-preview'),
      gauge: this.$('#gauge'),
      scoreNum: this.$('#score-num'), ringHold: this.$('#ring-hold'),
      ringScore: this.$('#ring-score'), ringTick: this.$('#ring-tick'),
      barOutline: this.$('#bar-outline'), barPipes: this.$('#bar-pipes'),
      cutoffLabel: this.$('#cutoff-label'), topoWarn: this.$('#topo-warn'), hint: this.$('#hint-text'),
      controlsChip: this.$('#controls-chip'), toast: this.$('#toast'), banner: this.$('#banner'),
      menu: this.$('#menu'), levelGrid: this.$('#level-grid'),
      result: this.$('#result'), resultTitle: this.$('#result-title'), resultDetail: this.$('#result-detail'),
      btnNext: this.$('#btn-next'),
    };

    this.$('#btn-restart').onclick = () => cb.onRestart();
    this.$('#btn-menu').onclick = () => cb.onMenu();
    this.$('#btn-retry').onclick = () => cb.onRestart();
    this.$('#btn-result-menu').onclick = () => cb.onMenu();
    this.$('#btn-next').onclick = () => cb.onNext();
    for (const b of root.querySelectorAll('.tool')) {
      b.onclick = () => cb.onTool(b.dataset.tool);
    }
    this._toastTimer = null;
    // Topology-warning attention flash: one-shot on the ok -> broken edge.
    this._topoOk = true;
    this.els.topoWarn.addEventListener('animationend',
      () => this.els.topoWarn.classList.remove('flash'));
    // Gauge lock-in flash: one-shot on target completion, self-removing.
    this.els.gauge.addEventListener('animationend',
      () => this.els.gauge.classList.remove('locked'));
  }

  /** One-shot "reading locked" flash on the gauge (0.6 s, runs exactly once;
   *  the class removes itself on animationend). */
  gaugeLock() {
    this.els.gauge.classList.remove('locked');
    void this.els.gauge.offsetWidth; // restart if a flash was mid-flight
    this.els.gauge.classList.add('locked');
  }

  showMenu(levels, progress) {
    this.els.menu.classList.remove('hidden');
    this.els.result.classList.add('hidden');
    for (const el of [this.els.topbar, this.els.sidepanel, this.els.toolbar]) el.classList.add('hidden');
    this.els.levelGrid.innerHTML = '';
    levels.forEach((lv, i) => {
      const done = progress[lv.id]?.done;
      const card = document.createElement('button');
      card.className = 'level-card' + (done ? ' done' : '');
      card.innerHTML = `<span class="lv-num">${i + 1}</span>
        <span class="lv-name">${lv.name}</span>
        <span class="lv-meta">${lv.dim === 3 ? '3D' : '2D'} · ${lv.targets.length} 个目标 · ${Math.round(lv.timeLimit / 60)}min${done ? ' · ✓' : ''}</span>`;
      card.onclick = () => this.cb.onSelectLevel(i);
      this.els.levelGrid.appendChild(card);
    });
  }

  showGame(levelName) {
    this.els.menu.classList.add('hidden');
    this.els.result.classList.add('hidden');
    this.els.banner.classList.add('hidden');
    for (const el of [this.els.topbar, this.els.sidepanel, this.els.toolbar]) el.classList.remove('hidden');
    this.els.levelName.textContent = levelName;
  }

  setTimer(secondsLeft) {
    const s = Math.max(0, Math.ceil(secondsLeft));
    this.els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.els.timer.classList.toggle('urgent', secondsLeft < 30);
  }

  setTarget(index, total, spec, cutoff) {
    this.els.progress.textContent = `目标 ${index + 1}/${total}`;
    this.els.targetName.textContent = spec.name ? `「${spec.name}」` : '';
    this.els.cutoffLabel.textContent = `达标线 ${cutoff} · 保持 3 秒`;
    // Cutoff tick on the score dial: same dialFrac mapping as the arc, so the
    // arc tip crosses the tick on exactly the frame the score crosses cutoff.
    this.els.ringTick.setAttribute('transform',
      `rotate(${(360 * dialFrac(cutoff)).toFixed(2)} 55 55)`);
    if (spec.is3D) drawTargetPreview3D(this.els.preview, spec);
    else drawTargetPreview(this.els.preview, spec);
  }

  setScore(sim, cutoff, holdFrac) {
    // The number is the raw instrument reading (one decimal, no dial mapping);
    // pass/fail compares the unrounded value so text and hold logic agree.
    const total = sim?.total ?? 0;
    this.els.scoreNum.textContent = total.toFixed(1);
    const passing = total >= cutoff;
    this.els.scoreNum.classList.toggle('passing', passing);
    // The arc is the same reading through the dial gamma (visual scale only).
    this.els.ringScore.style.strokeDashoffset =
      ((1 - dialFrac(total)) * SCORE_C).toFixed(2);
    this.els.ringScore.classList.toggle('passing', passing);
    this.els.barOutline.style.width = `${Math.round(sim?.outline ?? 0)}%`;
    this.els.barPipes.style.width = `${Math.round(sim?.pipes ?? 0)}%`;
    this.els.ringHold.style.strokeDashoffset = ((1 - Math.min(1, holdFrac)) * RING_C).toFixed(1);
    const topoBad = sim?.topologyOk === false;
    this.els.topoWarn.classList.toggle('hidden', !topoBad);
    if (topoBad && this._topoOk) {
      // ok/unknown -> broken transition: flash the warning once (~1 s, the
      // CSS animation runs a fixed 3 blinks and stops — never infinite).
      this.els.topoWarn.classList.remove('flash');
      void this.els.topoWarn.offsetWidth; // restart if a flash was mid-flight
      this.els.topoWarn.classList.add('flash');
    }
    this._topoOk = !topoBad;
  }

  setControls(used, max) {
    this.els.controlsChip.textContent = `◉ ${used}/${max}`;
    this.els.controlsChip.classList.toggle('full', used >= max);
  }

  setTool(tool) {
    for (const b of document.querySelectorAll('.tool')) {
      b.classList.toggle('active', b.dataset.tool === tool);
    }
  }

  setHint(text) { this.els.hint.textContent = text ?? ''; }

  toast(text, ms = 2200) {
    this.els.toast.textContent = text;
    this.els.toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.els.toast.classList.add('hidden'), ms);
  }

  banner(text, ms = 1400) {
    this.els.banner.textContent = text;
    this.els.banner.classList.remove('hidden');
    setTimeout(() => this.els.banner.classList.add('hidden'), ms);
  }

  showResult({ won, detail, hasNext }) {
    this.els.result.classList.remove('hidden');
    this.els.resultTitle.textContent = won ? '🎉 过关！' : '⏱ 时间到';
    this.els.resultDetail.textContent = detail;
    this.els.btnNext.classList.toggle('hidden', !(won && hasNext));
  }
}
