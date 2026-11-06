// DOM 도우미, 대화상자

import { escapeHtml } from './format.js';

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 내용에 맞춰 높이가 늘어나는 입력란 */
export function autosize(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight + 2, 96), 640)}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

function dialogShell({ title, bodyHtml, buttons, danger }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: `dialog${danger ? ' dialog-danger' : ''}`, 'aria-labelledby': 'dlg-title' });
    dlg.innerHTML = `<form method="dialog" class="dialog-form">
      <h2 id="dlg-title" class="dialog-title">${escapeHtml(title)}</h2>
      <div class="dialog-body">${bodyHtml}</div>
      <div class="dialog-actions"></div></form>`;
    const actions = dlg.querySelector('.dialog-actions');
    for (const b of buttons) {
      const btn = h('button', { type: 'button', class: `btn ${b.kind || 'btn-secondary'}`, value: b.value }, b.label);
      btn.addEventListener('click', () => { dlg.close(b.value); });
      actions.append(btn);
    }
    dlg.addEventListener('close', () => { const v = dlg.returnValue; dlg.remove(); resolve(v); });
    dlg.addEventListener('cancel', () => { dlg.returnValue = 'cancel'; });
    document.body.append(dlg);
    dlg.showModal();
    const focusBtn = actions.querySelector('[value="cancel"]') || actions.lastElementChild;
    focusBtn?.focus();
  });
}

export async function confirmDialog({ title, body, okLabel = '확인', cancelLabel = '취소', danger = false, html = false }) {
  const v = await dialogShell({
    title,
    bodyHtml: html ? body : `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`,
    danger,
    buttons: [
      { label: cancelLabel, value: 'cancel', kind: 'btn-secondary' },
      { label: okLabel, value: 'ok', kind: danger ? 'btn-danger' : 'btn-primary' },
    ],
  });
  return v === 'ok';
}

export async function alertDialog({ title, body, html = false, okLabel = '확인' }) {
  await dialogShell({
    title,
    bodyHtml: html ? body : `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`,
    buttons: [{ label: okLabel, value: 'ok', kind: 'btn-primary' }],
  });
}

export async function choiceDialog({ title, body, html = false, choices }) {
  return dialogShell({ title, bodyHtml: html ? body : `<p>${escapeHtml(body)}</p>`, buttons: choices });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: 'display:none' });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function toast(message, kind = 'info') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  host.append(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4400);
}
