// Game orchestrator: level lifecycle, fixed-step driving of the session,
// similarity evaluation cadence, hold-to-complete logic, timer, HUD wiring.
// Dimension-specific behaviour (2D vs 3D) lives behind the session interface:
// { step, evaluate, ghost, render, pointerDown/Move/Up, togglePin,
//   controlCount, drainEvents, specs, dim }.

import { Session2D, MAX_CONTROLS } from './session2d.js';
import { Session3D } from './session3d.js';
import { HUD } from '../ui/hud.js';
import { levels } from './levels/index.js';
import { unlock as unlockAudio, sfx, setSfxStyle } from '../audio/sfx.js';
import { applyPalette } from '../render/render2d.js';
import {
  currentTheme, setTheme, themeLevel, themeTarget, themeToast, themeString,
} from './themes.js';

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
      onTheme: () => {
        // Theme toggle lives on the menu: switch, persist, redraw the menu.
        // A level in progress is unaffected (themes apply at startLevel).
        setTheme(currentTheme().meta.id === 'lab' ? 'bio' : 'lab');
        this.showMenu();
      },
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
    applyPalette(currentTheme().palette);
    this.hud.showMenu(levels, this.progress(), currentTheme());
  }

  // ---- theme text fallbacks (lab: always the level file's original copy) ----

  themedTargetName(idx) {
    return themeTarget(this.def.id, idx)?.name ?? this.def.targets[idx].name;
  }

  themedHint(idx) {
    return themeTarget(this.def.id, idx)?.hint ?? this.def.targets[idx].hint;
  }

  /** Progressive hints keep the level file's TIMINGS; only the text is themed. */
  themedMoreHints(idx) {
    const src = this.def.targets[idx].moreHints ?? [];
    const over = themeTarget(this.def.id, idx)?.moreHints;
    return src.map((h, k) => ({ t: h.t, text: over?.[k] ?? h.text }));
  }

  startLevel(i) {
    if (i < 0 || i >= levels.length) return this.showMenu();
    const theme = currentTheme();
    applyPalette(theme.palette);
    setSfxStyle(theme.fx.sfx);
    this.hud.applyTheme(theme);
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
    this.hintQueue = this.themedMoreHints(0);
    this._cutTipShown = false;
    this._holdTipShown = false;
    this.topoBadT = 0;
    this._topoWarned = false;
    this._topoWasBad = false;
    this._topoFixedShown = false;
    this.awayT = 0;
    this._awayToastShown = false;
    this._beatPhase = null;
    this.setTool('pull');
    this.state = 'playing';
    const intro = themeLevel(def.id)?.intro ?? def.intro;
    this.hud.showGame(`${i + 1} · ${themeLevel(def.id)?.name ?? def.name}`);
    this.hud.setTarget(0, def.targets.length, this.session.specs[0], this.cutoff(),
      this.themedTargetName(0));
    this.hud.setHint(this.themedHint(0) ?? intro ?? '');
    this.hud.setTimer(this.timeLeft);
    if (intro) this.hud.toast(intro, 3600);
  }

  cutoff() {
    return this.def.targets[this.targetIdx]?.cutoff ?? this.def.cutoff ?? 85;
  }

  setTool(t) {
    if (this.session?.dim === 3 && t === 'glue') {
      this.hud.toast(themeToast('glue3d') ?? '3D 关卡暂不支持粘合');
      return;
    }
    this.tool = t;
    this.hud.setTool(t);
    if (t === 'cut' && !this._cutTipShown && this.session) {
      this._cutTipShown = true;
      this.hud.toast(this.session.dim === 3
        ? (themeToast('cutTip3d') ?? '对准管道点一下即可剪断')
        : (themeToast('cutTip2d') ?? '从软体外面按住，划一条线切进去'), 3200);
    }
  }

  // ---- main loop -------------------------------------------------------------

  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'playing' || this.state === 'banner' || this.state === 'lost' || this.state === 'won') {
      this.session.step(dt);
      this.handleEvents();
      this.updateHeartbeat();
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
      // Flung-specimen reassurance: if the piece's centroid stays out of frame
      // for 2 s, tell the player it is gliding home (once per target).
      if (this.specimenAway()) {
        this.awayT += dt;
        if (this.awayT >= 2 && !this._awayToastShown) {
          this._awayToastShown = true;
          this.hud.toast(themeToast('away') ?? '试件正在归位——稍候，或按 R 立即复位', 3200);
        }
      } else {
        this.awayT = 0;
      }
      if (this.timeLeft <= 0) this.lose();
      else {
        this.simT += dt;
        if (this.simT >= SIM_INTERVAL) {
          this.simT = 0;
          this.sim = this.session.evaluate(this.targetIdx);
          this.bestTotal = Math.max(this.bestTotal, this.sim.total);
          if (this.sim.topologyOk === false) {
            this.topoBadT += SIM_INTERVAL;
            this._topoWasBad = true;
            this.checkTopoDeadlock();
          } else {
            // Broken -> matching transition: the cut that just landed made the
            // pipe layout agree with the spec — say so once per target.
            if (this._topoWasBad && this.sim.topologyOk === true && !this._topoFixedShown) {
              this._topoFixedShown = true;
              this.hud.toast(themeToast('topoFixed')
                ?? '管路结构对上了——照着虚线框继续塑形，读数会跟着爬升');
            }
            this._topoWasBad = false;
            this.topoBadT = 0;
          }
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

  /** Bio-theme ambient heartbeat: one very quiet thump per pulse cycle, fired
   *  on the phase wrap of the session's pulse clock (no WebAudio loop nodes),
   *  and only while a live, un-bled pressure loop keeps the specimen beating.
   *  Lab theme: sessions have pulse=false, so this never makes a sound. */
  updateHeartbeat() {
    const s = this.session;
    if (!s || s.dim !== 2 || !s.pulse || this.state !== 'playing') {
      this._beatPhase = null;
      return;
    }
    const phase = (s.pulseT * 1.15) % 1;
    const prev = this._beatPhase;
    this._beatPhase = phase;
    if (prev == null || phase >= prev) return; // fire once per wrap
    try {
      const beating = s.body.pipes.some(p =>
        p.alive && p.type === 'pressure' && p.closed && !p.deflated);
      if (beating) sfx.thump();
    } catch { /* audio must never break the loop */ }
  }

  /** Is the specimen's centre of mass out of the workbench frame? 2D: canvas
   *  is 960x640 world units, with a generous margin. 3D: the cube (size ~220)
   *  orbits the origin at camera distance 640 — beyond 480 units it reads as
   *  "gone". */
  specimenAway() {
    if (!this.session) return false;
    if (this.session.dim === 3) {
      const c = this.session.body.centroid();
      return Math.hypot(c.x, c.y, c.z) > 480;
    }
    const m = this.session.measureBody();
    return m.n > 0 && (m.cx < -60 || m.cx > 1020 || m.cy < -60 || m.cy > 700);
  }

  /** Soft-lock detection: if the pipe topology has been wrong for a while AND
   *  can never be repaired (cuts only ever destroy loops and multiply chains;
   *  nothing rebuilds them), say so once instead of letting the player grind
   *  an unreachable target. */
  checkTopoDeadlock() {
    if (this.topoBadT < 5 || this._topoWarned) return;
    const st = this.session.state?.().topology;
    const need = this.session.specs[this.targetIdx]?.topology;
    if (!st || !need) return;
    if (st.loops < need.loops || st.chains > need.chains) {
      this._topoWarned = true;
      const msg = themeToast('topoDeadlock') ?? '管路拓扑已不可恢复，本目标无法达成——按 R 重开试件';
      this.hud.toast(msg, 6000);
      this.hud.setHint(msg);
    }
  }

  updateHold() {
    const cutoff = this.cutoff();
    if (this.sim.total >= cutoff) {
      // First time the readout ever crosses the line this level: teach the
      // hold rule at the exact moment it matters.
      if (this.hold === 0 && !this._holdTipShown) {
        this._holdTipShown = true;
        this.hud.toast('读数越线了——保持住 3 秒！');
      }
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
    sfx.chime();
    this.hud.gaugeLock();
    this.hud.banner(`${themeToast('bannerPass') ?? '检验通过'} · 目标「${this.themedTargetName(this.targetIdx)}」已锁定`);
  }

  nextTarget() {
    this.targetIdx++;
    this.hold = 0;
    this.sim = null;
    this.bestTotal = 0;
    this.topoBadT = 0;
    this._topoWarned = false;
    this._topoWasBad = false;
    this._topoFixedShown = false;
    this.awayT = 0;
    this._awayToastShown = false;
    if (this.targetIdx >= this.def.targets.length) return this.win();
    this.state = 'playing';
    this.targetTime = 0;
    this.hintQueue = this.themedMoreHints(this.targetIdx);
    this.hud.setTarget(this.targetIdx, this.def.targets.length, this.session.specs[this.targetIdx],
      this.cutoff(), this.themedTargetName(this.targetIdx));
    this.hud.setHint(this.themedHint(this.targetIdx) ?? '');
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
      detail: `目标 ${this.targetIdx + 1}/${this.def.targets.length}：最佳读值 ${Math.round(this.bestTotal)}（达标线 ${need}）。${themeToast('loseTail') ?? '摸清每根管路的物性再来！'}`,
      hasNext: false,
    });
  }

  handleEvents() {
    const events = this.session.drainEvents();
    if (events.length === 0) return;
    for (const e of events) this.session.effects?.spawnFromEvent(e);
    // Event -> one-shot sfx (deduped per batch so one knife stroke that severs
    // several segments doesn't stack the same transient). The bio theme swaps
    // in the organic timbre set; snap keeps crack (a calcified vessel IS brittle).
    const organic = currentTheme().fx.sfx === 'organic';
    const played = new Set();
    const play = name => { if (!played.has(name)) { played.add(name); sfx[name](); } };
    for (const e of events) {
      if (e.type === 'deflate') play(organic ? 'bloodSpurt' : 'hiss');
      else if (e.type === 'pipeCut') play(organic ? 'wetSnip' : (e.pipeType === 'contractile' ? 'twang' : 'snip'));
      else if (e.type === 'snap') play('crack');
      else if (e.type === 'rejected') play('thud');
    }
    for (const e of events) {
      if (e.type === 'hint') this.hud.toast(themeString(e.text));
    }
    for (const [type, text] of EVENT_TOASTS) {
      if (events.some(e => e.type === type)) { this.hud.toast(themeToast(type) ?? text); break; }
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
      unlockAudio(); // AudioContext must be born inside a user gesture
      if (this.state !== 'playing' || !this.session) return;
      const { x, y } = pos(e);
      if (this.session.pointerDown(this.tool, x, y, e.pointerId)) {
        this.canvas.setPointerCapture(e.pointerId);
        // Bio theme: fingers sinking into wet tissue (grab only; lab silent).
        if (this.tool === 'pull' && currentTheme().fx.sfx === 'organic') sfx.squish();
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
