// 앱 상태 저장소: 변경 → 자동 임시 저장(지연) → 저장 상태 알림

import { saveLocal } from './persistence.js';

export class Store {
  constructor(state) {
    this.state = state;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.status = { kind: 'idle', time: null, message: '' };
    this.timer = null;
    this.dirty = false;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onStatus(fn) { this.statusListeners.add(fn); fn(this.status); return () => this.statusListeners.delete(fn); }

  setStatus(s) {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  /** mutator(state)로 상태를 바꾸고 자동 저장을 예약한다 */
  update(mutator, { topic = 'change', immediate = false, persist = true } = {}) {
    mutator(this.state);
    if (persist) {
      this.state.updatedAt = Date.now();
      this.dirty = true;
      if (immediate) this.flush();
      else this.schedule();
    }
    for (const fn of this.listeners) fn(topic, this.state);
  }

  replace(state, { topic = 'replace' } = {}) {
    this.state = state;
    this.dirty = true;
    this.flush();
    for (const fn of this.listeners) fn(topic, this.state);
  }

  schedule() {
    if (this.status.kind !== 'error') this.setStatus({ kind: 'pending', time: this.status.time, message: '저장 대기 중…' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 600);
  }

  flush() {
    clearTimeout(this.timer);
    if (!this.dirty) return this.status.kind !== 'error';
    if (!this.state.started) { this.dirty = false; return true; }
    this.setStatus({ kind: 'saving', time: this.status.time, message: '저장 중…' });
    const r = saveLocal(this.state);
    if (r.ok) {
      this.dirty = false;
      this.setStatus({ kind: 'saved', time: r.time, message: '저장됨' });
      return true;
    }
    this.setStatus({ kind: 'error', time: this.status.time, message: r.error });
    return false;
  }
}
