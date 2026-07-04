// Game orchestrator: level lifecycle, fixed-step driving of the session,
// similarity evaluation cadence, hold-to-complete logic, timer, HUD wiring.
// Dimension-specific behaviour (2D vs 3D) lives behind the session interface:
// { step, evaluate, ghost, render, pointerDown/Move/Up, togglePin,
//   controlCount, drainEvents, specs, dim }.

import { Session2D, MAX_CONTROLS } from './session2d.js';
import { Session3D } from './session3d.js';
import { HUD } from '../ui/hud.js';
import { levels } from './levels/index.js';

const SIM_INTERVAL = 0.1;   // seconds between similarity evaluations
const HOLD_SECONDS = 3.0;   // keep score above cutoff this long to bank a target
const HYSTERESIS = 1.5;     // score may dip this far below cutoff without resetting hold
const BANNER_SECONDS = 1.4;
const STORAGE_KEY = 'polyform.progress.v1';

const EVENT_TOASTS = [
  ['rejected', '只能从软体外部下刀'],
  ['deflate', '嘶——有什么东西泄气了……'],
  ['snap', '啪！内部有根管路绷断了'],
  ['bisect', '一分为二。'],
  ['weld', '粘合完成'],
  ['weldCut', '焊缝被切开了'],
  ['pipeCut', '切断了一根管道'],
  ['crumb', '掉了一小块碎屑'],
];

export class Game {
  constructor(container, canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hud = new HUD(container, {
      onTool: t => this.setTool(t),
      onRestart: () => this.startLevel(this.levelIdx),
      onMenu: () => this.showMenu(),
      onNext: () => this.startLevel(this.levelIdx + 1),
      onSelectLevel: i => this.startLevel(i),
    });
    this.state = 'menu';
    this.tool = 'pull';
    this.session = null;
    this.sim = null;
    this.smooth = { total: 0, outline: 0, pipes: 0 };
    this.bindInput();
    this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));
    this.showMenu();
  }

  // ---- screens -------------------------------------------------------------

  progress() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; }
  }

  markDone(id, timeUsed) {
    const p = this.progress();
    const prev = p[id]?.bestTime;
    p[id] = { done: true, bestTime: prev == null ? timeUsed : Math.min(prev, timeUsed) };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  }

  showMenu() {
    this.state = 'menu';
    this.session = null;
    this.hud.showMenu(levels, this.progress());
  }

  startLevel(i) {
    if (i < 0 || i >= levels.length) return this.showMenu();
    this.levelIdx = i;
    const def = levels[i];
    this.def = def;
    this.session = def.dim === 3 ? new Session3D(def, this.canvas) : new Session2D(def);
    this.targetIdx = 0;
    this.timeLeft = def.timeLimit;
    this.hold = 0;
    this.sim = null;
    this.simT = 0;
    this.bannerT = 0;
    this.bestTotal = 0;
    this.smooth = { total: 0, outline: 0, pipes: 0 };
    this.targetTime = 0;
    this.hintQueue = [...(def.targets[0].moreHints ?? [])];
    this._cutTipShown = false;
    this.setTool('pull');
    this.state = 'playing';
    this.hud.showGame(`${i + 1} · ${def.name}`);
    this.hud.setTarget(0, def.targets.length, this.session.specs[0], this.cutoff());
    this.hud.setHint(def.targets[0].hint ?? def.intro ?? '');
    this.hud.setTimer(this.timeLeft);
    if (def.intro) this.hud.toast(def.intro, 3600);
  }

  cutoff() {
    return this.def.targets[this.targetIdx]?.cutoff ?? this.def.cutoff ?? 85;
  }

  setTool(t) {
    if (this.session?.dim === 3 && t === 'glue') {
      this.hud.toast('3D 关卡暂不支持粘合');
      return;
    }
    this.tool = t;
    this.hud.setTool(t);
    if (t === 'cut' && !this._cutTipShown && this.session) {
      this._cutTipShown = true;
      this.hud.toast(this.session.dim === 3 ? '对准管道点一下即可剪断' : '从软体外面按住，划一条线切进去', 3200);
    }
  }

  // ---- main loop -------------------------------------------------------------

  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'playing' || this.state === 'banner' || this.state === 'lost' || this.state === 'won') {
      this.session.step(dt);
      this.handleEvents();
    }
    if (this.state === 'playing') {
      this.timeLeft -= dt;
      this.hud.setTimer(this.timeLeft);
      // Progressive hints: the longer a target stalls, the blunter the advice.
      this.targetTime += dt;
      while (this.hintQueue.length && this.targetTime >= this.hintQueue[0].t) {
        const h = this.hintQueue.shift();
        this.hud.setHint(h.text);
        this.hud.toast(h.text, 4200);
      }
      if (this.timeLeft <= 0) this.lose();
      else {
        this.simT += dt;
        if (this.simT >= SIM_INTERVAL) {
          this.simT = 0;
          this.sim = this.session.evaluate(this.targetIdx);
          this.bestTotal = Math.max(this.bestTotal, this.sim.total);
          this.updateHold();
        }
      }
    } else if (this.state === 'banner') {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.nextTarget();
    }
    if (this.session) {
      const s = this.smooth, raw = this.sim ?? { total: 0, outline: 0, pipes: 0 };
      s.total += (raw.total - s.total) * 0.25;
      s.outline += (raw.outline - s.outline) * 0.25;
      s.pipes += (raw.pipes - s.pipes) * 0.25;
      this.hud.setScore({ ...s, topologyOk: this.sim?.topologyOk }, this.cutoff(), this.hold / HOLD_SECONDS);
      this.hud.setControls(this.session.controlCount(), MAX_CONTROLS);
      const ghost = this.sim ? this.session.ghost(this.targetIdx, this.sim) : null;
      this.session.render(this.ctx, { ghost });
    }
    requestAnimationFrame(t => this.loop(t));
  }

  updateHold() {
    const cutoff = this.cutoff();
    if (this.sim.total >= cutoff) {
      this.hold += SIM_INTERVAL;
      if (this.hold >= HOLD_SECONDS) this.completeTarget();
    } else if (this.sim.total < cutoff - HYSTERESIS) {
      this.hold = 0;
    }
    // Between (cutoff - HYSTERESIS) and cutoff: hold freezes but doesn't reset.
  }

  completeTarget() {
    this.state = 'banner';
    this.bannerT = BANNER_SECONDS;
    this.hud.banner(`目标「${this.session.specs[this.targetIdx].name}」达成 ✔`);
  }

  nextTarget() {
    this.targetIdx++;
    this.hold = 0;
    this.sim = null;
    this.bestTotal = 0;
    if (this.targetIdx >= this.def.targets.length) return this.win();
    this.state = 'playing';
    this.targetTime = 0;
    this.hintQueue = [...(this.def.targets[this.targetIdx].moreHints ?? [])];
    this.hud.setTarget(this.targetIdx, this.def.targets.length, this.session.specs[this.targetIdx], this.cutoff());
    this.hud.setHint(this.def.targets[this.targetIdx].hint ?? '');
  }

  win() {
    this.state = 'won';
    const used = this.def.timeLimit - Math.max(0, this.timeLeft);
    this.markDone(this.def.id, used);
    const fmt = s => `${Math.floor(s / 60)}:${String(Math.ceil(s % 60)).padStart(2, '0')}`;
    this.hud.showResult({
      won: true,
      detail: `全部 ${this.def.targets.length} 个目标完成，用时 ${fmt(used)}（剩余 ${fmt(Math.max(0, this.timeLeft))}）`,
      hasNext: this.levelIdx + 1 < levels.length,
    });
  }

  lose() {
    this.state = 'lost';
    const need = this.cutoff();
    this.hud.showResult({
      won: false,
      detail: `目标 ${this.targetIdx + 1}/${this.def.targets.length}：最佳读值 ${Math.round(this.bestTotal)}（达标线 ${need}）。摸清每根管路的物性再来！`,
      hasNext: false,
    });
  }

  handleEvents() {
    const events = this.session.drainEvents();
    if (events.length === 0) return;
    for (const e of events) {
      if (e.type === 'hint') this.hud.toast(e.text);
    }
    for (const [type, text] of EVENT_TOASTS) {
      if (events.some(e => e.type === type)) { this.hud.toast(text); break; }
    }
  }

  // ---- input -------------------------------------------------------------------

  bindInput() {
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (this.canvas.width / r.width),
        y: (e.clientY - r.top) * (this.canvas.height / r.height),
      };
    };
    this.canvas.addEventListener('pointerdown', e => {
      if (this.state !== 'playing' || !this.session) return;
      const { x, y } = pos(e);
      if (this.session.pointerDown(this.tool, x, y, e.pointerId)) {
        this.canvas.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!this.session) return;
      const { x, y } = pos(e);
      this.session.pointerMove(this.tool, x, y, e.pointerId);
    });
    const up = e => {
      if (!this.session) return;
      const { x, y } = pos(e);
      this.session.pointerUp(this.tool, x, y, e.pointerId);
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('dblclick', e => {
      if (this.state !== 'playing' || !this.session) return;
      const { x, y } = pos(e);
      this.session.togglePin(x, y);
    });
    window.addEventListener('keydown', e => {
      if (e.key === '1') this.setTool('pull');
      else if (e.key === '2') this.setTool('cut');
      else if (e.key === '3') this.setTool('glue');
      else if ((e.key === 'r' || e.key === 'R') && this.session) this.startLevel(this.levelIdx);
      else if (e.key === 'Escape') this.showMenu();
    });
  }
}
